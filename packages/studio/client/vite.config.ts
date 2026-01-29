import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@studio/shared": path.resolve(__dirname, "../shared"),
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 3101,
    proxy: {
      "/trpc": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      "/preview": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
    },
  },
});
