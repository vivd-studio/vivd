/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createVivdWorkspaceSourceAliases } from "../../scripts/workspace/sourceAliases.mjs";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      ...createVivdWorkspaceSourceAliases({
        configDir: __dirname,
        packageNames: [
          "@vivd/installed-plugins",
          "@vivd/plugin-sdk",
          "@vivd/shared",
          "@vivd/ui",
        ],
      }),
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: [
      "src/**/*.test.{ts,tsx}",
      "test/**/*.test.{ts,tsx}",
      "../../plugins/native/*/src/frontend/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./test/setup.ts"],
  },
});
