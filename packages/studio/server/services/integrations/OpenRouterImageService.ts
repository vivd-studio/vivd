const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterImageGenerationOptions {
  model: string;
  messages: unknown[];
  modalities?: string[];
  image_config?: {
    aspect_ratio?: string;
  };
}

export async function createImageGeneration(
  apiKey: string,
  options: OpenRouterImageGenerationOptions,
): Promise<{ data: any; generationId: string | null }> {
  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/vivd",
      "X-Title": "Vivd",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      modalities: options.modalities ?? ["image", "text"],
      image_config: options.image_config,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown OpenRouter error");
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const generationId = typeof data?.id === "string" ? data.id : null;
  return { data, generationId };
}

export function extractImageFromResponse(result: any): string | null {
  if (!result?.choices?.[0]?.message) {
    return null;
  }

  const message = result.choices[0].message;

  if (Array.isArray(message.images) && message.images.length > 0) {
    const imageObj = message.images[0];
    const imageUrl = imageObj?.image_url?.url || imageObj?.imageUrl?.url;
    if (typeof imageUrl === "string" && imageUrl.length > 0) {
      return imageUrl;
    }
  }

  if (typeof message.content === "string") {
    const markdownMatch = message.content.match(/\!\[.*?\]\((.*?)\)/);
    if (markdownMatch?.[1]) return markdownMatch[1];
    if (message.content.startsWith("http")) return message.content;
  }

  if (Array.isArray(message.content)) {
    const textContent = message.content
      .filter((entry: any) => entry?.type === "text")
      .map((entry: any) => entry.text)
      .join("");

    const markdownMatch = textContent.match(/\!\[.*?\]\((.*?)\)/);
    if (markdownMatch?.[1]) return markdownMatch[1];
    if (textContent.startsWith("http")) {
      return textContent;
    }
  }

  return null;
}
