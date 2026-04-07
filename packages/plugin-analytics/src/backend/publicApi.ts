import { getPublicPluginApiBaseUrl } from "@vivd/plugin-contact-form/backend/publicApi";

export async function getAnalyticsScriptEndpoint(options?: {
  requestHost?: string | null;
}): Promise<string> {
  return `${await getPublicPluginApiBaseUrl(options)}/plugins/analytics/v1/script.js`;
}

export async function getAnalyticsTrackEndpoint(options?: {
  requestHost?: string | null;
}): Promise<string> {
  return `${await getPublicPluginApiBaseUrl(options)}/plugins/analytics/v1/track`;
}
