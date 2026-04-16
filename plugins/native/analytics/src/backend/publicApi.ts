function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function getAnalyticsScriptEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/plugins/analytics/v1/script.js`;
}

export function getAnalyticsTrackEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/plugins/analytics/v1/track`;
}
