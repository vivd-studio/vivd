import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
export default defineConfig({
    plugins: [react()],
    base: "/",
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5174,
        host: true,
        proxy: {
            "/trpc": {
                target: process.env.VITE_API_URL || "http://localhost:3100",
                changeOrigin: true,
            },
            "/auth": {
                target: process.env.VITE_API_URL || "http://localhost:3100",
                changeOrigin: true,
            },
        },
    },
});
