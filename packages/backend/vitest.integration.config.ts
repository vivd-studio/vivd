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
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
