import OpenAI from "openai";
import axios from "axios";
import { OPENROUTER_API_KEY } from "../generator/config";
import { usageService } from "./UsageService";

// Re-export the OpenAI client for backwards compatibility during migration
export const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/vivd",
    "X-Title": "Vivd",
  },
});

export interface FlowContext {
  flowId: string; // e.g., 'scratch', 'url', 'image_edit', 'image_create', 'bg_remove', 'hero_gen'
  organizationId: string;
  projectSlug?: string;
}

interface OpenRouterCostResponse {
  data: {
    id: string;
    total_cost: number;
    tokens_prompt?: number;
    tokens_completion?: number;
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch cost from OpenRouter with retry for delayed availability.
 * Cost data may not be immediately available after a request completes.
 */
async function fetchCostWithRetry(
  generationId: string,
  maxRetries: number = 3,
  baseDelayMs: number = 500
): Promise<number | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 500ms, 1000ms, 1500ms
      await sleep(baseDelayMs * attempt);
    }

    try {
      const response = await axios.get<OpenRouterCostResponse>(
        `https://openrouter.ai/api/v1/generation?id=${generationId}`,
        {
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          },
        }
      );

      const cost = response.data?.data?.total_cost;
      if (cost !== undefined && cost !== null) {
        return cost;
      }
    } catch (error: any) {
      console.warn(
        `[OpenRouter] Cost fetch attempt ${attempt + 1} failed:`,
        error.message
      );
    }
  }

  console.warn(
    `[OpenRouter] Could not fetch cost for ${generationId} after ${maxRetries} attempts`
  );
  return null;
}

/**
 * Record cost for an OpenRouter generation.
 * This fetches the cost asynchronously and records it via UsageService.
 * Does not block or throw - cost tracking failures are logged but don't affect the main flow.
 */
export async function recordOpenRouterCost(
  organizationId: string,
  generationId: string,
  flowId: string,
  projectSlug?: string
): Promise<void> {
  try {
    const cost = await fetchCostWithRetry(generationId);
    await usageService.recordOpenRouterCost(
      organizationId,
      cost ?? 0,
      generationId,
      flowId,
      projectSlug
    );
  } catch (error) {
    console.error(
      `[OpenRouter] Failed to record cost for ${generationId}:`,
      error
    );
  }
}

/**
 * Create a chat completion using OpenRouter and automatically track costs.
 *
 * @param options - Standard OpenAI chat completion options
 * @param flowContext - Optional context for cost attribution
 * @returns The chat completion response
 */
export async function createChatCompletion(
  options: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  flowContext?: FlowContext
): Promise<OpenAI.Chat.ChatCompletion> {
  const completion = await openai.chat.completions.create(options);

  // Record cost asynchronously if we have flow context
  if (flowContext && completion.id) {
    // Fire and forget - don't block the response
    recordOpenRouterCost(
      flowContext.organizationId,
      completion.id,
      flowContext.flowId,
      flowContext.projectSlug
    ).catch(() => {});
  }

  return completion;
}

/**
 * Create an image generation request using OpenRouter's multimodal API.
 * Uses direct axios call for image generation parameters not supported by OpenAI SDK.
 *
 * @param options - Image generation options
 * @param flowContext - Optional context for cost attribution
 * @returns The response data from OpenRouter
 */
export async function createImageGeneration(
  options: {
    model: string;
    messages: any[];
    modalities?: string[];
    image_config?: {
      aspect_ratio?: string;
    };
  },
  flowContext?: FlowContext
): Promise<{ data: any; generationId: string | null }> {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: options.model,
      messages: options.messages,
      modalities: options.modalities ?? ["image", "text"],
      image_config: options.image_config,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/vivd",
        "X-Title": "Vivd",
      },
    }
  );

  const generationId = response.data?.id ?? null;

  // Record cost asynchronously if we have flow context
  if (flowContext && generationId) {
    recordOpenRouterCost(
      flowContext.organizationId,
      generationId,
      flowContext.flowId,
      flowContext.projectSlug
    ).catch(() => {});
  }

  return {
    data: response.data,
    generationId,
  };
}

/**
 * Extract image URL from an OpenRouter image generation response.
 * Handles various response formats from different models.
 */
export function extractImageFromResponse(result: any): string | null {
  if (!result.choices || !result.choices[0]) {
    return null;
  }

  const message = result.choices[0].message;

  // Check for images in the OpenRouter format (snake_case or camelCase)
  if (message.images && message.images.length > 0) {
    const imgObj = message.images[0];
    const imageUrl = imgObj.image_url?.url || imgObj.imageUrl?.url;
    if (imageUrl) {
      return imageUrl;
    }
  }

  // Fallback: check content for markdown or URL
  if (message.content) {
    let content = "";
    if (typeof message.content === "string") {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      content = message.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
    }

    // Check for Markdown image link ![alt](url)
    const match = content.match(/\!\[.*?\]\((.*?)\)/);
    if (match) return match[1];
    if (content.startsWith("http")) return content;
  }

  return null;
}
