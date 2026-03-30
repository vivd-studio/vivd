export const VIVD_STUDIO_TOKEN_HEADER = "x-vivd-studio-token";
export const VIVD_STUDIO_TOKEN_PARAM = "vivdStudioToken";

const STUDIO_ROOT_PATH = "/vivd-studio";

let cachedToken: string | null | undefined;

function normalizeRuntimeBasePath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed === "/" ? "" : trimmed;
}

function getInjectedRuntimeBasePath(): string {
  const runtimeBasePath = (window as Window & { __vivdBasePath?: unknown })
    .__vivdBasePath;
  if (typeof runtimeBasePath !== "string" || !runtimeBasePath.startsWith("/")) {
    return "";
  }
  return normalizeRuntimeBasePath(runtimeBasePath);
}

export function getStudioRuntimeBasePath(): string {
  const fromInjected = getInjectedRuntimeBasePath();
  if (fromInjected) return fromInjected;

  const pathname = window.location.pathname ?? "";
  const markerIndex = pathname.indexOf(STUDIO_ROOT_PATH);
  if (markerIndex <= 0) return "";

  return normalizeRuntimeBasePath(pathname.slice(0, markerIndex));
}

function shouldPrefixStudioRuntimePath(pathname: string): boolean {
  return (
    pathname === STUDIO_ROOT_PATH ||
    pathname.startsWith(`${STUDIO_ROOT_PATH}/`)
  );
}

export function resolveStudioRuntimePath(urlOrPath: string): string {
  try {
    const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrPath);
    const url = new URL(urlOrPath, window.location.origin);

    if (url.origin !== window.location.origin) return urlOrPath;

    const runtimeBasePath = getStudioRuntimeBasePath();
    if (
      runtimeBasePath &&
      shouldPrefixStudioRuntimePath(url.pathname) &&
      url.pathname !== runtimeBasePath &&
      !url.pathname.startsWith(`${runtimeBasePath}/`)
    ) {
      url.pathname = `${runtimeBasePath}${url.pathname}`;
    }

    return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return urlOrPath;
  }
}

export function getVivdStudioToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;

  const fromHash = (() => {
    const raw = window.location.hash?.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash || "";
    if (!raw) return null;
    const params = new URLSearchParams(raw);
    const token = params.get(VIVD_STUDIO_TOKEN_PARAM);
    return token?.trim() ? token.trim() : null;
  })();

  if (fromHash) {
    cachedToken = fromHash;
    return fromHash;
  }

  // Backwards-compat: allow the token in query params as a fallback.
  const fromQuery = (() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get(VIVD_STUDIO_TOKEN_PARAM);
    return token?.trim() ? token.trim() : null;
  })();

  cachedToken = fromQuery;
  return fromQuery;
}

export function withVivdStudioTokenQuery(urlOrPath: string, token?: string | null): string {
  const resolvedUrlOrPath = resolveStudioRuntimePath(urlOrPath);
  const value = token?.trim();
  if (!value) return resolvedUrlOrPath;

  try {
    const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(resolvedUrlOrPath);
    const url = new URL(resolvedUrlOrPath, window.location.origin);

    // Don't attach studio secrets to other origins.
    if (url.origin !== window.location.origin) return resolvedUrlOrPath;

    url.searchParams.set(VIVD_STUDIO_TOKEN_PARAM, value);
    return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return resolvedUrlOrPath;
  }
}
