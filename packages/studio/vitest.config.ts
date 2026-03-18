/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@studio/shared": path.resolve(__dirname, "./shared"),
    },
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
