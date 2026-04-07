import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sharedSrc = path.resolve(__dirname, "../shared/src");
const pluginAnalyticsSrc = path.resolve(__dirname, "../plugin-analytics/src");
const pluginContactFormSrc = path.resolve(__dirname, "../plugin-contact-form/src");

export default defineConfig({
  base: "/vivd-studio",
  plugins: [react() as any],
  resolve: {
    alias: [
      {
        find: /^@vivd\/plugin-analytics$/,
        replacement: path.resolve(pluginAnalyticsSrc, "index.ts"),
      },
      { find: /^@vivd\/plugin-analytics\/(.*)$/, replacement: `${pluginAnalyticsSrc}/$1` },
      {
        find: /^@vivd\/plugin-contact-form$/,
        replacement: path.resolve(pluginContactFormSrc, "index.ts"),
      },
      {
        find: /^@vivd\/plugin-contact-form\/(.*)$/,
        replacement: `${pluginContactFormSrc}/$1`,
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
