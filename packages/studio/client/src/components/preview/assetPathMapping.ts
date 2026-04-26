export function toAstroRuntimeAssetPath(
  assetPath: string,
  baseline: string | null,
): string | null {
  const normalizedPath = assetPath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (
    normalizedPath === "src/content/media" ||
    normalizedPath.startsWith("src/content/media/")
  ) {
    return null;
  }

  if (normalizedPath !== "public" && !normalizedPath.startsWith("public/")) {
    return null;
  }

  const runtimePath = normalizedPath.slice("public/".length);
  return (baseline ?? "").startsWith("/") ? `/${runtimePath}` : runtimePath;
}
