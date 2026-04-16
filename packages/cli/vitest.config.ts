import path from "node:path";
import { defineConfig } from "vitest/config";
import { createInstalledPluginSourceAliases } from "../../plugins/installed/registry.helpers.mjs";

const sharedSrc = path.resolve(__dirname, "../shared/src");

export default defineConfig({
  resolve: {
    alias: [
      ...createInstalledPluginSourceAliases({ configDir: __dirname }),
      {
        find: /^@vivd\/shared$/,
        replacement: path.resolve(sharedSrc, "index.ts"),
      },
      {
        find: /^@vivd\/shared\/(.*)$/,
        replacement: path.resolve(__dirname, "../shared/src/$1"),
      },
    ],
  },
  test: {
    environment: "node",
  },
});
