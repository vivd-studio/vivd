import fs from "fs";
import path from "path";
import { ownerProcedure } from "../../../trpc";
import {
  getManifest,
  getProjectDir,
  isLegacyProject,
  listProjectSlugs,
  migrateProjectIfNeeded,
} from "../../../generator/versionUtils";
import {
  migrateVivdInternalArtifactsInVersion,
  VIVD_INTERNAL_ARTIFACT_FILENAMES,
} from "../../../generator/vivdPaths";
import { migrateProjectMetadataToDbFromFilesystem } from "../../../services/project/ProjectMetaMigrationService";

function createVivdArtifactCounter(): Record<string, number> {
  return Object.fromEntries(
    VIVD_INTERNAL_ARTIFACT_FILENAMES.map((filename) => [filename, 0]),
  );
}

export const projectMaintenanceMigrationProcedures = {
  /**
   * Admin maintenance: move vivd process files into `.vivd/` for all versions.
   * Keeps the version root clean and prevents accidental public access to process artifacts.
   */
  migrateVivdProcessFiles: ownerProcedure.mutation(async ({ ctx }) => {
    const organizationId = ctx.organizationId ?? "default";
    const projectDirs = await listProjectSlugs(organizationId);
    if (projectDirs.length === 0) {
      return {
        success: true,
        projectsScanned: 0,
        legacyProjectsMigrated: 0,
        versionsScanned: 0,
        versionsTouched: 0,
        moved: createVivdArtifactCounter(),
        movedToLegacy: createVivdArtifactCounter(),
        errors: [] as Array<{
          slug: string;
          versionDir: string;
          error: string;
        }>,
      };
    }

    const moved = createVivdArtifactCounter();
    const movedToLegacy = createVivdArtifactCounter();

    let projectsScanned = 0;
    let legacyProjectsMigrated = 0;
    let versionsScanned = 0;
    let versionsTouched = 0;
    const errors: Array<{ slug: string; versionDir: string; error: string }> =
      [];

    for (const slug of projectDirs) {
      projectsScanned++;

      try {
        if (isLegacyProject(slug)) {
          const did = migrateProjectIfNeeded(slug);
          if (did) legacyProjectsMigrated++;
        }
      } catch (e) {
        errors.push({
          slug,
          versionDir: getProjectDir(organizationId, slug),
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      const projectDir = getProjectDir(organizationId, slug);
      if (!fs.existsSync(projectDir)) continue;

      // Only treat directories with a manifest as projects; legacy projects are handled above.
      const manifest = await getManifest(organizationId, slug);
      if (!manifest) continue;

      const versionFolders = fs
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
        .map((entry) => entry.name);

      for (const folder of versionFolders) {
        const versionDir = path.join(projectDir, folder);
        versionsScanned++;

        try {
          const result = migrateVivdInternalArtifactsInVersion(versionDir);
          if (result.moved.length || result.movedToLegacy.length) {
            versionsTouched++;
          }
          for (const item of result.moved) moved[item.filename]++;
          for (const item of result.movedToLegacy) movedToLegacy[item.filename]++;
        } catch (e) {
          errors.push({
            slug,
            versionDir,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      success: true,
      projectsScanned,
      legacyProjectsMigrated,
      versionsScanned,
      versionsTouched,
      moved,
      movedToLegacy,
      errors,
    };
  }),

  /**
   * Admin maintenance: migrate file-backed project metadata into the database.
   * Imports `manifest.json`, `.vivd/project.json`, `.vivd/publish-checklist.json`, and thumbnail artifacts.
   */
  migrateProjectMetadataToDb: ownerProcedure.mutation(async () => {
    return migrateProjectMetadataToDbFromFilesystem();
  }),
};
