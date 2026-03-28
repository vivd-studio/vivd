import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { organization, projectPluginInstance } from "../../db/schema";
import { emailTemplateBrandingService } from "../email/templateBranding";
import { resolveStudioMainBackendUrl } from "./backendCallbackUrl";

const STABLE_STUDIO_RUNTIME_FLAG_KEYS = [
  "VIVD_ORGANIZATION_PLAN",
  "VIVD_OPENCODE_TOOLS_ENABLE",
  "VIVD_OPENCODE_TOOLS_DISABLE",
  "VIVD_OPENCODE_TOOL_FLAGS",
] as const;

export const STABLE_STUDIO_MACHINE_ENV_KEYS = [
  "MAIN_BACKEND_URL",
  "GITHUB_REPO_PREFIX",
  "VIVD_ENABLED_PLUGINS",
  "VIVD_EMAIL_BRAND_SUPPORT_EMAIL",
  ...STABLE_STUDIO_RUNTIME_FLAG_KEYS,
] as const;

function normalizeGitHubRepoPrefix(value: string): string {
  const trimmed = value.trim().replace(/^-+/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("-") ? trimmed : `${trimmed}-`;
}

function buildStudioGitHubRepoPrefix(options: {
  organizationId: string;
  organizationRepoPrefix: string | null;
}): string {
  const instancePrefix = normalizeGitHubRepoPrefix(process.env.GITHUB_REPO_PREFIX || "");
  const orgPrefixRaw = (options.organizationRepoPrefix || "").trim();
  const orgPrefix = normalizeGitHubRepoPrefix(orgPrefixRaw || options.organizationId);

  if (!instancePrefix) return orgPrefix;
  if (orgPrefix.startsWith(instancePrefix)) return orgPrefix;
  if (instancePrefix.endsWith(orgPrefix)) return instancePrefix;
  return `${instancePrefix}${orgPrefix}`;
}

function readInstanceStudioRuntimeFlags(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of STABLE_STUDIO_RUNTIME_FLAG_KEYS) {
    const value = (process.env[key] || "").trim();
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

async function getEnabledProjectPluginIds(
  organizationId: string,
  slug: string,
): Promise<string[]> {
  try {
    const rows = await db.query.projectPluginInstance.findMany({
      where: and(
        eq(projectPluginInstance.organizationId, organizationId),
        eq(projectPluginInstance.projectSlug, slug),
        eq(projectPluginInstance.status, "enabled"),
      ),
      columns: {
        pluginId: true,
      },
    });
    return rows
      .map((row) => row.pluginId)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[StudioMachine] Failed to resolve enabled plugins for ${organizationId}/${slug}: ${message}`,
    );
    return [];
  }
}

async function getOrganizationGithubRepoPrefix(
  organizationId: string,
): Promise<string | null> {
  try {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: { githubRepoPrefix: true },
    });
    return org?.githubRepoPrefix ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[StudioMachine] Failed to resolve GitHub repo prefix for ${organizationId}: ${message}`,
    );
    return null;
  }
}

async function getResolvedSupportEmail(): Promise<string | null> {
  try {
    const branding = await emailTemplateBrandingService.getResolvedBranding();
    const supportEmail =
      branding.supportEmail?.trim() ||
      (process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL || "").trim();
    return supportEmail || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[StudioMachine] Failed to resolve support email branding: ${message}`);
    const fallback = (process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL || "").trim();
    return fallback || null;
  }
}

export function pickStableStudioMachineEnv(
  env: Record<string, string> | undefined,
): Record<string, string> {
  const picked: Record<string, string> = {};
  if (!env) return picked;

  for (const key of STABLE_STUDIO_MACHINE_ENV_KEYS) {
    const value = env[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    picked[key] = trimmed;
  }

  return picked;
}

export async function resolveStableStudioMachineEnv(options: {
  providerKind: "local" | "fly" | "docker";
  organizationId: string;
  projectSlug: string;
  requestHost?: string | null;
}): Promise<Record<string, string>> {
  const [enabledPluginIds, organizationRepoPrefix, supportEmail] = await Promise.all([
    getEnabledProjectPluginIds(options.organizationId, options.projectSlug),
    getOrganizationGithubRepoPrefix(options.organizationId),
    getResolvedSupportEmail(),
  ]);

  const env: Record<string, string> = {
    MAIN_BACKEND_URL: resolveStudioMainBackendUrl({
      providerKind: options.providerKind,
      requestHost: options.requestHost,
      backendUrlEnv: process.env.BACKEND_URL,
      domainEnv: process.env.DOMAIN,
      betterAuthUrlEnv: process.env.BETTER_AUTH_URL,
      backendPort: process.env.PORT,
    }),
    GITHUB_REPO_PREFIX: buildStudioGitHubRepoPrefix({
      organizationId: options.organizationId,
      organizationRepoPrefix,
    }),
    ...readInstanceStudioRuntimeFlags(),
  };

  if (enabledPluginIds.length > 0) {
    env.VIVD_ENABLED_PLUGINS = enabledPluginIds.join(",");
  }
  if (supportEmail) {
    env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL = supportEmail;
  }

  return env;
}
