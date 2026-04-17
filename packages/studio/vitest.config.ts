/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createVivdWorkspaceSourceAliases } from "../../scripts/workspace/sourceAliases.mjs";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@studio\/shared\/(.*)$/,
        replacement: `${path.resolve(__dirname, "./shared")}/$1`,
      },
      {
        find: /^@\/(.*)$/,
        replacement: `${path.resolve(__dirname, "./client/src")}/$1`,
      },
      ...createVivdWorkspaceSourceAliases({
        configDir: __dirname,
        packageNames: [
          "@vivd/installed-plugins",
          "@vivd/plugin-sdk",
          "@vivd/shared",
          "@vivd/ui",
        ],
        includeBareInstalledPluginImports: false,
      }),
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
