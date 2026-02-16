export const VIVD_STUDIO_TOKEN_HEADER = "x-vivd-studio-token";
export const VIVD_STUDIO_TOKEN_PARAM = "vivdStudioToken";

let cachedToken: string | null | undefined;

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
  const value = token?.trim();
  if (!value) return urlOrPath;

  try {
    const isAbsolute = /^https?:\/\//i.test(urlOrPath);
    const url = new URL(urlOrPath, window.location.origin);

    // Don't attach studio secrets to other origins.
    if (url.origin !== window.location.origin) return urlOrPath;

    url.searchParams.set(VIVD_STUDIO_TOKEN_PARAM, value);
    return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return urlOrPath;
  }
}

