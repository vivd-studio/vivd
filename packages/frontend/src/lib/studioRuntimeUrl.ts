function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function getCurrentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.origin;
}

function resolveRuntimeBaseUrl(baseUrl: string): URL {
  const currentOrigin = getCurrentOrigin() ?? "http://localhost";
  const resolved = new URL(baseUrl, ensureTrailingSlash(currentOrigin));
  if (
    !resolved.pathname.endsWith("/") &&
    !/\.[a-z0-9]+$/i.test(resolved.pathname)
  ) {
    resolved.pathname = `${resolved.pathname}/`;
  }
  return resolved;
}

export function resolveStudioRuntimeUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(normalizedPath, resolveRuntimeBaseUrl(baseUrl)).toString();
}
