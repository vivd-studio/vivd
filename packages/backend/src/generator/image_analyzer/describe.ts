import * as fs from "fs";
import * as path from "path";
import { SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH } from "@vivd/shared";
import { VISION_MODEL } from "../config";
import { log } from "../logger";
import { IMAGE_DESCRIPTION_PROMPT } from "../prompts";
import {
  createChatCompletion,
  type FlowContext,
} from "../../services/integrations/OpenRouterService";
import { parseJsonFromLLM } from "../utils";
import { convertSvgToPngBuffer } from "./utils";
import type { ImageInfo } from "./types";

export async function describeImage(
  image: ImageInfo,
  outputDir: string,
  flowContext?: FlowContext,
): Promise<{ description: string }> {
  const imagePath =
    image.absolutePath ??
    (image.relativePath
      ? path.join(outputDir, ...image.relativePath.split("/"))
      : path.join(
          outputDir,
          SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH,
          image.filename,
        ));

  // Read image and convert to base64
  let imageBuffer: Buffer = fs.readFileSync(imagePath);
  let ext = path.extname(image.filename).substring(1);

  if (ext.toLowerCase() === "svg") {
    const pngBuffer = await convertSvgToPngBuffer(imagePath);
    if (pngBuffer) {
      imageBuffer = pngBuffer;
      ext = "png";
    }
  }

  const base64Image = imageBuffer.toString("base64");
  const dataUrl = `data:image/${ext === "svg" ? "svg+xml" : ext};base64,${base64Image}`;

  const prompt = IMAGE_DESCRIPTION_PROMPT;

  try {
    const completion = await createChatCompletion(
      {
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      },
      flowContext,
    );

    const content = completion.choices[0].message.content;
    if (!content) return { description: "Failed to analyze" };

    const parsed = parseJsonFromLLM(content);

    return {
      description: parsed?.description || "No description",
    };
  } catch (e) {
    log(`Error describing image ${image.filename}: ${e} `);
    return { description: "Error during analysis" };
  }
}
