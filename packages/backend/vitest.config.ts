import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@vivd\/builder$/,
        replacement: path.resolve(__dirname, "../builder/src/index.ts"),
      },
      {
        find: /^@vivd\/builder\/(.*)$/,
        replacement: path.resolve(__dirname, "../builder/src/$1"),
      },
      {
        find: /^@vivd\/shared\/studio$/,
        replacement: path.resolve(__dirname, "../shared/src/studio/index.ts"),
      },
      {
        find: /^@vivd\/shared\/cms$/,
        replacement: path.resolve(__dirname, "../shared/src/cms/index.ts"),
      },
      {
        find: /^@vivd\/shared\/types$/,
        replacement: path.resolve(__dirname, "../shared/src/types/index.ts"),
      },
      {
        find: /^@vivd\/shared\/config$/,
        replacement: path.resolve(__dirname, "../shared/src/config/index.ts"),
      },
      {
        find: /^@vivd\/shared$/,
        replacement: path.resolve(__dirname, "../shared/src/index.ts"),
      },
      {
        find: /^@vivd\/plugin-analytics$/,
        replacement: path.resolve(__dirname, "../../plugins/native/analytics/src/index.ts"),
      },
      {
        find: /^@vivd\/plugin-analytics\/(.*)$/,
        replacement: path.resolve(__dirname, "../../plugins/native/analytics/src/$1"),
      },
      {
        find: /^@vivd\/plugin-contact-form$/,
        replacement: path.resolve(__dirname, "../../plugins/native/contact-form/src/index.ts"),
      },
      {
        find: /^@vivd\/plugin-contact-form\/(.*)$/,
        replacement: path.resolve(__dirname, "../../plugins/native/contact-form/src/$1"),
      },
      {
        find: /^@vivd\/plugin-newsletter$/,
        replacement: path.resolve(__dirname, "../../plugins/native/newsletter/src/index.ts"),
      },
      {
        find: /^@vivd\/plugin-newsletter\/(.*)$/,
        replacement: path.resolve(__dirname, "../../plugins/native/newsletter/src/$1"),
      },
      {
        find: /^@vivd\/plugin-table-booking$/,
        replacement: path.resolve(__dirname, "../../plugins/native/table-booking/src/index.ts"),
      },
      {
        find: /^@vivd\/plugin-table-booking\/(.*)$/,
        replacement: path.resolve(__dirname, "../../plugins/native/table-booking/src/$1"),
      },
      {
        find: /^@vivd\/plugin-sdk$/,
        replacement: path.resolve(__dirname, "../../plugins/sdk/src/index.ts"),
      },
      {
        find: /^@vivd\/plugin-sdk\/(.*)$/,
        replacement: path.resolve(__dirname, "../../plugins/sdk/src/$1"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    // By default, only run unit tests (exclude integration folder)
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
