import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sharedSrc = path.resolve(__dirname, "../shared/src");
const installedPluginsSrc = path.resolve(__dirname, "../../plugins/installed/src");
const pluginSdkSrc = path.resolve(__dirname, "../../plugins/sdk/src");
const pluginAnalyticsSrc = path.resolve(__dirname, "../../plugins/native/analytics/src");
const pluginContactFormSrc = path.resolve(__dirname, "../../plugins/native/contact-form/src");
const pluginNewsletterSrc = path.resolve(__dirname, "../../plugins/native/newsletter/src");
const pluginTableBookingSrc = path.resolve(__dirname, "../../plugins/native/table-booking/src");

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
      {
        find: /^@vivd\/plugin-newsletter$/,
        replacement: path.resolve(pluginNewsletterSrc, "index.ts"),
      },
      {
        find: /^@vivd\/plugin-newsletter\/(.*)$/,
        replacement: `${pluginNewsletterSrc}/$1`,
      },
      {
        find: /^@vivd\/plugin-table-booking$/,
        replacement: path.resolve(pluginTableBookingSrc, "index.ts"),
      },
      {
        find: /^@vivd\/plugin-table-booking\/(.*)$/,
        replacement: `${pluginTableBookingSrc}/$1`,
      },
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
