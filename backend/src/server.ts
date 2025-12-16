import "./init-env";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";

import { initOpencode } from "./opencode";
import { toNodeHandler } from "better-auth/node";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { auth } from "./auth";
import { appRouter } from "./routers/appRouter";
import { createContext } from "./trpc";
import { getVersionDir } from "./generator/versionUtils";

// ESM dirname replacement
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));

// Auth Routes
app.all("/api/auth/*path", toNodeHandler(auth));

// Static files
app.use("/api/generated", express.static(path.join(__dirname, "../generated")));
app.use("/api/preview", express.static(path.join(__dirname, "../generated")));

// File upload endpoint
app.post(
  "/api/upload/:slug/:version",
  upload.array("files", 20),
  async (req, res) => {
    try {
      // Verify auth using better-auth
      const session = await auth.api.getSession({
        headers: req.headers as any,
      });

      if (!session) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { slug, version } = req.params;
      const relativePath = (req.query.path as string) || "";
      const versionDir = getVersionDir(slug, parseInt(version));

      if (!fs.existsSync(versionDir)) {
        return res.status(404).json({ error: "Project version not found" });
      }

      const targetDir = path.join(versionDir, relativePath);

      // Security: ensure we're within the version directory
      const realVersionDir = fs.realpathSync(versionDir);
      if (!targetDir.startsWith(realVersionDir)) {
        return res.status(400).json({ error: "Invalid path" });
      }

      // Create target directory if it doesn't exist
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const files = req.files as Express.Multer.File[];
      const uploaded: string[] = [];

      for (const file of files) {
        // Sanitize filename
        const sanitizedName = file.originalname.replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );
        const filePath = path.join(targetDir, sanitizedName);

        // Write file
        fs.writeFileSync(filePath, file.buffer);
        uploaded.push(path.join(relativePath, sanitizedName));
      }

      return res.json({ success: true, uploaded });
    } catch (error) {
      console.error("Upload error:", error);
      return res.status(500).json({ error: "Upload failed" });
    }
  }
);

// tRPC
app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  // Initialize OpenCode Server
  try {
    const opencode = await initOpencode();

    // Graceful shutdown
    const cleanup = () => {
      console.log("[OpenCode] Stopping server...");
      try {
        opencode.server.close();
      } catch (e) {
        // ignore
      }
    };

    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
    process.on("exit", cleanup);
  } catch (error) {
    console.error("[OpenCode] Failed to start server:", error);
  }
});
