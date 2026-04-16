import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";
import { createInstalledPluginSourceAliasObject } from "../../../plugins/installed/registry.helpers.mjs";

export default defineConfig({
  base: "./",
  root: path.resolve(__dirname),
  // Cast to avoid type mismatches when multiple Vite versions are present in the workspace.
  plugins: [react()] as unknown as PluginOption[],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@studio/shared": path.resolve(__dirname, "../shared"),
      "@vivd/installed-plugins": path.resolve(
        __dirname,
        "../../../plugins/installed/src",
      ),
      "@vivd/plugin-sdk": path.resolve(
        __dirname,
        "../../../plugins/sdk/src",
      ),
      ...createInstalledPluginSourceAliasObject({
        configDir: __dirname,
        repoRoot: path.resolve(__dirname, "../../.."),
      }),
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 3101,
    proxy: {
      "/vivd-studio/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:3100",
        changeOrigin: false,
      },
    },
  },
});
