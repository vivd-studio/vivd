/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const sharedSrc = path.resolve(__dirname, "../shared/src");
const pluginSdkSrc = path.resolve(__dirname, "../plugin-sdk/src");
const pluginAnalyticsSrc = path.resolve(__dirname, "../plugin-analytics/src");
const pluginContactFormSrc = path.resolve(__dirname, "../plugin-contact-form/src");
const pluginNewsletterSrc = path.resolve(__dirname, "../plugin-newsletter/src");

export default defineConfig({
  plugins: [react()],
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
