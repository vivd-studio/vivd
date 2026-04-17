import { defineConfig } from "vitest/config";
import { createVivdWorkspaceSourceAliases } from "../../scripts/workspace/sourceAliases.mjs";

export default defineConfig({
  resolve: {
    alias: createVivdWorkspaceSourceAliases({
      configDir: __dirname,
      packageNames: ["@vivd/plugin-sdk", "@vivd/shared"],
    }),
  },
  test: {
    environment: "node",
  },
});
