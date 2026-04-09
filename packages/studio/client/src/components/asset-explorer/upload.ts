import {
  getVivdStudioToken,
  resolveStudioRuntimePath,
  VIVD_STUDIO_TOKEN_HEADER,
} from "@/lib/studioAuth";

const OPTIMIZED_WORKING_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".tif",
  ".tiff",
  ".bmp",
  ".webp",
]);

export function shouldShowWorkingImageOptimization(
  files: FileList | File[],
  targetPath: string,
): boolean {
  const normalizedTargetPath = targetPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    normalizedTargetPath !== ".vivd/uploads" &&
    normalizedTargetPath !== ".vivd/dropped-images"
  ) {
    return false;
  }

  return Array.from(files).some((file) => {
    const lowerName = file.name.toLowerCase();
    const extension = lowerName.slice(lowerName.lastIndexOf("."));
    return OPTIMIZED_WORKING_IMAGE_EXTENSIONS.has(extension);
  });
}

export async function uploadFilesToStudioPath(options: {
  projectSlug: string;
  version: number;
  targetPath: string;
  files: FileList | File[];
}): Promise<string[]> {
  const { projectSlug, version, targetPath, files } = options;
  const normalizedFiles = Array.from(files);
  if (normalizedFiles.length === 0) {
    return [];
  }

  const token = getVivdStudioToken();
  const formData = new FormData();
  for (const file of normalizedFiles) {
    formData.append("files", file);
  }

  const headers = new Headers();
  if (token) {
    headers.set(VIVD_STUDIO_TOKEN_HEADER, token);
  }

  const response = await fetch(
    resolveStudioRuntimePath(
      `/vivd-studio/api/upload/${projectSlug}/${version}?path=${encodeURIComponent(targetPath)}`,
    ),
    {
      method: "POST",
      body: formData,
      headers,
    },
  );

  if (!response.ok) {
    throw new Error("Upload failed");
  }

  const payload = (await response.json()) as { uploaded?: unknown };
  return Array.isArray(payload.uploaded)
    ? payload.uploaded.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];
}
