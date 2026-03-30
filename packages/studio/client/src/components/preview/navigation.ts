import type { PreviewMode, ViewportMode } from "./types";

export const CHAT_OPEN_STORAGE_KEY = "previewModal.chatOpen";
export const ASSETS_OPEN_STORAGE_KEY = "previewModal.assetsOpen";
export const VIEWPORT_MODE_STORAGE_KEY = "previewModal.viewportMode";

export interface PanelOpenState {
  chatOpen: boolean;
  assetsOpen: boolean;
}

function stripInternalPreviewSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete("_vivd");
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}

function stripInternalPreviewHash(hash: string): string {
  if (!hash.startsWith("#") || !hash.includes("_vivd=")) return hash;

  const fragment = hash.slice(1);
  const queryIndex = fragment.indexOf("?");
  if (queryIndex < 0) return hash;

  const fragmentPath = fragment.slice(0, queryIndex);
  const fragmentSearch = fragment.slice(queryIndex + 1);
  const nextSearch = stripInternalPreviewSearch(fragmentSearch);

  if (!nextSearch) {
    return fragmentPath ? `#${fragmentPath}` : "#";
  }

  return `#${fragmentPath}${nextSearch}`;
}

export function getDesktopPaneOrder(state: PanelOpenState): Array<"chat" | "assets" | "preview"> {
  const order: Array<"chat" | "assets" | "preview"> = [];
  if (state.chatOpen) order.push("chat");
  if (state.assetsOpen) order.push("assets");
  order.push("preview");
  return order;
}

function readBooleanStorageValue(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
): boolean | null {
  const value = storage?.getItem(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function getInitialPanelOpenState(
  storage: Pick<Storage, "getItem"> | undefined,
): PanelOpenState {
  return {
    chatOpen: readBooleanStorageValue(storage, CHAT_OPEN_STORAGE_KEY) ?? true,
    assetsOpen: readBooleanStorageValue(storage, ASSETS_OPEN_STORAGE_KEY) ?? false,
  };
}

export function getInitialViewportMode(
  storage: Pick<Storage, "getItem"> | undefined,
): ViewportMode {
  const stored = storage?.getItem(VIEWPORT_MODE_STORAGE_KEY);
  return stored === "desktop" || stored === "tablet" || stored === "mobile"
    ? stored
    : "desktop";
}

export function normalizePreviewPathInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "/";

  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      candidate = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "/";
    }
  }

  if (candidate.startsWith("?") || candidate.startsWith("#")) {
    candidate = `/${candidate}`;
  }

  if (!candidate.startsWith("/")) {
    candidate = `/${candidate}`;
  }

  const hashIndex = candidate.indexOf("#");
  const beforeHash = hashIndex >= 0 ? candidate.slice(0, hashIndex) : candidate;
  const hash = hashIndex >= 0 ? candidate.slice(hashIndex) : "";
  const queryIndex = beforeHash.indexOf("?");
  const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const search = queryIndex >= 0 ? beforeHash.slice(queryIndex) : "";
  const normalizedPathname = pathname.replace(/\/{2,}/g, "/") || "/";
  const normalizedSearch = stripInternalPreviewSearch(search);
  const normalizedHash = stripInternalPreviewHash(hash);

  return `${normalizedPathname}${normalizedSearch}${normalizedHash}`;
}

export function getPreviewRootUrl(
  baseUrl: string,
  previewMode: PreviewMode,
): string {
  if (!baseUrl) return "";

  if (previewMode === "static") {
    try {
      const url = new URL(baseUrl, window.location.href);
      if (/\/index\.html?$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/index\.html?$/i, "/");
      } else if (
        !url.pathname.endsWith("/") &&
        !/\.[a-z0-9]+$/i.test(url.pathname)
      ) {
        url.pathname = `${url.pathname}/`;
      }
      return url.toString();
    } catch {
      const normalized = baseUrl.replace(/\/index\.html?$/i, "/");
      if (normalized.endsWith("/") || /\.[a-z0-9]+$/i.test(normalized)) {
        return normalized;
      }
      return `${normalized}/`;
    }
  }

  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function buildPreviewUrl(
  previewRootUrl: string,
  previewPath: string,
): string {
  if (!previewRootUrl) return "";

  const normalizedPath = normalizePreviewPathInput(previewPath);
  const root = new URL(previewRootUrl, window.location.href);

  if (normalizedPath === "/") {
    return root.toString();
  }

  const [pathWithSearch, hash = ""] = normalizedPath.split("#", 2);
  const [pathnamePart, search = ""] = pathWithSearch.split("?", 2);
  const relativePath = pathnamePart.replace(/^\/+/, "");
  const target = new URL(relativePath, root);

  target.search = search ? `?${search}` : "";
  target.hash = hash ? `#${hash}` : "";
  return target.toString();
}

export function buildCacheBustedPreviewUrl(src: string, cacheBustValue: string): string {
  if (!src) return src;

  try {
    const target = new URL(src, window.location.href);
    target.hash = stripInternalPreviewHash(target.hash);
    target.searchParams.set("_vivd", cacheBustValue);
    return target.toString();
  } catch {
    const hashIndex = src.indexOf("#");
    const beforeHash = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
    const hash = hashIndex >= 0 ? src.slice(hashIndex) : "";
    const queryIndex = beforeHash.indexOf("?");
    const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
    const search = queryIndex >= 0 ? beforeHash.slice(queryIndex) : "";
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    params.set("_vivd", cacheBustValue);
    const nextSearch = params.toString();

    return `${pathname}${nextSearch ? `?${nextSearch}` : ""}${stripInternalPreviewHash(hash)}`;
  }
}

export function getPreviewPathFromUrl(
  href: string,
  previewRootUrl: string,
): string {
  if (!href || !previewRootUrl) return "/";

  try {
    const root = new URL(previewRootUrl, window.location.href);
    const current = new URL(href, root);

    if (root.origin !== current.origin) {
      return "/";
    }

    let relativePath = current.pathname;
    if (relativePath.startsWith(root.pathname)) {
      relativePath = relativePath.slice(root.pathname.length);
    } else {
      return normalizePreviewPathInput(
        `${current.pathname}${current.search}${current.hash}`,
      );
    }

    relativePath = relativePath.replace(/^\/+/, "");
    if (relativePath === "" || relativePath === "index.html") {
      relativePath = "/";
    } else if (relativePath.endsWith("/index.html")) {
      relativePath = `/${relativePath.slice(0, -"index.html".length)}`;
    } else {
      relativePath = `/${relativePath}`;
    }

    return normalizePreviewPathInput(
      `${relativePath}${stripInternalPreviewSearch(current.search)}${stripInternalPreviewHash(current.hash)}`,
    );
  } catch {
    return "/";
  }
}
