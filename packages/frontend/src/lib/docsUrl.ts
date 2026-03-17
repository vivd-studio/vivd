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

function deriveDocsHost(host: string): string {
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!hostname) return "docs.vivd.studio";

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "docs.localhost";
  }

  const firstDot = hostname.indexOf(".");
  if (firstDot === -1) return "docs.vivd.studio";

  if (hostname.startsWith("docs.")) {
    return hostname;
  }

  const baseDomain = hostname.slice(firstDot + 1).trim();
  if (!baseDomain) return "docs.vivd.studio";

  return `docs.${baseDomain}`;
}

export function buildDocsUrl(options?: {
  currentHost?: string | null;
  controlPlaneHost?: string | null;
  pathname?: string;
}): string {
  const preferredHost = normalizeHost(options?.controlPlaneHost);
  const currentHost = normalizeHost(options?.currentHost);
  const sourceHost = preferredHost || currentHost || "docs.vivd.studio";
  const docsHost = deriveDocsHost(sourceHost);
  const scheme = inferSchemeForHost(docsHost);
  const pathname = options?.pathname ?? "/";

  return `${scheme}://${docsHost}${pathname}`;
}

export function getDocsUrl(pathname = "/"): string {
  return buildDocsUrl({
    currentHost: typeof window !== "undefined" ? window.location.host : null,
    pathname,
  });
}
