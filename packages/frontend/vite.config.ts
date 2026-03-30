import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sharedSrc = path.resolve(__dirname, "../shared/src");

export default defineConfig({
  base: "/vivd-studio",
  plugins: [react() as any],
  resolve: {
    alias: [
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
