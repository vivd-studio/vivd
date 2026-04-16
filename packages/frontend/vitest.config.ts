/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createInstalledPluginSourceAliases } from "../../plugins/installed/registry.helpers.mjs";

const sharedSrc = path.resolve(__dirname, "../shared/src");
const pluginSdkSrc = path.resolve(__dirname, "../../plugins/sdk/src");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      ...createInstalledPluginSourceAliases({ configDir: __dirname }),
      {
        find: /^@vivd\/plugin-sdk$/,
        replacement: path.resolve(pluginSdkSrc, "index.ts"),
      },
      { find: /^@vivd\/plugin-sdk\/(.*)$/, replacement: `${pluginSdkSrc}/$1` },
      { find: /^@vivd\/shared$/, replacement: path.resolve(sharedSrc, "index.ts") },
      { find: /^@vivd\/shared\/(.*)$/, replacement: `${sharedSrc}/$1` },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});
