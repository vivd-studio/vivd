import "./init-env";
import { getModeConfig, validateSaasConfig } from "@vivd/shared/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { convertFilenameToWebp, writeImageFile } from "./utils/imageUtils";
import multer from "multer";
import archiver from "archiver";
import {
  createProxyMiddleware,
  responseInterceptor,
} from "http-proxy-middleware";
import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { serverManager } from "./opencode";
import { devServerManager } from "./devserver";
import { detectProjectType } from "./devserver/projectType";
import { toNodeHandler } from "better-auth/node";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { auth } from "./auth";
import { appRouter } from "./routers/appRouter";
import { createContext } from "./trpc";
import {
  getProjectsDir,
  getTenantProjectsDir,
  getActiveTenantId,
  getVersionDir,
  touchProjectUpdatedAt,
} from "./generator/versionUtils";
import { createImportRouter } from "./routes/import";
import { safeJoin } from "./fs/safePaths";
import { db } from "./db";
import { projectMember } from "./db/schema";
import { eq } from "drizzle-orm";
import { buildService } from "./services/BuildService";
import { createS3Client, getObjectStorageConfigFromEnv, getObjectBuffer } from "./services/ObjectStorageService";
import { getProjectArtifactKeyPrefix } from "./services/ProjectStoragePaths";

const app = express();
const PORT = process.env.PORT || 3000;

type DevPreviewProxyRequest = express.Request & {
  vivdDevPreviewTarget?: string;
  vivdDevPreviewBasePath?: string;
};

