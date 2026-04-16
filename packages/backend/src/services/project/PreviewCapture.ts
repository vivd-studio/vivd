import path from "node:path";

export function normalizePreviewCapturePath(
  rawPath: string | null | undefined,
): string {
  const trimmed = rawPath?.trim() || "/";
  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error("Preview path must be preview-relative, not a full URL");
  }

  const normalized = trimmed.startsWith("/")
    ? trimmed
    : `/${trimmed.replace(/^\/+/, "")}`;
  const parsed = new URL(normalized, "https://vivd.invalid");
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function resolvePreviewCaptureBaseUrl(options: {
  controlPlaneMode: "path_based" | "host_based";
  backendUrl?: string | null;
  runtimeUrl?: string | null;
  compatibilityUrl?: string | null;
  url: string;
}): string {
  const backendUrl = options.backendUrl?.trim() || null;
  const runtimeUrl = options.runtimeUrl?.trim() || null;
  const compatibilityUrl = options.compatibilityUrl?.trim() || null;

  const browserBaseUrl =
    options.controlPlaneMode === "path_based" && compatibilityUrl
      ? compatibilityUrl
      : runtimeUrl || compatibilityUrl || options.url;

  if (
    backendUrl &&
    isLocalPreviewOrigin(browserBaseUrl) &&
    !isLocalPreviewOrigin(backendUrl)
  ) {
    return backendUrl;
  }

  return browserBaseUrl || backendUrl || options.url;
}

export function resolvePreviewCaptureUrl(
  baseUrl: string,
  requestedPath: string,
): string {
  const base = new URL(baseUrl);
  const parsedPath = new URL(requestedPath, "https://vivd.invalid");
  const basePathname = base.pathname.replace(/\/+$/, "") || "/";

  base.pathname = path.posix.join(basePathname, parsedPath.pathname);
  base.search = parsedPath.search;
  base.hash = parsedPath.hash;
  return base.toString();
}

function isLocalPreviewOrigin(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
