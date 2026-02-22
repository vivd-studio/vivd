import { z } from "zod";
import { describe, expect, it } from "vitest";
import { vivdPluginsCatalogToolDefinition } from "./toolModules/vivdPluginsCatalog.js";
import { vivdPluginsContactInfoToolDefinition } from "./toolModules/vivdPluginsContactInfo.js";
import { vivdPluginsAnalyticsInfoToolDefinition } from "./toolModules/vivdPluginsAnalyticsInfo.js";
import { vivdPublishChecklistToolDefinition } from "./toolModules/vivdPublishChecklist.js";
import { vivdImageAiToolDefinition } from "./toolModules/vivdImageAi.js";

describe("OpenCode tool modules", () => {
  it("exports typed tool definitions", () => {
    const tools = [
      vivdPluginsCatalogToolDefinition,
      vivdPluginsContactInfoToolDefinition,
      vivdPluginsAnalyticsInfoToolDefinition,
      vivdPublishChecklistToolDefinition,
      vivdImageAiToolDefinition,
    ];

    expect(tools.every((tool) => typeof tool.description === "string")).toBe(true);
    expect(tools.every((tool) => typeof tool.execute === "function")).toBe(true);
  });

  it("validates image tool inputs with prompt-only support and max-5 images", () => {
    const schema = z.object(vivdImageAiToolDefinition.args);
    const promptOnly = schema.parse({ prompt: "Create a clean abstract gradient hero" });
    expect(promptOnly.images).toEqual([]);
    expect(promptOnly.operation).toBe("auto");

    const tooManyImages = schema.safeParse({
      prompt: "Upscale this image",
      images: ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png"],
    });
    expect(tooManyImages.success).toBe(false);
  });
});
