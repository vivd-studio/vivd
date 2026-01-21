import "./init-env";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { convertFilenameToWebp, writeImageFile } from "./utils/imageUtils";
import multer from "multer";
import archiver from "archiver";
import {
  createProxyMiddleware,
  responseInterceptor,
} from "http-proxy-middleware";

import { serverManager } from "./opencode";
import { devServerManager } from "./devserver";
import { toNodeHandler } from "better-auth/node";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { auth } from "./auth";
import { appRouter } from "./routers/appRouter";
import { createContext } from "./trpc";
import { getVersionDir, touchProjectUpdatedAt } from "./generator/versionUtils";
import { createImportRouter } from "./routes/import";
import { safeJoin } from "./fs/safePaths";
import { db } from "./db";
import { projectMember } from "./db/schema";
import { eq } from "drizzle-orm";

// ESM dirname replacement
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

type DevPreviewProxyRequest = express.Request & {
  vivdDevPreviewTarget?: string;
  vivdDevPreviewBasePath?: string;
};

function rewriteRootAssetUrlsInText(text: string, basePath: string): string {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const prefixGroups = [
    "images",
    "_astro",
    "@vite",
    "@id",
    "src",
    "node_modules",
    "@fs",
    "assets",
  ].join("|");

  // Only rewrites known asset-like prefixes; does not touch page routes (e.g. "/ueber-uns").
  return (
    text
      .replace(
        new RegExp(`(^|[^\\w/])\\/(${prefixGroups})\\/`, "g"),
        `$1${base}/$2/`,
      )
      // favicon-like root assets
      .replace(
        /(^|[^\w/])\/(favicon(?:-[^"'`()\s,]+)?\.(?:ico|png|svg))\b/g,
        `$1${base}/$2`,
      )
  );
}

function stripDevServerToolingFromHtml(html: string): string {
  return html
    .replace(
      /<script\b[^>]*\bsrc=(["'])([^"']*\/@vite\/client[^"']*)\1[^>]*>\s*<\/script>/gi,
      "",
    )
    .replace(
      /<script\b[^>]*\bsrc=(["'])([^"']*dev-toolbar\/entrypoint\.js[^"']*)\1[^>]*>\s*<\/script>/gi,
      "",
    )
    .replace(
      /<link\b[^>]*\bhref=(["'])([^"']*\/@vite\/client[^"']*)\1[^>]*>/gi,
      "",
    )
    .replace(
      /<link\b[^>]*\bhref=(["'])([^"']*dev-toolbar\/[^"']*)\1[^>]*>/gi,
      "",
    );
}

// Single proxy instance to avoid adding EventEmitter listeners per request.
// The route handler sets `vivdDevPreviewTarget` and `vivdDevPreviewBasePath` on the request.
const devPreviewProxy = createProxyMiddleware({
  target: "http://127.0.0.1:0", // Overridden by `router` per request
  changeOrigin: true,
  ws: true,
  selfHandleResponse: true,
  router: (req) => {
    const target = (req as DevPreviewProxyRequest).vivdDevPreviewTarget;
    return typeof target === "string" && target.length > 0
      ? target
      : "http://127.0.0.1:0";
  },
  on: {
    proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req) => {
      const basePath =
        (req as DevPreviewProxyRequest).vivdDevPreviewBasePath || "";

      const contentType = String(proxyRes.headers["content-type"] || "");
      const ct = contentType.toLowerCase();
      const reqUrl = String(req?.url || "");

      const looksLikeTextByUrl =
        reqUrl.includes("/@id/") ||
        reqUrl.includes("/@vite/") ||
        reqUrl.includes("/@fs/") ||
        /\.(?:html|css|js|mjs|cjs|ts|tsx|jsx)(?:\?|$)/i.test(reqUrl) ||
        reqUrl.includes("?astro&type=script") ||
        reqUrl.includes("?astro&type=style");

      const isTextLike =
        ct.includes("text/html") ||
        ct.includes("text/css") ||
        ct.includes("application/javascript") ||
        ct.includes("text/javascript") ||
        ct.includes("application/x-javascript") ||
        ct.includes("application/ecmascript") ||
        ct.includes("text/ecmascript") ||
        looksLikeTextByUrl;
      if (!isTextLike || !basePath) {
        return responseBuffer;
      }

      const text = responseBuffer.toString("utf8");
      const rewritten = rewriteRootAssetUrlsInText(text, basePath);
      const shouldStripTooling = ct.includes("text/html");
      const finalText = shouldStripTooling
        ? stripDevServerToolingFromHtml(rewritten)
        : rewritten;

      return Buffer.from(finalText, "utf8");
    }),
    error: (err, _req, res) => {
      console.error("[DevServer] Proxy error:", err.message);
      if ("status" in res) {
        (res as express.Response).status(502).json({
          error: "Dev server proxy error",
        });
      }
    },
  },
});

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
  slug: string,
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
    next: express.NextFunction,
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
  }),
);
app.use(express.json({ limit: "50mb" }));

// Auth Routes
app.all("/vivd-studio/api/auth/*path", toNodeHandler(auth));

// Static files
app.use(
  "/vivd-studio/api/projects",
  createProtectedProjectsStaticMiddleware(),
  express.static(path.join(__dirname, "../projects"), { dotfiles: "allow" }),
);
app.use(
  "/vivd-studio/api/preview",
  express.static(path.join(__dirname, "../projects"), { dotfiles: "allow" }),
);

