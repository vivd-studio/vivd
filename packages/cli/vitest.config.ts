import path from "node:path";
import { defineConfig } from "vitest/config";

const sharedSrc = path.resolve(__dirname, "../shared/src");
const pluginAnalyticsSrc = path.resolve(__dirname, "../plugin-analytics/src");
const pluginContactFormSrc = path.resolve(__dirname, "../plugin-contact-form/src");
const pluginNewsletterSrc = path.resolve(__dirname, "../plugin-newsletter/src");
const pluginTableBookingSrc = path.resolve(__dirname, "../plugin-table-booking/src");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@vivd\/plugin-analytics$/,
        replacement: path.resolve(pluginAnalyticsSrc, "index.ts"),
      },
      {
        find: /^@vivd\/plugin-analytics\/(.*)$/,
        replacement: path.resolve(__dirname, "../plugin-analytics/src/$1"),
      },
      {
        find: /^@vivd\/plugin-contact-form$/,
        replacement: path.resolve(pluginContactFormSrc, "index.ts"),
      },
      {
        find: /^@vivd\/plugin-contact-form\/(.*)$/,
        replacement: path.resolve(__dirname, "../plugin-contact-form/src/$1"),
      },
      {
        find: /^@vivd\/plugin-newsletter$/,
        replacement: path.resolve(pluginNewsletterSrc, "index.ts"),
      },
      {
        find: /^@vivd\/plugin-newsletter\/(.*)$/,
        replacement: path.resolve(__dirname, "../plugin-newsletter/src/$1"),
      },
      {
        find: /^@vivd\/plugin-table-booking$/,
        replacement: path.resolve(pluginTableBookingSrc, "index.ts"),
      },
      {
        find: /^@vivd\/plugin-table-booking\/(.*)$/,
        replacement: path.resolve(__dirname, "../plugin-table-booking/src/$1"),
      },
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
