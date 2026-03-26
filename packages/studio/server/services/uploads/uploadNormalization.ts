import path from "node:path";
import sharp from "sharp";
import {
  STUDIO_WORKING_IMAGE_UPLOAD_MAX_DIMENSION,
  STUDIO_WORKING_IMAGE_UPLOAD_WEBP_QUALITY,
} from "../../config.js";

const NORMALIZED_UPLOAD_ROOTS = [".vivd/uploads", ".vivd/dropped-images"];
const WEBP_NORMALIZED_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".tiff",
  ".tif",
  ".bmp",
  ".webp",
]);

export interface NormalizeStudioUploadResult {
  filename: string;
  buffer: Buffer;
  normalized: boolean;
}

export function shouldNormalizeStudioWorkingImageUpload(
  relativePath: string,
): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return NORMALIZED_UPLOAD_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
}

function shouldConvertUploadToWebp(filename: string): boolean {
  return WEBP_NORMALIZED_EXTS.has(path.extname(filename).toLowerCase());
}

function convertFilenameToWebp(filename: string): string {
  const ext = path.extname(filename);
  if (!ext) return `${filename}.webp`;
  return filename.replace(/\.[^.]+$/, ".webp");
}

export async function normalizeStudioWorkingImageUpload(options: {
  filename: string;
  buffer: Buffer;
}): Promise<NormalizeStudioUploadResult> {
  if (!shouldConvertUploadToWebp(options.filename)) {
    return {
      filename: options.filename,
      buffer: options.buffer,
      normalized: false,
    };
  }

  try {
    const image = sharp(options.buffer, { failOn: "none" }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const needsResize =
      width > STUDIO_WORKING_IMAGE_UPLOAD_MAX_DIMENSION ||
      height > STUDIO_WORKING_IMAGE_UPLOAD_MAX_DIMENSION;
    const alreadyWebp = path.extname(options.filename).toLowerCase() === ".webp";

    if (!needsResize && alreadyWebp) {
      return {
        filename: options.filename,
        buffer: options.buffer,
        normalized: false,
      };
    }

    const pipeline = needsResize
      ? image.resize({
          width: STUDIO_WORKING_IMAGE_UPLOAD_MAX_DIMENSION,
          height: STUDIO_WORKING_IMAGE_UPLOAD_MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
      : image;

    return {
      filename: convertFilenameToWebp(options.filename),
      buffer: await pipeline
        .webp({ quality: STUDIO_WORKING_IMAGE_UPLOAD_WEBP_QUALITY })
        .toBuffer(),
      normalized: true,
    };
  } catch {
    return {
      filename: options.filename,
      buffer: options.buffer,
      normalized: false,
    };
  }
}
