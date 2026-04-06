import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@vivd\/shared\/studio$/,
        replacement: path.resolve(__dirname, "../shared/src/studio/index.ts"),
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
        find: /^@vivd\/shared\/(.*)$/,
        replacement: path.resolve(__dirname, "../shared/src/$1"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
