import * as crypto from "crypto";
import * as path from "path";
import sharp from "sharp";
import { log } from "./logger.js";
import { WEBP_QUALITY } from "../config.js";

// Domains that serve tracking pixels, ads, or analytics
const BLOCKED_DOMAINS = [
  "adservice.google.com",
  "googleads.g.doubleclick.net",
  "www.googleadservices.com",
  "pagead2.googlesyndication.com",
  "ad.doubleclick.net",
  "cm.g.doubleclick.net",
  "stats.g.doubleclick.net",
  "facebook.com/tr",
  "connect.facebook.net",
  "analytics.",
  "pixel.",
  "tracking.",
  "beacon.",
  ".cdn.ampproject.org",
];

export interface DownloadedImage {
  filename: string;
  data: string; // base64
  mimeType: string;
}

export async function downloadImage(
  url: string,
  preloaded?: { buffer: Buffer; mimeType: string }
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const contentType = preloaded?.mimeType || "image/jpeg";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let buffer: any = preloaded?.buffer;

    if (!buffer) {
      const response = await fetch(url);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    let mimeType = contentType;

    // Convert to WebP for raster images
    if (
      contentType.includes("jpeg") ||
      contentType.includes("png") ||
      contentType.includes("jpg")
    ) {
      try {
        buffer = await sharp(buffer).webp({ quality: WEBP_QUALITY }).toBuffer();
        mimeType = "image/webp";
      } catch (e) {
        log(`Failed to convert image to webp: ${e}`);
      }
    }

    return { buffer, mimeType };
  } catch (e) {
    log(`Failed to download image ${url}: ${e}`);
    return null;
  }
}

export function isBlockedDomain(url: string): boolean {
  return BLOCKED_DOMAINS.some((domain) => url.includes(domain));
}

export function sanitizeFilename(url: string, ext: string): string {
  let filename = path.basename(new URL(url).pathname);
  try {
    filename = decodeURIComponent(filename);
  } catch {
    // ignore
  }

  filename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

  const MAX_BASENAME_LENGTH = 180;
  if (filename.length > MAX_BASENAME_LENGTH) {
    const hash = crypto.createHash("md5").update(url).digest("hex").slice(0, 8);
    const truncatedPart = filename.slice(0, MAX_BASENAME_LENGTH - 9);
    filename = `${truncatedPart}_${hash}`;
  }

  // Ensure correct extension
  let finalExt = ext;
  if ([".jpg", ".jpeg", ".png"].includes(ext.toLowerCase())) {
    finalExt = ".webp";
  }

  if (!filename.toLowerCase().endsWith(finalExt.toLowerCase())) {
    if (filename.toLowerCase().endsWith(ext.toLowerCase())) {
      filename = filename.substring(0, filename.length - ext.length);
    }
    filename += finalExt;
  }

  return filename;
}
