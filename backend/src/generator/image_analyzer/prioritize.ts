import { PRIORITIZATION_MODEL } from "../config";
import { log } from "../logger";
import { IMAGE_PRIORITIZATION_PROMPT } from "../prompts";
import type { ImageInfo } from "./types";
import {
  createChatCompletion,
  type FlowContext,
} from "../../services/OpenRouterService";
import { parseJsonFromLLM } from "../utils";

export async function prioritizeImages(
  images: ImageInfo[],
  flowContext?: FlowContext,
): Promise<string[]> {
  log("Prioritizing images...");
  const imagesList = images
    .map((img) => `- ${img.filename} (${img.width}x${img.height})`)
    .join("\n");
  const prompt = IMAGE_PRIORITIZATION_PROMPT(imagesList);

  try {
    const completion = await createChatCompletion(
      {
        model: PRIORITIZATION_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      },
      flowContext,
    );

    const content = completion.choices[0].message.content;
    if (!content) return [];

    const parsed = parseJsonFromLLM(content);

    if (Array.isArray(parsed)) {
      return parsed;
    } else if (parsed && Array.isArray(parsed.filenames)) {
      return parsed.filenames;
    } else if (parsed && Array.isArray(parsed.images)) {
      return parsed.images;
    }

    // If it's an object with keys, try to find an array
    if (typeof parsed === "object") {
      const values = Object.values(parsed);
      const arrayVal = values.find((v) => Array.isArray(v));
      if (arrayVal) return arrayVal as string[];
    }

    return [];
  } catch (e) {
    log(`Error prioritizing images: ${e} `);
    return images.map((img) => img.filename); // Fallback: return all in original order
  }
}
