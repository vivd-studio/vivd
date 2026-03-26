import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  normalizeStudioWorkingImageUpload,
  shouldNormalizeStudioWorkingImageUpload,
} from "./uploadNormalization.js";

describe("shouldNormalizeStudioWorkingImageUpload", () => {
  it("only normalizes .vivd working upload roots", () => {
    expect(shouldNormalizeStudioWorkingImageUpload(".vivd/uploads")).toBe(true);
    expect(shouldNormalizeStudioWorkingImageUpload(".vivd/uploads/raw")).toBe(
      true,
    );
    expect(
      shouldNormalizeStudioWorkingImageUpload(".vivd/dropped-images/abc"),
    ).toBe(true);
    expect(shouldNormalizeStudioWorkingImageUpload("images")).toBe(false);
    expect(shouldNormalizeStudioWorkingImageUpload("public/images")).toBe(false);
  });
});

describe("normalizeStudioWorkingImageUpload", () => {
  it("converts large jpeg uploads to resized webp", async () => {
    const jpegBuffer = await sharp({
      create: {
        width: 5000,
        height: 3000,
        channels: 3,
        background: { r: 220, g: 120, b: 90 },
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const result = await normalizeStudioWorkingImageUpload({
      filename: "hero.jpg",
      buffer: jpegBuffer,
    });

    expect(result.filename).toBe("hero.webp");
    expect(result.normalized).toBe(true);

    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(3840);
    expect(metadata.height).toBe(2304);
  });

  it("keeps non-convertible formats untouched", async () => {
    const gifBuffer = Buffer.from("GIF89a");

    const result = await normalizeStudioWorkingImageUpload({
      filename: "anim.gif",
      buffer: gifBuffer,
    });

    expect(result.filename).toBe("anim.gif");
    expect(result.buffer).toEqual(gifBuffer);
    expect(result.normalized).toBe(false);
  });

  it("keeps already-small webp uploads without re-encoding", async () => {
    const webpBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 90, g: 140, b: 220 },
      },
    })
      .webp({ quality: 92 })
      .toBuffer();

    const result = await normalizeStudioWorkingImageUpload({
      filename: "small.webp",
      buffer: webpBuffer,
    });

    expect(result.filename).toBe("small.webp");
    expect(result.buffer).toEqual(webpBuffer);
    expect(result.normalized).toBe(false);
  });
});
