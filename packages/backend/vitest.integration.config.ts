import path from "node:path";
import { defineConfig } from "vitest/config";
import { createVivdWorkspaceSourceAliases } from "../../scripts/workspace/sourceAliases.mjs";

export default defineConfig({
  resolve: {
    alias: [
      ...createVivdWorkspaceSourceAliases({
        configDir: __dirname,
        packageNames: ["@vivd/builder", "@vivd/plugin-sdk", "@vivd/shared"],
      }),
      {
        find: /^@vivd\/backend$/,
        replacement: path.resolve(__dirname, "./src/index.ts"),
      },
      {
        find: /^@vivd\/backend\/src\/(.*)$/,
        replacement: path.resolve(__dirname, "./src/$1"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
