import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createInstalledPluginSourceAliases } from "../../plugins/installed/registry.helpers.mjs";

const sharedSrc = path.resolve(__dirname, "../shared/src");
const installedPluginsSrc = path.resolve(__dirname, "../../plugins/installed/src");
const pluginSdkSrc = path.resolve(__dirname, "../../plugins/sdk/src");

export default defineConfig({
  base: "/vivd-studio",
  plugins: [react() as any],
  resolve: {
    alias: [
      ...createInstalledPluginSourceAliases({ configDir: __dirname }),
      {
        find: /^@vivd\/installed-plugins$/,
        replacement: path.resolve(installedPluginsSrc, "index.ts"),
      },
      {
        find: /^@vivd\/installed-plugins\/(.*)$/,
        replacement: `${installedPluginsSrc}/$1`,
      },
      {
        find: /^@vivd\/plugin-sdk$/,
        replacement: path.resolve(pluginSdkSrc, "index.ts"),
      },
      {
        find: /^@vivd\/plugin-sdk\/(.*)$/,
        replacement: `${pluginSdkSrc}/$1`,
      },
      { find: /^@vivd\/shared$/, replacement: path.resolve(sharedSrc, "index.ts") },
      { find: /^@vivd\/shared\/(.*)$/, replacement: `${sharedSrc}/$1` },
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