function getRouteParam(req: express.Request, key: string): string | undefined {
  const value = (req.params as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function rewriteRootAssetUrlsInText(text: string, basePath: string): string {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const baseNoLeadingSlash = base.replace(/^\/+/, "");
  const escapedBaseNoLeadingSlash = baseNoLeadingSlash.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );

  // Prefix root-relative URLs in common HTML attributes so that in-preview navigation
  // like `<a href="/de">` stays within `/vivd-studio/api/preview/...`.
  const rewriteRootRelativeAttributes = (input: string) =>
    input.replace(
      new RegExp(
        String.raw`\b(href|src|action|poster|data|content)=(["'])\/(?!\/)(?!${escapedBaseNoLeadingSlash}(?:\/|$))([^"']*)\2`,
        "g",
      ),
      `$1=$2${base}/$3$2`,
    );

  // Best-effort rewrite for common client-side navigations / redirects in inline scripts.
  const rewriteRootRelativeJsNavigations = (input: string) =>
    input
      // Common pattern in generated sites: `const baseUrl = "/";`
      .replace(
        /\b(const|let|var)\s+baseUrl\s*=\s*(["'])\/\2/g,
        `$1 baseUrl = $2${base}/$2`,
      )
      .replace(
        /\bbaseUrl\s*=\s*(["'])\/\1/g,
        `baseUrl = "${
          base.replace(/"/g, '\\"')
        }/"`,
      )
      // Direct navigations: location.replace('/foo'), location.assign('/foo')
      .replace(
        new RegExp(
          String.raw`(\b(?:window\.)?location\.(?:assign|replace)\(\s*)(["'])\/(?!\/)(?!${escapedBaseNoLeadingSlash}(?:\/|$))`,
          "g",
        ),
        `$1$2${base}/`,
      )
      // Assignments: location.href = '/foo', location.pathname = '/foo'
      .replace(
        new RegExp(
          String.raw`(\b(?:window\.)?location\.(?:href|pathname)\s*=\s*)(["'])\/(?!\/)(?!${escapedBaseNoLeadingSlash}(?:\/|$))`,
          "g",
        ),
        `$1$2${base}/`,
      );

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

  // Note: This is a best-effort rewrite to keep bucket-backed previews functional
  // under a nested base path; it intentionally rewrites some root-relative navigations.
  return (
    rewriteRootRelativeJsNavigations(rewriteRootRelativeAttributes(text))
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

    // Prevent accidental exposure of tenant storage paths via the legacy static root.
    if (slug === "tenants") {
      return res.status(404).json({ error: "Not found" });
    }

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
  express.static(getTenantProjectsDir(), { dotfiles: "allow" }),
  express.static(getProjectsDir(), { dotfiles: "allow" }),
);
// Security whitelist for external preview (unauthenticated access)
const ALLOWED_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".webm",
  ".mp3",
  ".ogg",
  ".wav",
  ".pdf",
  ".txt",
  ".xml",
]);

const BLOCKED_PATHS = [
  ".git",
  ".vivd",
  ".env",
  "node_modules",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "AGENTS.md",
  "tsconfig.json",
  "astro.config",
  "vite.config",
];

function isAllowedPreviewFile(filePath: string): boolean {
  // Block hidden files (except root path)
  if (filePath.startsWith(".") && filePath !== "") {
    return false;
  }

  // Block known sensitive paths
  for (const blocked of BLOCKED_PATHS) {
    if (filePath.includes(blocked)) {
      return false;
    }
  }

  // Check path segments for hidden files/folders
  const segments = filePath.split("/");
  for (const segment of segments) {
    if (segment.startsWith(".") && segment !== ".well-known") {
      return false;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  // Allow directories (no extension) or whitelisted extensions
  return ext === "" || ALLOWED_EXTENSIONS.has(ext);
}

function isObjectNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const anyErr = err as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
    Code?: string;
    code?: string;
  };

  const status = anyErr.$metadata?.httpStatusCode;
  if (status === 404) return true;

  const name = String(anyErr.name || "");
  const code = String(anyErr.Code || anyErr.code || "");
  return (
    name === "NoSuchKey" ||
    name === "NotFound" ||
    code === "NoSuchKey" ||
    code === "NotFound"
  );
}

function normalizePreviewRelativePath(filePath: string): string | null {
  if (filePath.includes("\0")) return null;
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return "";
  if (segments.some((seg) => seg === "." || seg === "..")) return null;
  return segments.join("/");
}

function buildPreviewCandidates(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const trimmed = normalized.replace(/\/+$/, "");

  if (!trimmed) return ["index.html"];

  const candidates = new Set<string>();
  candidates.add(trimmed);

  const ext = path.posix.extname(trimmed);
  if (!ext) {
    candidates.add(`${trimmed}.html`);
    candidates.add(`${trimmed}/index.html`);
  }

  if (normalized.endsWith("/")) {
    candidates.add(`${trimmed}/index.html`);
  }

  return Array.from(candidates);
}

type PreviewBucketConfig = {
  client: S3Client;
  bucket: string;
};

let previewBucketConfig: PreviewBucketConfig | null | undefined;

function getPreviewBucketConfig(): PreviewBucketConfig | null {
  if (previewBucketConfig !== undefined) return previewBucketConfig;

  try {
    const config = getObjectStorageConfigFromEnv(process.env);
    previewBucketConfig = {
      client: createS3Client(config),
      bucket: config.bucket,
    };
  } catch {
    previewBucketConfig = null;
  }

  return previewBucketConfig;
}

function isResponseClosed(
  res: express.Response,
  req?: express.Request,
): boolean {
  if (req?.aborted) return true;
  if (res.writableEnded || res.writableFinished) return true;
  if ((res as any).destroyed) return true;
  return false;
}

function isClientDisconnectedError(err: unknown): boolean {
  const code = (err as any)?.code;
  return (
    code === "ERR_STREAM_UNABLE_TO_PIPE" ||
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    code === "ECONNRESET" ||
    code === "EPIPE"
  );
}

async function tryServeFromBucket(options: {
  req?: express.Request;
  res: express.Response;
  slug: string;
  version: number;
  kind: "source" | "preview";
  filePath: string;
}): Promise<"served" | "not_found" | "disabled"> {
  const storage = getPreviewBucketConfig();
  if (!storage) return "disabled";

  const rel = normalizePreviewRelativePath(options.filePath);
  if (rel === null) return "not_found";

  const keyPrefix = getProjectArtifactKeyPrefix({
    tenantId: getActiveTenantId(),
    slug: options.slug,
    version: options.version,
    kind: options.kind,
  });

  const candidates = buildPreviewCandidates(rel || "index.html");

  for (const candidate of candidates) {
    if (isResponseClosed(options.res, options.req)) return "served";

    const key = `${keyPrefix}/${candidate}`;

    try {
      if (candidate.endsWith(".html")) {
        const { buffer } = await getObjectBuffer({
          client: storage.client,
          bucket: storage.bucket,
          key,
        });
        if (isResponseClosed(options.res, options.req)) return "served";
        const basePath = `/vivd-studio/api/preview/${options.slug}/v${options.version}`;
        const rewritten = rewriteRootAssetUrlsInText(
          buffer.toString("utf-8"),
          basePath,
        );
        options.res.type("html");
        options.res.setHeader("Content-Type", "text/html");
        options.res.send(rewritten);
        return "served";
      }

      const response = await storage.client.send(
        new GetObjectCommand({
          Bucket: storage.bucket,
          Key: key,
        }),
      );

      if (isResponseClosed(options.res, options.req)) return "served";

      const ext = path.extname(candidate);
      if (ext) {
        // Prefer inferring from the file extension because bucket uploads may not
        // carry accurate ContentType metadata (often defaults to octet-stream).
        options.res.type(ext);
      } else if (typeof response.ContentType === "string" && response.ContentType.length > 0) {
        options.res.setHeader("Content-Type", response.ContentType);
      } else {
        options.res.type("application/octet-stream");
      }
      if (typeof response.ContentLength === "number") {
        options.res.setHeader("Content-Length", String(response.ContentLength));
      }

      const body = response.Body;
      if (!body) {
        options.res.status(404).json({ error: "File not found" });
        return "served";
      }

      if (body instanceof Readable) {
        const destroyBody = () => {
          if (!body.destroyed) body.destroy();
        };
        const onClose = () => destroyBody();
        const onAborted = () => destroyBody();

        options.res.on("close", onClose);
        options.req?.on("aborted", onAborted);
        try {
          await pipeline(body, options.res);
        } catch (err) {
          // Client navigated away / closed the connection; avoid noisy logs and
          // don't fall back to FS (which can cause additional errors).
          if (isClientDisconnectedError(err) || isResponseClosed(options.res, options.req)) {
            destroyBody();
            return "served";
          }
          throw err;
        } finally {
          options.res.off("close", onClose);
          options.req?.off("aborted", onAborted);
        }
        return "served";
      }

      if (
        typeof body === "object" &&
        body !== null &&
        "transformToByteArray" in body &&
        typeof (body as any).transformToByteArray === "function"
      ) {
        const bytes = await (body as any).transformToByteArray();
        if (isResponseClosed(options.res, options.req)) return "served";
        options.res.send(Buffer.from(bytes));
        return "served";
      }

      if (typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array) {
        if (isResponseClosed(options.res, options.req)) return "served";
        options.res.send(body);
        return "served";
      }

      // Fallback: stringify unknown body types.
      if (isResponseClosed(options.res, options.req)) return "served";
      options.res.send(String(body));
      return "served";
    } catch (err) {
      if (isObjectNotFoundError(err)) {
        continue;
      }
      if (isClientDisconnectedError(err) || isResponseClosed(options.res, options.req)) {
        return "served";
      }
      console.warn(`[Preview] Bucket fetch failed (key=${key}):`, err);
      return "not_found";
    }
  }

  return "not_found";
}

// Secure external preview endpoint (unauthenticated but filtered)
app.use("/vivd-studio/api/preview/:slug/v:version", async (req, res) => {
  const slug = getRouteParam(req, "slug");
  const version = getRouteParam(req, "version");
  if (!slug || !version) {
    return res.status(400).json({ error: "Invalid route parameters" });
  }

  // req.url contains the path relative to the mount point (e.g. "/" or "/index.html")
  // If mounted at /vivd-studio/api/preview/:slug/v:version, then:
  // - Request to .../v1/          -> req.url = "/"
  // - Request to .../v1/foo.html  -> req.url = "/foo.html"
  // Strip query string before processing (cache-busting params like ?_vivd=0)
  const urlWithoutQuery = req.url.split("?")[0];
  const rawFilePath = urlWithoutQuery.startsWith("/")
    ? urlWithoutQuery.slice(1)
    : urlWithoutQuery;
  const filePath = rawFilePath || "index.html";

  // Security: check whitelist
  if (!isAllowedPreviewFile(filePath)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const versionNumber = Number.parseInt(version, 10);
  if (!Number.isFinite(versionNumber) || versionNumber < 1) {
    return res.status(400).json({ error: "Invalid version" });
  }

  const versionDir = getVersionDir(slug, versionNumber);

  const config = fs.existsSync(versionDir)
    ? detectProjectType(versionDir)
    : { framework: "generic" as const, mode: "static" as const, packageManager: "npm" as const };

  // Prefer serving from object storage when configured.
  if (config.framework === "astro") {
    const served = await tryServeFromBucket({
      req,
      res,
      slug,
      version: versionNumber,
      kind: "preview",
      filePath,
    });
    if (served === "served") return;
  } else {
    const served = await tryServeFromBucket({
      req,
      res,
      slug,
      version: versionNumber,
      kind: "source",
      filePath,
    });
    if (served === "served") return;
  }

  if (!fs.existsSync(versionDir)) {
    return res.status(404).json({ error: "Project not found" });
  }

  if (config.framework === "astro") {
    // For Astro projects, serve from dist/ if build is ready (fallback when bucket isn't configured).
    const buildPath = buildService.getBuildPath(versionDir);
    if (!buildPath) {
      const status = buildService.getBuildStatus(versionDir);
      return res.status(503).json({
        error: "Build in progress",
        status: status?.status || "pending",
      });
    }

    // Serve from build output
    let resolvedPath: string;
    try {
      resolvedPath = safeJoin(buildPath, filePath);
    } catch {
      return res.status(400).json({ error: "Invalid path" });
    }

    // Try the exact path, then with index.html for directories
    if (fs.existsSync(resolvedPath)) {
      if (fs.statSync(resolvedPath).isDirectory()) {
        resolvedPath = path.join(resolvedPath, "index.html");
      }
    } else if (!path.extname(resolvedPath)) {
      // Try appending .html for clean URLs
      const withHtml = resolvedPath + ".html";
      if (fs.existsSync(withHtml)) {
        resolvedPath = withHtml;
      }
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "File not found" });
    }

    // Rewrite asset URLs in HTML files to include the preview base path
    if (resolvedPath.endsWith(".html")) {
      const content = fs.readFileSync(resolvedPath, "utf-8");
      const basePath = `/vivd-studio/api/preview/${slug}/v${version}`;
      const rewritten = rewriteRootAssetUrlsInText(content, basePath);
      res.setHeader("Content-Type", "text/html");
      return res.send(rewritten);
    }

    return res.sendFile(resolvedPath);
  }

  // Static HTML: serve from version dir (filtered)
  let resolvedPath: string;
  try {
    resolvedPath = safeJoin(versionDir, filePath);
  } catch {
    return res.status(400).json({ error: "Invalid path" });
  }

  // Try the exact path, then with index.html for directories
  if (fs.existsSync(resolvedPath)) {
    if (fs.statSync(resolvedPath).isDirectory()) {
      resolvedPath = path.join(resolvedPath, "index.html");
    }
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: "File not found" });
  }

  return res.sendFile(resolvedPath);
});

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

    const slug = getRouteParam(req, "slug");
    const version = getRouteParam(req, "version");
    if (!slug || !version) {
      return res.status(400).json({ error: "Invalid route parameters" });
    }

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

      const slug = getRouteParam(req, "slug");
      const version = getRouteParam(req, "version");
      if (!slug || !version) {
        return res.status(400).json({ error: "Invalid route parameters" });
      }
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

      const slug = getRouteParam(req, "slug");
      const version = getRouteParam(req, "version");
      if (!slug || !version) {
        return res.status(400).json({ error: "Invalid route parameters" });
      }
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

    const slug = getRouteParam(req, "slug");
    const version = getRouteParam(req, "version");
    if (!slug || !version) {
      return res.status(400).json({ error: "Invalid route parameters" });
    }
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

// Cleanup endpoint for sendBeacon on page leave (no auth - fire and forget)
// Only stops opencode server; dev server has its own idle timeout
app.post(
  "/vivd-studio/api/cleanup/preview-leave",
  express.json(),
  (req, res) => {
    const { slug, version } = req.body;
    if (slug && version) {
      const versionDir = getVersionDir(slug, version);
      void serverManager.stopServer(versionDir);
      console.log(`[Cleanup] Preview leave: stopping opencode server for ${slug}/v${version}`);
    }
    res.status(200).end();
  },
);

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

// Validate SaaS configuration if enabled
validateSaasConfig();

// Log mode for debugging
console.log("[Mode]", getModeConfig());

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
