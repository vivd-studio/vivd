import type express from "express";
import {
  getBackendUrl,
  getConnectedOrganizationId,
  getStudioId,
  isConnectedMode,
} from "@vivd/shared";
import { STUDIO_USER_ACTION_TOKEN_HEADER } from "@vivd/shared/studio";
import { getStudioUserActionToken } from "../http/studioAuth.js";

export type ConnectedUserActionAuthConfig = {
  backendUrl: string;
  studioId: string;
  organizationId?: string;
  userActionToken: string;
};

export function getConnectedUserActionAuthConfig(
  req: express.Request | undefined,
): ConnectedUserActionAuthConfig | null {
  if (!isConnectedMode()) return null;
  if (!req) return null;

  const backendUrl = getBackendUrl()?.trim();
  const studioId = getStudioId()?.trim();
  const organizationId = getConnectedOrganizationId()?.trim() || undefined;
  const userActionToken = getStudioUserActionToken(req)?.trim() || "";

  if (!backendUrl || !studioId || !userActionToken) return null;

  return {
    backendUrl,
    studioId,
    organizationId,
    userActionToken,
  };
}

export function buildConnectedUserActionHeaders(
  config: ConnectedUserActionAuthConfig,
  options?: { includeContentType?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options?.includeContentType !== false) {
    headers["Content-Type"] = "application/json";
  }
  headers[STUDIO_USER_ACTION_TOKEN_HEADER] = config.userActionToken;
  if (config.organizationId) {
    headers["x-vivd-organization-id"] = config.organizationId;
  }
  return headers;
}
