import "./init-env";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import archiver from "archiver";

import { serverManager } from "./opencode";
import { toNodeHandler } from "better-auth/node";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { auth } from "./auth";
import { appRouter } from "./routers/appRouter";
import { createContext } from "./trpc";
import { getVersionDir } from "./generator/versionUtils";
import { createImportRouter } from "./routes/import";
import { safeJoin } from "./fs/safePaths";
import { db } from "./db";
import { projectMember } from "./db/schema";
import { eq } from "drizzle-orm";

// ESM dirname replacement
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

async function getSessionFromRequest(req: express.Request) {
  return auth.api.getSession({
    headers: req.headers as any,
  });
}

function getSessionUserRole(session: any): string {
  return session?.user?.role ?? "user";
}

async function getAssignedProjectSlug(userId: string): Promise<string | null> {
  const membership = await db.query.projectMember.findFirst({
    where: eq(projectMember.userId, userId),
  });
  return membership?.projectSlug ?? null;
}

async function enforceProjectAccess(
  _req: express.Request,
  res: express.Response,
  session: any,
  slug: string
): Promise<boolean> {
  const role = getSessionUserRole(session);
  if (role !== "client_editor") return true;

  const assigned = await getAssignedProjectSlug(session.user.id);
  if (!assigned) {
    res.status(403).json({ error: "No project assigned to your account" });
    return false;
  }
  if (assigned !== slug) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function createProtectedProjectsStaticMiddleware() {
  return async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const session = await getSessionFromRequest(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });

    const segments = req.path.split("/").filter(Boolean);
    const slug = segments[0];
    if (!slug) return res.status(400).json({ error: "Invalid path" });

    const ok = await enforceProjectAccess(req, res, session, slug);
    if (!ok) return;

    return next();
  };
}

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

app.use(
  cors({
    origin: process.env.DOMAIN
      ? process.env.DOMAIN.startsWith("http")
        ? process.env.DOMAIN
        : `https://${process.env.DOMAIN}`
      : "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));

// Auth Routes
app.all("/vivd-studio/api/auth/*path", toNodeHandler(auth));

// Static files
app.use(
  "/vivd-studio/api/projects",
  createProtectedProjectsStaticMiddleware(),
  express.static(path.join(__dirname, "../projects"), { dotfiles: "deny" })
);
app.use(
  "/vivd-studio/api/preview",
  express.static(path.join(__dirname, "../projects"), { dotfiles: "deny" })
);

// File upload endpoint
app.post(
  "/vivd-studio/api/upload/:slug/:version",
  upload.array("files", 20),
  async (req, res) => {
    try {
      const session = await getSessionFromRequest(req);

      if (!session) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { slug, version } = req.params;
      const ok = await enforceProjectAccess(req, res, session, slug);
      if (!ok) return;

      const versionNumber = Number.parseInt(version, 10);
      if (!Number.isFinite(versionNumber) || versionNumber < 1) {
        return res.status(400).json({ error: "Invalid version" });
      }
      const relativePath = typeof req.query.path === "string" ? req.query.path : "";
      const versionDir = getVersionDir(slug, versionNumber);

      if (!fs.existsSync(versionDir)) {
        return res.status(404).json({ error: "Project version not found" });
      }

      let targetDir: string;
      try {
        targetDir = safeJoin(versionDir, relativePath);
      } catch {
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
        let filePath: string;
        try {
          const rel = relativePath
            ? path.posix.join(relativePath.replace(/\\/g, "/"), sanitizedName)
            : sanitizedName;
          filePath = safeJoin(versionDir, rel);
        } catch {
          return res.status(400).json({ error: "Invalid filename" });
        }

        // Write file
        fs.writeFileSync(filePath, file.buffer);
        uploaded.push(
          relativePath
            ? path.posix.join(relativePath.replace(/\\/g, "/"), sanitizedName)
            : sanitizedName
        );
      }

      return res.json({ success: true, uploaded });
    } catch (error) {
      console.error("Upload error:", error);
      return res.status(500).json({ error: "Upload failed" });
    }
  }
);

// Download project version as ZIP
app.get("/vivd-studio/api/download/:slug/:version", async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);

    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { slug, version } = req.params;
    const ok = await enforceProjectAccess(req, res, session, slug);
    if (!ok) return;

    const versionNumber = Number.parseInt(version, 10);
    if (!Number.isFinite(versionNumber) || versionNumber < 1) {
      return res.status(400).json({ error: "Invalid version" });
    }
    const versionDir = getVersionDir(slug, versionNumber);

    if (!fs.existsSync(versionDir)) {
      return res.status(404).json({ error: "Project version not found" });
    }

    // Set response headers for zip download
    const filename = `${slug}-v${version}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Create archive
    const archive = archiver("zip", {
      zlib: { level: 5 }, // Balanced compression
    });

    // Handle archive errors
    archive.on("error", (err) => {
      console.error("Archive error:", err);
      res.status(500).json({ error: "Failed to create archive" });
    });

    // Pipe archive to response
    archive.pipe(res);

    // Add the version directory contents to the archive (including internals)
    archive.directory(versionDir, false);

    // Finalize the archive
    await archive.finalize();
  } catch (error) {
    console.error("Download error:", error);
    return res.status(500).json({ error: "Download failed" });
  }
});

// Import Projects endpoint(s)
app.use("/vivd-studio/api", createImportRouter({ auth, upload }));

// tRPC
app.use(
  "/vivd-studio/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

app.get("/vivd-studio/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`[OpenCode] Server manager ready (servers spawn on first task)`);

  // Graceful shutdown for all opencode servers
  const cleanup = () => {
    console.log("[OpenCode] Shutting down...");
    serverManager.closeAll();
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("exit", cleanup);
});
