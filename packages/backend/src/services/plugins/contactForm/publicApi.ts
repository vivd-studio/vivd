import { installProfileService } from "../../system/InstallProfileService";

const DEFAULT_PUBLIC_PLUGIN_API_BASE_URL = "https://api.vivd.studio";
const CONTACT_RECIPIENT_VERIFY_CONTROL_PLANE_PATH =
  "/vivd-studio/api/plugins/contact/v1/recipient-verify";

export class ContactRecipientVerificationEndpointUnavailableError extends Error {
  constructor() {
    super(
      "Recipient verification link is unavailable because no control-plane origin could be resolved.",
    );
    this.name = "ContactRecipientVerificationEndpointUnavailableError";
  }
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_PUBLIC_PLUGIN_API_BASE_URL;

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  return withProtocol.replace(/\/+$/, "");
}

function normalizeBaseUrlOrEmpty(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return normalizeBaseUrl(trimmed);
}

function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return withProtocol.replace(/\/+$/, "");
  }
}

function normalizeHost(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const firstValue = trimmed.split(",")[0]?.trim() ?? "";
  if (!firstValue) return "";

  try {
    const parsed = /^https?:\/\//i.test(firstValue)
      ? new URL(firstValue)
      : new URL(`https://${firstValue}`);
    return parsed.host;
  } catch {
    return firstValue.replace(/\/+$/, "");
  }
}

function extractHostname(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.startsWith("[")) {
    const closingIndex = normalized.indexOf("]");
    return closingIndex > 0 ? normalized.slice(1, closingIndex) : normalized;
  }
  return normalized.split(":")[0] || "";
}

function isLocalHost(host: string): boolean {
  const hostname = extractHostname(host);
  if (!hostname) return false;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost")
  );
}

function toHostOrigin(rawHost: string): string {
  const host = normalizeHost(rawHost);
  if (!host) return "";
  const scheme = isLocalHost(host) ? "http" : "https";
  return `${scheme}://${host}`;
}

function getControlPlaneOrigin(options?: {
  requestHost?: string | null;
}): string {
  const requestHost = options?.requestHost?.trim();
  if (requestHost) {
    const requestOrigin = toHostOrigin(requestHost);
    if (requestOrigin) return requestOrigin;
  }

  const appOrigin = normalizeOrigin(process.env.VIVD_APP_URL || "");
  if (appOrigin) return appOrigin;

  const controlPlaneHostOrigin = toHostOrigin(process.env.CONTROL_PLANE_HOST || "");
  if (controlPlaneHostOrigin) return controlPlaneHostOrigin;

  const domainOrigin = normalizeOrigin(process.env.DOMAIN || "");
  if (domainOrigin) return domainOrigin;

  const betterAuthOrigin = normalizeOrigin(process.env.BETTER_AUTH_URL || "");
  if (betterAuthOrigin) return betterAuthOrigin;

  return "";
}

export async function getPublicPluginApiBaseUrl(options?: {
  requestHost?: string | null;
}): Promise<string> {
  const explicitBaseUrl = normalizeBaseUrlOrEmpty(
    process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL || "",
  );
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const instancePolicy = await installProfileService.resolvePolicy();
  if (instancePolicy.pluginRuntime.mode === "same_host_path") {
    const preferredHost =
      normalizeHost(options?.requestHost || "") ||
      normalizeHost(process.env.DOMAIN || "") ||
      normalizeHost(process.env.CONTROL_PLANE_HOST || "") ||
      normalizeHost(process.env.BETTER_AUTH_URL || "");
    if (preferredHost) {
      return toHostOrigin(preferredHost);
    }
  }

  const dedicatedHost =
    normalizeHost(process.env.VIVD_PUBLIC_PLUGIN_API_HOST || "") || "api.vivd.studio";
  if (dedicatedHost) {
    return toHostOrigin(dedicatedHost);
  }

  return normalizeBaseUrl(DEFAULT_PUBLIC_PLUGIN_API_BASE_URL);
}

export async function getContactFormSubmitEndpoint(options?: {
  requestHost?: string | null;
}): Promise<string> {
  return `${await getPublicPluginApiBaseUrl(options)}/plugins/contact/v1/submit`;
}

export function getContactRecipientVerificationEndpoint(options?: {
  requestHost?: string | null;
}): string {
  const controlPlaneOrigin = getControlPlaneOrigin(options);
  if (controlPlaneOrigin) {
    return `${controlPlaneOrigin}${CONTACT_RECIPIENT_VERIFY_CONTROL_PLANE_PATH}`;
  }

  throw new ContactRecipientVerificationEndpointUnavailableError();
}

export async function getEmailFeedbackEndpoint(
  provider: string = "ses",
  options?: { requestHost?: string | null },
): Promise<string> {
  const normalizedProvider = provider.trim().toLowerCase() || "ses";
  return `${await getPublicPluginApiBaseUrl(options)}/email/v1/feedback/${normalizedProvider}`;
}