// Dev server proxy for framework projects (Astro, Vite, etc.)
app.use(
  "/vivd-studio/api/devpreview/:slug/v:version",
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { slug, version } = req.params;
    const versionNumber = Number.parseInt(version, 10);
    if (!Number.isFinite(versionNumber) || versionNumber < 1) {
      return res.status(400).json({ error: "Invalid version" });
    }

    const ok = await enforceProjectAccess(req, res, session, slug);
    if (!ok) return;

    const versionDir = getVersionDir(slug, versionNumber);
    const devServerUrl = devServerManager.getDevServerUrl(versionDir);

    if (!devServerUrl) {
      const status = devServerManager.getDevServerStatus(versionDir);
      if (status === "starting" || status === "installing") {
        return res
          .status(503)
          .json({ error: "Dev server is starting...", status });
      }
      return res.status(503).json({ error: "Dev server not running", status });
    }

    // Intercept Vite HMR client and dev toolbar requests - return no-op modules
    // This prevents the WebSocket connection attempts since HMR doesn't work through our proxy
    if (req.originalUrl.includes("/@vite/client")) {
      res.setHeader("Content-Type", "application/javascript");
      // Provide no-op implementations of all Vite HMR client exports
      return res.send(`// Vite HMR disabled in preview mode
export const createHotContext = () => ({
  accept: () => {},
  acceptExports: () => {},
  dispose: () => {},
  prune: () => {},
  invalidate: () => {},
  on: () => {},
  send: () => {},
  data: {},
});
export const updateStyle = () => {};
export const removeStyle = () => {};
export const injectQuery = (url) => url;
export default {};
`);
    }
    if (req.originalUrl.includes("dev-toolbar/entrypoint.js")) {
      res.setHeader("Content-Type", "application/javascript");
      return res.send(
        "// Dev toolbar disabled in preview mode\nexport default {};\n",
      );
    }

    // Restore the full URL - Express modifies req.url to strip the matched route prefix
    // but Astro expects the full path since it's configured with --base
    if (process.env.DEVSERVER_DEBUG === "1") {
      console.log(`[DevServer] Proxying ${req.originalUrl} to ${devServerUrl}`);
    }
    req.url = req.originalUrl;

    const basePath = `/vivd-studio/api/devpreview/${slug}/v${versionNumber}`;
    (req as DevPreviewProxyRequest).vivdDevPreviewTarget = devServerUrl;
    (req as DevPreviewProxyRequest).vivdDevPreviewBasePath = basePath;

    // Proxy to the actual dev server (reused proxy instance to avoid listener leaks).
    // Don't rewrite paths - Astro is configured with --base to expect the full path.
    return devPreviewProxy(req, res, next);
  },
);

// Dropped file upload endpoint (for chat drag-and-drop)
app.post(
  "/vivd-studio/api/upload-dropped-file/:slug/:version",
  upload.single("file"),
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

      const versionDir = getVersionDir(slug, versionNumber);

      if (!fs.existsSync(versionDir)) {
        return res.status(404).json({ error: "Project version not found" });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file provided" });
      }

      // Create .vivd/dropped-images directory
      const droppedImagesDir = path.join(versionDir, ".vivd", "dropped-images");
      if (!fs.existsSync(droppedImagesDir)) {
        fs.mkdirSync(droppedImagesDir, { recursive: true });
      }

      // Generate unique filename: uuid-originalname (with webp conversion for images)
      const uuid = crypto.randomUUID().split("-")[0]; // Short UUID prefix
      const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const convertedName = convertFilenameToWebp(sanitizedName);
      const uniqueFilename = `${uuid}-${convertedName}`;
      const filePath = path.join(droppedImagesDir, uniqueFilename);

      // Write file (converts to webp if applicable)
      await writeImageFile(file.buffer, file.originalname, filePath);
      touchProjectUpdatedAt(slug);

      // Return relative path from project root
      const relativePath = `.vivd/dropped-images/${uniqueFilename}`;

      return res.json({ success: true, path: relativePath });
    } catch (error) {
      console.error("Dropped image upload error:", error);
      return res.status(500).json({ error: "Upload failed" });
    }
  },
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
      const relativePath =
        typeof req.query.path === "string" ? req.query.path : "";
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
        // Sanitize filename and convert to webp if applicable
        const sanitizedName = file.originalname.replace(
          /[^a-zA-Z0-9._-]/g,
          "_",
        );
        const finalName = convertFilenameToWebp(sanitizedName);

        let filePath: string;
        try {
          const rel = relativePath
            ? path.posix.join(relativePath.replace(/\\/g, "/"), finalName)
            : finalName;
          filePath = safeJoin(versionDir, rel);
        } catch {
          return res.status(400).json({ error: "Invalid filename" });
        }

        // Write file (converts to webp if applicable)
        await writeImageFile(file.buffer, file.originalname, filePath);

        uploaded.push(
          relativePath
            ? path.posix.join(relativePath.replace(/\\/g, "/"), finalName)
            : finalName,
        );
      }

      touchProjectUpdatedAt(slug);
      return res.json({ success: true, uploaded });
    } catch (error) {
      console.error("Upload error:", error);
      return res.status(500).json({ error: "Upload failed" });
    }
  },
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

    // Add the version directory contents to the archive (excluding node_modules)
    archive.glob("**/*", {
      cwd: versionDir,
      ignore: ["node_modules/**"],
      dot: true,
    });

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
  }),
);

app.get("/vivd-studio/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`[OpenCode] Server manager ready (servers spawn on first task)`);
  console.log(`[DevServer] Dev server manager ready`);

  // Graceful shutdown for all servers
  const cleanup = () => {
    console.log("[Server] Shutting down...");
    serverManager.closeAll();
    devServerManager.closeAll();
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("exit", cleanup);
});
