export function toAstroRuntimeAssetPath(
  assetPath: string,
  baseline: string | null,
): string {
  const normalizedPath = assetPath.replace(/\\/g, "/").replace(/^\/+/, "");

  let runtimePath = normalizedPath;
  if (
    normalizedPath === "src/content/media" ||
    normalizedPath.startsWith("src/content/media/")
  ) {
    const mediaRelativePath = normalizedPath
      .slice("src/content/media".length)
      .replace(/^\/+/, "");
    runtimePath = mediaRelativePath ? `media/${mediaRelativePath}` : "media";
  } else if (normalizedPath.startsWith("public/")) {
    runtimePath = normalizedPath.slice("public/".length);
  }

  return (baseline ?? "").startsWith("/") ? `/${runtimePath}` : runtimePath;
}
