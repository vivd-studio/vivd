const DEFAULT_PUBLIC_PLUGIN_API_BASE_URL = "https://api.vivd.studio";

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_PUBLIC_PLUGIN_API_BASE_URL;

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  return withProtocol.replace(/\/+$/, "");
}

export function getPublicPluginApiBaseUrl(): string {
  return normalizeBaseUrl(process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL || "");
}

export function getContactFormSubmitEndpoint(): string {
  return `${getPublicPluginApiBaseUrl()}/plugins/contact/v1/submit`;
}
