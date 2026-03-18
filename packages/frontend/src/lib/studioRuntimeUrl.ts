function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function getCurrentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.origin;
}

function isPathMountedRuntime(pathname: string): boolean {
  return pathname === "/_studio" || pathname.startsWith("/_studio/");
}

function resolveRuntimeBaseUrl(baseUrl: string): URL {
  const currentOrigin = getCurrentOrigin() ?? "http://localhost";
  const parsed = new URL(baseUrl, ensureTrailingSlash(currentOrigin));

  // Path-mounted studio runtimes should stay on the current host. The backend may
  // hand us a control-plane host like app.localhost, but for embedded paths the
  // route should resolve against whatever host the user is currently visiting.
  if (getCurrentOrigin() && isPathMountedRuntime(parsed.pathname)) {
    return new URL(ensureTrailingSlash(parsed.pathname), ensureTrailingSlash(currentOrigin));
  }

  return new URL(ensureTrailingSlash(parsed.toString()));
}

export function resolveStudioRuntimeUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(normalizedPath, resolveRuntimeBaseUrl(baseUrl)).toString();
}
