function inferSchemeForHost(host: string): "http" | "https" {
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".nip.io")
  ) {
    return "http";
  }

  return "https";
}

function normalizeOrigin(value: string | null | undefined): string {
  if (!value) return "";

  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }

  const scheme = inferSchemeForHost(trimmed);
  return `${scheme}://${trimmed}`.replace(/\/+$/, "");
}

function normalizeHost(value: string | null | undefined): string {
  if (!value) return "";

  const trimmed = value.trim();
  if (!trimmed) return "";

  if (!trimmed.includes("://")) {
    return trimmed.toLowerCase();
  }

  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function isVivdManagedHost(hostname: string): boolean {
  return hostname === "vivd.studio" || hostname.endsWith(".vivd.studio");
}

function deriveDocsHost(host: string): string | null {
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!hostname) return "docs.vivd.studio";

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "docs.localhost";
  }

  if (hostname.endsWith(".local") || hostname.endsWith(".nip.io")) {
    const firstDot = hostname.indexOf(".");
    if (firstDot === -1) return null;
    const baseDomain = hostname.slice(firstDot + 1).trim();
    return baseDomain ? `docs.${baseDomain}` : null;
  }

  const firstDot = hostname.indexOf(".");
  if (firstDot === -1) {
    return isVivdManagedHost(hostname) ? "docs.vivd.studio" : null;
  }

  if (hostname.startsWith("docs.")) {
    return hostname;
  }

  if (!isVivdManagedHost(hostname)) {
    return null;
  }

  const baseDomain = hostname.slice(firstDot + 1).trim();
  if (!baseDomain) return "docs.vivd.studio";

  return `docs.${baseDomain}`;
}

export function buildDocsUrl(options?: {
  currentHost?: string | null;
  controlPlaneHost?: string | null;
  publicDocsBaseUrl?: string | null;
  pathname?: string;
}): string {
  const explicitBaseUrl = normalizeOrigin(options?.publicDocsBaseUrl);
  const preferredHost = normalizeHost(options?.controlPlaneHost);
  const currentHost = normalizeHost(options?.currentHost);
  const sourceHost = preferredHost || currentHost || "docs.vivd.studio";
  const pathname = options?.pathname ?? "/";
  const derivedHost = explicitBaseUrl ? null : deriveDocsHost(sourceHost);
  const baseUrl =
    explicitBaseUrl ||
    (derivedHost
      ? `${inferSchemeForHost(derivedHost)}://${derivedHost}`
      : "https://docs.vivd.studio");

  return new URL(pathname, `${baseUrl}/`).toString();
}

export function getDocsUrl(pathname = "/"): string {
  return buildDocsUrl({
    currentHost: typeof window !== "undefined" ? window.location.host : null,
    pathname,
  });
}
