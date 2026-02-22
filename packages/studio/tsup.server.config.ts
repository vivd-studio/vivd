import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "server/index.ts",
    "opencode/toolModules/vivdPluginsCatalog":
      "server/opencode/toolModules/vivdPluginsCatalog.ts",
    "opencode/toolModules/vivdPluginsContactInfo":
      "server/opencode/toolModules/vivdPluginsContactInfo.ts",
    "opencode/toolModules/vivdPublishChecklist":
      "server/opencode/toolModules/vivdPublishChecklist.ts",
  },
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  clean: true,
  splitting: true,
});
