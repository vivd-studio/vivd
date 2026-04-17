import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { ownerProcedure, protectedProcedure } from "../../../trpc";
import { db } from "../../../db";
import { organization } from "../../../db/schema";
import {
  getActiveTenantId,
  getManifest,
  getProjectDir,
  isLegacyProject,
  listProjectSlugs,
  migrateProjectIfNeeded,
} from "../../../generator/versionUtils";
import {
  createS3Client,
  getObjectStorageConfigFromEnv,
  uploadDirectoryToBucket,
} from "../../../services/storage/ObjectStorageService";

export const projectMaintenanceConfigAndExportProcedures = {
  /**
   * Get application configuration (exposed to frontend)
   */
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const domain = process.env.DOMAIN || null;
    const organizationId = ctx.organizationId ?? getActiveTenantId();
    const org = ctx.organizationId
      ? await db.query.organization.findFirst({
          where: eq(organization.id, ctx.organizationId),
          columns: { githubRepoPrefix: true },
        })
      : null;
    return {
      // The current domain where vivd-studio is running
      domain,
      tenantId: organizationId,
      github: {
        enabled: process.env.GITHUB_SYNC_ENABLED === "true",
        org: process.env.GITHUB_ORG || null,
        repoPrefix:
          org?.githubRepoPrefix ?? process.env.GITHUB_REPO_PREFIX ?? "",
      },
    };
  }),

  /**
   * Admin maintenance: upload all local project versions into object storage (S3/R2)
   * so studio machines can hydrate workspaces from the bucket.
   */
  exportAllProjectsToObjectStorage: ownerProcedure.mutation(async () => {
    const {
      bucket,
      endpointUrl,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
    } = getObjectStorageConfigFromEnv();
    const client = createS3Client({
      bucket,
      endpointUrl,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });

    const tenantId = getActiveTenantId();

    const projectDirs = await listProjectSlugs(tenantId);
    if (projectDirs.length === 0) {
      return {
        success: true,
        bucket,
        endpointUrl: endpointUrl || null,
        tenantId,
        projectsScanned: 0,
        legacyProjectsMigrated: 0,
        versionsScanned: 0,
        versionsExported: 0,
        filesUploaded: 0,
        bytesUploaded: 0,
        errors: [] as Array<{
          slug: string;
          versionDir: string;
          error: string;
        }>,
        fileErrors: [] as Array<{
          slug: string;
          versionDir: string;
          file: string;
          key: string;
          error: string;
        }>,
      };
    }

    let projectsScanned = 0;
    let legacyProjectsMigrated = 0;
    let versionsScanned = 0;
    let versionsExported = 0;
    let filesUploaded = 0;
    let bytesUploaded = 0;

    const errors: Array<{ slug: string; versionDir: string; error: string }> =
      [];
    const fileErrors: Array<{
      slug: string;
      versionDir: string;
      file: string;
      key: string;
      error: string;
    }> = [];

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
          versionDir: getProjectDir(tenantId, slug),
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      const projectDir = getProjectDir(tenantId, slug);
      if (!fs.existsSync(projectDir)) continue;

      // Keep behavior consistent with other migrations: only process projects with a manifest.
      const manifest = await getManifest(tenantId, slug);
      if (!manifest) continue;

      const versionFolders = fs
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
        .map((entry) => entry.name);

      for (const folder of versionFolders) {
        const versionDir = path.join(projectDir, folder);
        versionsScanned++;

        if (!fs.existsSync(versionDir)) continue;

        const keyPrefix = `tenants/${tenantId}/projects/${slug}/${folder}/source`;

        try {
          const result = await uploadDirectoryToBucket({
            client,
            bucket,
            localDir: versionDir,
            keyPrefix,
            excludeDirNames: ["node_modules"],
          });

          versionsExported++;
          filesUploaded += result.filesUploaded;
          bytesUploaded += result.bytesUploaded;

          for (const fileError of result.errors) {
            fileErrors.push({
              slug,
              versionDir,
              file: fileError.file,
              key: fileError.key,
              error: fileError.error,
            });
          }
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
      bucket,
      endpointUrl: endpointUrl || null,
      tenantId,
      projectsScanned,
      legacyProjectsMigrated,
      versionsScanned,
      versionsExported,
      filesUploaded,
      bytesUploaded,
      errors,
      fileErrors,
    };
  }),
};
