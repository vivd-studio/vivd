import {
  getBackendUrl,
  getConnectedOrganizationId,
  getSessionToken,
  getStudioId,
  isConnectedMode,
} from "@vivd/shared";

export type ConnectedBackendAuthConfig = {
  backendUrl: string;
  studioId: string;
  organizationId?: string;
  sessionToken?: string;
  studioAccessToken?: string;
};

export function getConnectedBackendAuthConfig(): ConnectedBackendAuthConfig | null {
  if (!isConnectedMode()) return null;

  const backendUrl = getBackendUrl()?.trim();
  const studioId = getStudioId()?.trim();
  const organizationId = getConnectedOrganizationId()?.trim() || undefined;
  const sessionToken = getSessionToken()?.trim() || undefined;
  const studioAccessToken = process.env.STUDIO_ACCESS_TOKEN?.trim() || undefined;

  if (!backendUrl || !studioId) return null;
  if (!sessionToken && !studioAccessToken) return null;

  return {
    backendUrl,
    studioId,
    organizationId,
    sessionToken,
    studioAccessToken,
  };
}

export function buildConnectedBackendHeaders(
  config: ConnectedBackendAuthConfig,
  options?: { includeContentType?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (options?.includeContentType !== false) {
    headers["Content-Type"] = "application/json";
  }
  if (config.sessionToken) {
    headers.Authorization = `Bearer ${config.sessionToken}`;
  }
  if (config.organizationId) {
    headers["x-vivd-organization-id"] = config.organizationId;
  }
  if (config.studioAccessToken) {
    headers["x-vivd-studio-token"] = config.studioAccessToken;
  }
  headers["x-vivd-studio-id"] = config.studioId;

  return headers;
}
