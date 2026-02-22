import { describe, expect, it } from "vitest";
import { vivdPluginsCatalogToolDefinition } from "./toolModules/vivdPluginsCatalog.js";
import { vivdPluginsContactInfoToolDefinition } from "./toolModules/vivdPluginsContactInfo.js";
import { vivdPublishChecklistToolDefinition } from "./toolModules/vivdPublishChecklist.js";

describe("OpenCode tool modules", () => {
  it("exports typed tool definitions", () => {
    const tools = [
      vivdPluginsCatalogToolDefinition,
      vivdPluginsContactInfoToolDefinition,
      vivdPublishChecklistToolDefinition,
    ];

    expect(tools.every((tool) => typeof tool.description === "string")).toBe(true);
    expect(tools.every((tool) => typeof tool.execute === "function")).toBe(true);
  });
});
