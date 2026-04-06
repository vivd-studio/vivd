import {
  getBackendUrl,
  getConnectedOrganizationId,
  getStudioId,
  isConnectedMode,
} from "../config/studioMode.js";

export interface ConnectedStudioBackendClientConfig {
  backendUrl: string;
  studioId: string;
  organizationId?: string;
  studioAccessToken?: string;
  projectSlug?: string;
  projectVersion?: number | null;
}

export interface ConnectedStudioBackendClientValidation {
  ok: boolean;
  missing: string[];
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeProjectVersion(value: string | undefined): number | null {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getConnectedStudioBackendClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConnectedStudioBackendClientConfig | null {
  if (env === process.env && !isConnectedMode()) return null;
  if (env !== process.env && !normalizeOptional(env.MAIN_BACKEND_URL)) return null;

  const backendUrl =
    env === process.env ? normalizeOptional(getBackendUrl()) : normalizeOptional(env.MAIN_BACKEND_URL);
  const studioId =
    env === process.env ? normalizeOptional(getStudioId()) : normalizeOptional(env.STUDIO_ID);
  const organizationId =
    env === process.env
      ? normalizeOptional(getConnectedOrganizationId())
      : normalizeOptional(env.VIVD_TENANT_ID || env.TENANT_ID);
  const studioAccessToken = normalizeOptional(env.STUDIO_ACCESS_TOKEN);

  if (!backendUrl || !studioId || !studioAccessToken) {
    return null;
  }

  return {
    backendUrl,
    studioId,
    organizationId,
    studioAccessToken,
    projectSlug: normalizeOptional(env.VIVD_PROJECT_SLUG),
    projectVersion: normalizeProjectVersion(env.VIVD_PROJECT_VERSION),
  };
}

export function validateConnectedStudioBackendClientConfig(
  config: Partial<ConnectedStudioBackendClientConfig> | null | undefined,
): ConnectedStudioBackendClientValidation {
  const missing: string[] = [];
  if (!config?.backendUrl) missing.push("MAIN_BACKEND_URL");
  if (!config?.studioId) missing.push("STUDIO_ID");
  if (!config?.studioAccessToken) missing.push("STUDIO_ACCESS_TOKEN");

  return {
    ok: missing.length === 0,
    missing,
  };
}

export function buildConnectedStudioBackendHeaders(
  config: ConnectedStudioBackendClientConfig,
  options?: { includeContentType?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (options?.includeContentType !== false) {
    headers["Content-Type"] = "application/json";
  }
  headers["x-vivd-studio-id"] = config.studioId;
  if (config.studioAccessToken) {
    headers["x-vivd-studio-token"] = config.studioAccessToken;
  }
  if (config.organizationId) {
    headers["x-vivd-organization-id"] = config.organizationId;
  }

  return headers;
}

export function unwrapTrpcJsonBody<T>(body: unknown): T {
  const payload = body as
    | {
        result?: {
          data?: unknown;
        };
      }
    | undefined;
  const data = payload?.result?.data;
  if (isRecord(data) && "json" in data) {
    return (data as { json?: T }).json as T;
  }
  return (data as T | undefined) ?? (body as T);
}

async function readFailedResponseBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.trim() || "Unknown error";
}

export class ConnectedStudioBackendClient {
  private readonly config: ConnectedStudioBackendClientConfig;

  constructor(config: ConnectedStudioBackendClientConfig) {
    this.config = config;
  }

  get runtime() {
    return this.config;
  }

  async query<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
    const url = `${this.config.backendUrl}/api/trpc/${procedure}?input=${encodeURIComponent(
      JSON.stringify(input),
    )}`;
    const response = await fetch(url, {
      method: "GET",
      headers: buildConnectedStudioBackendHeaders(this.config, {
        includeContentType: false,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `${procedure} failed (${response.status}): ${await readFailedResponseBody(response)}`,
      );
    }
    return unwrapTrpcJsonBody<T>(await response.json());
  }

  async mutation<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.config.backendUrl}/api/trpc/${procedure}`, {
      method: "POST",
      headers: buildConnectedStudioBackendHeaders(this.config),
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(
        `${procedure} failed (${response.status}): ${await readFailedResponseBody(response)}`,
      );
    }
    return unwrapTrpcJsonBody<T>(await response.json());
  }
}

export function createConnectedStudioBackendClient(
  config: ConnectedStudioBackendClientConfig,
): ConnectedStudioBackendClient {
  return new ConnectedStudioBackendClient(config);
}
