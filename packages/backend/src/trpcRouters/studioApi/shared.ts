import { projectMetaService } from "../../services/project/ProjectMetaService";
import { projectPluginService } from "../../services/plugins/ProjectPluginService";
import type { ChecklistItem } from "../../types/checklistTypes";

export function normalizeChecklistItemNote(
  note: string | null | undefined,
): string | undefined {
  if (note == null) return undefined;
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function summarizeChecklistItems(items: ChecklistItem[]): {
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
  fixed?: number;
} {
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let skipped = 0;
  let fixed = 0;

  for (const item of items) {
    switch (item.status) {
      case "pass":
        passed += 1;
        break;
      case "fail":
        failed += 1;
        break;
      case "warning":
        warnings += 1;
        break;
      case "skip":
        skipped += 1;
        break;
      case "fixed":
        fixed += 1;
        break;
      default:
        break;
    }
  }

  return fixed > 0
    ? { passed, failed, warnings, skipped, fixed }
    : { passed, failed, warnings, skipped };
}

export function normalizeGenerationSource(
  source: string | null | undefined,
): "url" | "scratch" {
  return source === "url" ? "url" : "scratch";
}

export async function getEnabledProjectPluginIds(
  organizationId: string,
  slug: string,
): Promise<string[]> {
  const catalog = await projectPluginService.listCatalogForProject(
    organizationId,
    slug,
  );
  return catalog.instances
    .filter((instance) => instance.status === "enabled")
    .map((instance) => instance.pluginId)
    .sort();
}

export async function resolveStudioProjectVersion(options: {
  organizationId: string;
  slug: string;
  version?: number;
}) {
  const project = await projectMetaService.getProject(
    options.organizationId,
    options.slug,
  );
  if (!project) {
    throw new Error(`Project not found: ${options.slug}`);
  }

  const resolvedVersion = options.version ?? Math.max(1, project.currentVersion || 1);
  const versionMeta = await projectMetaService.getProjectVersion(
    options.organizationId,
    options.slug,
    resolvedVersion,
  );

  if (!versionMeta && options.version) {
    throw new Error(`Project version not found: ${options.slug}/v${resolvedVersion}`);
  }

  return {
    project,
    versionMeta,
    resolvedVersion,
    source: normalizeGenerationSource(versionMeta?.source ?? project.source),
    enabledPluginIds: await getEnabledProjectPluginIds(
      options.organizationId,
      options.slug,
    ),
  };
}

export async function buildProjectInfo(options: {
  organizationId: string;
  slug: string;
  version?: number;
}) {
  const resolved = await resolveStudioProjectVersion(options);

  return {
    project: {
      slug: options.slug,
      title:
        resolved.versionMeta?.title || resolved.project.title || options.slug,
      source: resolved.source,
      currentVersion: Math.max(
        1,
        resolved.project.currentVersion || resolved.resolvedVersion,
      ),
      requestedVersion: resolved.resolvedVersion,
    },
    enabledPluginIds: resolved.enabledPluginIds,
  };
}
