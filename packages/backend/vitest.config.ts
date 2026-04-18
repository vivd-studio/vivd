import { defineConfig } from "vitest/config";
import { createVivdWorkspaceSourceAliases } from "../../scripts/workspace/sourceAliases.mjs";

export default defineConfig({
  resolve: {
    alias: [
      ...createVivdWorkspaceSourceAliases({
        configDir: __dirname,
        packageNames: ["@vivd/builder", "@vivd/plugin-sdk", "@vivd/shared"],
      }),
    ],
  },
  test: {
    globals: true,
    environment: "node",
    // By default, only run unit tests (exclude integration folder)
    include: [
      "test/**/*.test.ts",
      "../../plugins/native/*/src/backend/**/*.test.ts",
    ],
    exclude: ["test/integration/**"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
