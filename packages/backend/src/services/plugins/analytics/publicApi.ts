import { getPublicPluginApiBaseUrl } from "../contactForm/publicApi";

export function getAnalyticsScriptEndpoint(): string {
  return `${getPublicPluginApiBaseUrl()}/plugins/analytics/v1/script.js`;
}

export function getAnalyticsTrackEndpoint(): string {
  return `${getPublicPluginApiBaseUrl()}/plugins/analytics/v1/track`;
}
