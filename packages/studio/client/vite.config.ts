import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";
import { createVivdWorkspaceSourceAliases } from "../../../scripts/workspace/sourceAliases.mjs";

export default defineConfig({
  base: "./",
  root: path.resolve(__dirname),
  // Cast to avoid type mismatches when multiple Vite versions are present in the workspace.
  plugins: [react()] as unknown as PluginOption[],
  resolve: {
    alias: [
      {
        find: /^@studio\/shared\/(.*)$/,
        replacement: `${path.resolve(__dirname, "../shared")}/$1`,
      },
      {
        find: /^@\/(.*)$/,
        replacement: `${path.resolve(__dirname, "./src")}/$1`,
      },
      ...createVivdWorkspaceSourceAliases({
        configDir: __dirname,
        repoRoot: path.resolve(__dirname, "../../.."),
        packageNames: [
          "@vivd/installed-plugins",
          "@vivd/plugin-sdk",
          "@vivd/shared",
          "@vivd/ui",
        ],
      }),
    ],
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
