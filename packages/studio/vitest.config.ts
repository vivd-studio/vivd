/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(__dirname, "./client/src"),
      },
      {
        find: "@studio/shared",
        replacement: path.resolve(__dirname, "./shared"),
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
        find: /^@vivd\/installed-plugins$/,
        replacement: path.resolve(__dirname, "../installed-plugins/src/index.ts"),
      },
      {
        find: /^@vivd\/installed-plugins\/(.*)$/,
        replacement: path.resolve(__dirname, "../installed-plugins/src/$1"),
      },
      {
        find: /^@vivd\/plugin-analytics\/(.*)$/,
        replacement: path.resolve(__dirname, "../plugin-analytics/src/$1"),
      },
      {
        find: /^@vivd\/plugin-contact-form\/(.*)$/,
        replacement: path.resolve(__dirname, "../plugin-contact-form/src/$1"),
      },
      {
        find: /^@vivd\/plugin-newsletter\/(.*)$/,
        replacement: path.resolve(__dirname, "../plugin-newsletter/src/$1"),
      },
      {
        find: /^@vivd\/plugin-sdk$/,
        replacement: path.resolve(__dirname, "../plugin-sdk/src/index.ts"),
      },
      {
        find: /^@vivd\/plugin-sdk\/(.*)$/,
        replacement: path.resolve(__dirname, "../plugin-sdk/src/$1"),
      },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "client",
          include: ["client/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          include: ["server/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
    ],
  },
});
