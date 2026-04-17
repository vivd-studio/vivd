import { listInstalledPluginAgentHints } from "@vivd/installed-plugins";
import {
  isConnectedMode,
} from "@vivd/shared";
import { renderDefaultVivdAgentInstructions } from "@vivd/shared/studio";
import {
  buildConnectedBackendHeaders,
  getConnectedBackendAuthConfig,
} from "../../lib/connectedBackendAuth.js";

const CACHE_TTL_MS = 30_000;

interface AgentInstructionsResponse {
  instructions: string;
  instructionsHash?: string;
}

interface CachedInstructions {
  fetchedAt: number;
  instructions: string;
  instructionsHash?: string;
}

function unwrapTrpcBody(body: any): any {
  return body?.result?.data?.json ?? body?.result?.data ?? body;
}

function parseProjectVersion(value: number | null | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const parsed = Math.floor(Number(value));
  return parsed > 0 ? parsed : undefined;
}

function readProjectVersionFromEnv(): number | undefined {
  const raw = process.env.VIVD_PROJECT_VERSION || "";
  const parsed = Number.parseInt(raw, 10);
  return parseProjectVersion(parsed);
}

function readEnabledPluginsFromEnv(): string[] {
  const raw = (process.env.VIVD_ENABLED_PLUGINS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

async function resolveSupportEmailFromConnectedBackend(): Promise<string | null> {
  const config = getConnectedBackendAuthConfig();
  if (!config) {
    return null;
  }

  try {
    const queryInput = encodeURIComponent(
      JSON.stringify({
        studioId: config.studioId,
      }),
    );
    const response = await fetch(
      `${config.backendUrl}/api/trpc/studioApi.getSupportContact?input=${queryInput}`,
      {
        method: "GET",
        headers: buildConnectedBackendHeaders(config, {
          includeContentType: false,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`status=${response.status}`);
    }

    const body = (await response.json().catch(() => null)) as any;
    const payload = unwrapTrpcBody(body) as { supportEmail?: string | null } | null;
    const supportEmail = payload?.supportEmail?.trim();
    return supportEmail || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[AgentInstructions] Failed to load support contact from backend: ${message}`,
    );
    return null;
  }
}

async function isSupportRequestEnabled(
  env: NodeJS.ProcessEnv = process.env,
  connectedCliAvailable = false,
): Promise<boolean> {
  const configured = (env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL || "").trim();
  if (configured) {
    return true;
  }

  if (!connectedCliAvailable) {
    return false;
  }

  return Boolean(await resolveSupportEmailFromConnectedBackend());
}

async function buildFallbackInstructions(
  projectSlug: string,
  connectedCliAvailable: boolean,
): Promise<string> {
  const enabledPlugins = readEnabledPluginsFromEnv();
  const supportRequestEnabled = await isSupportRequestEnabled(
    process.env,
    connectedCliAvailable,
  );
  return renderDefaultVivdAgentInstructions({
    projectName: projectSlug,
    enabledPlugins,
    pluginAgentHints: listInstalledPluginAgentHints(enabledPlugins),
    platformSurfaceMode: connectedCliAvailable ? "cli" : "plugin-only",
    previewScreenshotCliEnabled: parseBooleanEnv(
      process.env.VIVD_CLI_PREVIEW_SCREENSHOT_ENABLED,
      false,
    ),
    supportRequestEnabled,
  });
}

class AgentInstructionsService {
  private cache = new Map<string, CachedInstructions>();

  private buildCacheKey(projectSlug: string, projectVersion?: number): string {
    return `${projectSlug}:${projectVersion ?? "latest"}`;
  }

  async getSystemPromptForSessionStart(options?: {
    projectSlug?: string;
    projectVersion?: number | null;
  }): Promise<string> {
    const projectSlug =
      options?.projectSlug?.trim() || (process.env.VIVD_PROJECT_SLUG || "").trim() || "project";
    const projectVersion =
      parseProjectVersion(options?.projectVersion) ?? readProjectVersionFromEnv();

    if (!isConnectedMode()) {
      return await buildFallbackInstructions(projectSlug, false);
    }

    const config = getConnectedBackendAuthConfig();
    if (!config) {
      return await buildFallbackInstructions(projectSlug, false);
    }

    const cacheKey = this.buildCacheKey(projectSlug, projectVersion);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.instructions;
    }

    try {
      const queryInput = encodeURIComponent(
        JSON.stringify({
          studioId: config.studioId,
          slug: projectSlug,
          ...(projectVersion ? { version: projectVersion } : {}),
        }),
      );
      const response = await fetch(
        `${config.backendUrl}/api/trpc/studioApi.getAgentInstructions?input=${queryInput}`,
        {
          method: "GET",
          headers: buildConnectedBackendHeaders(config, {
            includeContentType: false,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`status=${response.status}`);
      }

      const body = (await response.json().catch(() => null)) as any;
      const payload = unwrapTrpcBody(body) as AgentInstructionsResponse | null;
      const instructions = payload?.instructions?.trim();
      if (!instructions) {
        throw new Error("missing instructions payload");
      }

      if (
        cached &&
        payload?.instructionsHash &&
        payload.instructionsHash === cached.instructionsHash
      ) {
        cached.fetchedAt = Date.now();
        return cached.instructions;
      }

      this.cache.set(cacheKey, {
        fetchedAt: Date.now(),
        instructions,
        instructionsHash: payload?.instructionsHash,
      });
      return instructions;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[AgentInstructions] Failed to load instructions from backend for ${projectSlug}: ${message}`,
      );
      if (cached?.instructions) {
        return cached.instructions;
      }
      return await buildFallbackInstructions(projectSlug, true);
    }
  }
}

export const agentInstructionsService = new AgentInstructionsService();
