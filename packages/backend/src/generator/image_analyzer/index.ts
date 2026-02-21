import * as fs from "fs";
import * as path from "path";
import { ENABLE_IMAGE_ANALYSIS, MAX_IMAGES_TO_ANALYZE } from "../config";
import { log } from "../logger";
import type { ImageInfo } from "./types";
import { getImageDimensions } from "./utils";
import { prioritizeImages } from "./prioritize";
import { describeImage } from "./describe";
import { generateImageDescriptionFile } from "./report";
import type { FlowContext } from "../../services/integrations/OpenRouterService";

export type { ImageInfo };

export async function analyzeImages(outputDir: string, flowContext?: FlowContext) {
  const imagesDir = path.join(outputDir, "images");
  if (!fs.existsSync(imagesDir)) {
    log("No images directory found.");
    return;
  }

  const files = fs
    .readdirSync(imagesDir)
    .filter((file) => /\.(jpg|jpeg|png|webp|svg)$/i.test(file));
  log(`Found ${files.length} images to analyze.`);

  const images: ImageInfo[] = files.map((file) => {
    const dims = getImageDimensions(path.join(imagesDir, file));
    return {
      filename: file,
      width: dims.width,
      height: dims.height,
      analyzed: false,
    };
  });

  // Filter out images with odd ratios
  const filteredDir = path.join(imagesDir, "filtered_out");

  const validImages: ImageInfo[] = [];

  for (const img of images) {
    // Skip filter if dimensions are missing (e.g. some SVGs)
    if (img.width === 0 || img.height === 0) {
      validImages.push(img);
      continue;
    }

    const ratio = img.width / img.height;
    // Filter if ratio is > 3.5 (very wide) or < 1/3.5 (very tall)
    const isOddRatio = ratio > 3.5 || ratio < 1 / 3.5;

    if (isOddRatio) {
      try {
        if (!fs.existsSync(filteredDir)) {
          fs.mkdirSync(filteredDir);
        }
        const oldPath = path.join(imagesDir, img.filename);
        const newPath = path.join(filteredDir, img.filename);
        fs.renameSync(oldPath, newPath);
        log(`Filtered out ${img.filename} (ratio: ${ratio.toFixed(2)})`);
      } catch (e) {
        log(`Error moving filtered file ${img.filename}: ${e}`);
        // If move fails, keep it in the list to avoid crashing, but maybe mark it?
        // For now, just keep it.
        validImages.push(img);
      }
    } else {
      validImages.push(img);
    }
  }

  // Clean up filtered_out directory if it exists and is empty
  if (fs.existsSync(filteredDir)) {
    try {
      const files = fs.readdirSync(filteredDir);
      if (files.length === 0) {
        fs.rmdirSync(filteredDir);
      }
    } catch (e) {
      log(`Error cleaning up filtered_out directory: ${e}`);
    }
  }

  log(
    `Filtered ${images.length - validImages.length} images. Proceeding with ${
      validImages.length
    } images.`
  );

  if (ENABLE_IMAGE_ANALYSIS) {
    // 1. Prioritize
    const prioritizedImages = await prioritizeImages(validImages, flowContext);
    const topImageNames = prioritizedImages.slice(0, MAX_IMAGES_TO_ANALYZE);
    log(
      `Prioritized ${prioritizedImages.length} images. Analyzing top ${topImageNames.length}.`
    );

    // 2. Describe top images
    const analysisPromises = validImages.map(async (img) => {
      const priorityIndex = topImageNames.indexOf(img.filename);
      if (priorityIndex !== -1) {
        log(`Analyzing ${img.filename}...`);
        const result = await describeImage(img, outputDir, flowContext);
        img.description = result.description;
        img.priorityIndex = priorityIndex;
        img.analyzed = true;
      }
    });

    await Promise.all(analysisPromises);
  } else {
    log("Image analysis disabled via config.");
  }

  // 3. Generate Report
  generateImageDescriptionFile(validImages, outputDir);
}
