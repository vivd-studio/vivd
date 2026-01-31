import sharp from "sharp";
import path from "path";
import { WEBP_QUALITY } from "../generator/config";

/**
 * Image extensions that should be converted to WebP.
 * GIF is excluded to preserve animations.
 */
export const CONVERTIBLE_IMAGE_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".tiff",
  ".tif",
  ".bmp",
  ".webp",
];

/**
 * Check if a file extension is convertible to WebP.
 */
export function isConvertibleImage(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return CONVERTIBLE_IMAGE_EXTS.includes(ext);
}

/**
 * Convert filename extension to .webp if it's a convertible image.
 * Returns the original filename if not convertible or already .webp.
 */
export function convertFilenameToWebp(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (CONVERTIBLE_IMAGE_EXTS.includes(ext) && ext !== ".webp") {
    return filename.replace(/\.[^.]+$/, ".webp");
  }
  return filename;
}

/**
 * Process an image buffer - converts to WebP if applicable, otherwise returns original.
 * @param buffer - The image file buffer
 * @param filename - Original filename (used to determine if conversion is needed)
 * @param quality - WebP quality (default: 85)
 * @returns The processed buffer (WebP if converted, original otherwise)
 */
export async function processImageBuffer(
  buffer: Buffer,
  filename: string,
  quality = WEBP_QUALITY
): Promise<Buffer> {
  if (isConvertibleImage(filename)) {
    return await sharp(buffer).webp({ quality }).toBuffer();
  }
  return buffer;
}

/**
 * Write an image to disk, converting to WebP if applicable.
 * @param buffer - The image file buffer
 * @param filename - Original filename (used to determine if conversion is needed)
 * @param outputPath - Full path where the file should be written
 * @param quality - WebP quality (default: 85)
 */
export async function writeImageFile(
  buffer: Buffer,
  filename: string,
  outputPath: string,
  quality = WEBP_QUALITY
): Promise<void> {
  if (isConvertibleImage(filename)) {
    await sharp(buffer).webp({ quality }).toFile(outputPath);
  } else {
    const fs = await import("fs");
    fs.writeFileSync(outputPath, buffer);
  }
}
