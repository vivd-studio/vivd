import {
  isConnectedMode,
} from "@vivd/shared";
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

function formatEnabledPluginsFromEnv(): string {
  const raw = (process.env.VIVD_ENABLED_PLUGINS || "").trim();
  if (!raw) return "None";
  const list = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length === 0) return "None";
  return list.map((pluginId) => `- ${pluginId}`).join("\n");
}

function buildFallbackInstructions(projectSlug: string): string {
  return `# Project: ${projectSlug}

Your name is vivd. You work in vivd-studio and are responsible for building the customer's website. This is a live production website. Code changes will be deployed to the internet.

## Important Guidelines

1. **Production ready**: All code must be production-quality, mobile responsive, and free of placeholders.
2. **Enabled plugins for this project**:
${formatEnabledPluginsFromEnv()}
3. **Plugin-first features**:
   - Vivd supports first-party plugins such as Contact Form and Analytics.
   - Prefer plugin-backed solutions over custom implementations for those features.
   - If the needed plugin is not enabled, recommend asking Vivd support to activate it instead of building a custom replacement by default.
4. **AGENTS.md is living memory**:
   - Treat the project-root \`AGENTS.md\` file as living project memory.
   - Update it proactively when project-specific information becomes important, especially where content lives and how to add, remove, or edit it.
   - Remove outdated entries so the file stays relevant to the current project.
5. **Before suggesting changes**: Consider SEO, accessibility, and mobile UX.
6. **Clarify questions**: Do not assume anything or make changes when the user asks a question.
7. **Studio uploads**:
   - Files uploaded through the Studio explorer are stored in \`.vivd/uploads/\`.
   - Images dropped into chat are stored in \`.vivd/dropped-images/\`.
   - Treat both as working material; move or copy final public files into \`images/\` or \`public/images/\` only when the site should serve them.

## Git Policy

- Do not create commits, push changes, or manage branches/tags as part of agent tasks.
- Read-only git commands for understanding history or project state are allowed.
- The user decides what to commit, how to branch, and when to push.`;
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
      return buildFallbackInstructions(projectSlug);
    }

    const config = getConnectedBackendAuthConfig();
    if (!config) {
      return buildFallbackInstructions(projectSlug);
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
      return buildFallbackInstructions(projectSlug);
    }
  }
}

export const agentInstructionsService = new AgentInstructionsService();
