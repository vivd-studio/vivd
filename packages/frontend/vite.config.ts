import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createVivdWorkspaceSourceAliases } from "../../scripts/workspace/sourceAliases.mjs";

export default defineConfig({
  base: "/vivd-studio",
  plugins: [react() as any],
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
  server: {
    proxy: {
      "/vivd-studio/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:3000",
        changeOrigin: false,
      },
    },
  },
});
