import { resolveStudioRuntimePath } from "@/lib/studioAuth";
import type { FileTreeNode } from "../asset-explorer/types";

interface ResolvePreviewImageAssetInput {
  projectSlug: string;
  version: number;
  previewRootUrl?: string | null;
  assets: FileTreeNode[];
  imageUrls: Array<string | null | undefined>;
}

function normalizeAssetPath(value: string): string {
  let normalized = value.trim();
  if (!normalized) return "";

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the original value if it is not valid URI encoding.
  }

  return normalized.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

function flattenImageAssets(nodes: FileTreeNode[]): FileTreeNode[] {
  const result: FileTreeNode[] = [];

  for (const node of nodes) {
    if (node.type === "file" && node.isImage) {
      result.push(node);
      continue;
    }

    if (node.type === "folder" && node.children?.length) {
      result.push(...flattenImageAssets(node.children));
    }
  }

  return result;
}

function getPreviewPrefixes(
  projectSlug: string,
  version: number,
  previewRootUrl?: string | null,
): string[] {
  const prefixes = [
    resolveStudioRuntimePath(
      `/vivd-studio/api/projects/${encodeURIComponent(projectSlug)}/v${version}`,
    ),
    resolveStudioRuntimePath(
      `/vivd-studio/api/preview/${encodeURIComponent(projectSlug)}/v${version}`,
    ),
    resolveStudioRuntimePath(
      `/vivd-studio/api/devpreview/${encodeURIComponent(projectSlug)}/v${version}`,
    ),
  ];

  if (previewRootUrl) {
    try {
      prefixes.push(new URL(previewRootUrl, window.location.origin).pathname);
    } catch {
      // Ignore invalid preview roots and rely on the known runtime prefixes.
    }
  }

  return prefixes
    .map((prefix) => prefix.replace(/\/+$/, ""))
    .filter(Boolean);
}

function toCandidatePaths(
  imageUrl: string,
  projectSlug: string,
  version: number,
  previewRootUrl?: string | null,
): string[] {
  const raw = imageUrl.trim();
  if (!raw) return [];
  if (/^(?:data|blob|javascript|mailto):/i.test(raw)) return [];

  const candidates = new Set<string>();

  const addCandidate = (value: string) => {
    const normalized = normalizeAssetPath(value);
    if (!normalized) return;

    candidates.add(normalized);

    if (normalized.startsWith("public/")) {
      const withoutPublic = normalizeAssetPath(normalized.slice("public/".length));
      if (withoutPublic) candidates.add(withoutPublic);
      return;
    }

    candidates.add(normalizeAssetPath(`public/${normalized}`));
  };

  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return [];

    let pathname = url.pathname;
    for (const prefix of getPreviewPrefixes(projectSlug, version, previewRootUrl)) {
      if (pathname === prefix) {
        pathname = "";
        break;
      }

      if (pathname.startsWith(`${prefix}/`)) {
        pathname = pathname.slice(prefix.length);
        break;
      }
    }

    addCandidate(pathname);
  } catch {
    const stripped = raw.split("#", 1)[0]?.split("?", 1)[0] ?? "";
    addCandidate(stripped);
  }

  return Array.from(candidates);
}

export function resolvePreviewImageAsset({
  projectSlug,
  version,
  previewRootUrl,
  assets,
  imageUrls,
}: ResolvePreviewImageAssetInput): FileTreeNode | null {
  const imageAssets = flattenImageAssets(assets);
  if (!imageAssets.length) return null;

  const assetByPath = new Map(
    imageAssets.map((asset) => [normalizeAssetPath(asset.path), asset] as const),
  );

  for (const imageUrl of imageUrls) {
    if (!imageUrl) continue;

    for (const candidate of toCandidatePaths(
      imageUrl,
      projectSlug,
      version,
      previewRootUrl,
    )) {
      const match = assetByPath.get(candidate);
      if (match) return match;
    }
  }

  return null;
}
