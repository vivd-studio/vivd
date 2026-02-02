import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";
import crypto from "node:crypto";
import multer from "multer";
import {
  createProxyMiddleware,
  responseInterceptor,
} from "http-proxy-middleware";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";
import { WorkspaceManager } from "./workspace/WorkspaceManager.js";
import { detectProjectType } from "./services/projectType.js";
import { devServerService } from "./services/DevServerService.js";
import { serverManager as opencodeServerManager } from "./opencode/serverManager.js";
import { usageReporter } from "./services/UsageReporter.js";
import { validateStudioConfig } from "@vivd/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type DevPreviewProxyRequest = express.Request & {
  vivdDevPreviewTarget?: string;
  vivdDevPreviewBasePath?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGitCloneError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("could not resolve host") ||
    m.includes("temporary failure in name resolution") ||
    m.includes("failed to connect") ||
    m.includes("couldn't connect") ||
    m.includes("connection refused") ||
    m.includes("connection timed out") ||
    m.includes("timed out") ||
    m.includes("network is unreachable") ||
    m.includes("connection reset") ||
    // libcurl-style HTTP errors
    m.includes("the requested url returned error: 502") ||
    m.includes("the requested url returned error: 503") ||
    m.includes("the requested url returned error: 504")
  );
}

async function cloneWorkspaceWithRetry(options: {
  workspace: WorkspaceManager;
  repoUrl: string;
  gitToken?: string;
  branch: string;
}): Promise<void> {
  const attempts = Math.max(
    1,
    parseInt(process.env.STUDIO_CLONE_ATTEMPTS || "12", 10) || 12,
  );
  const baseDelayMs = Math.max(
    250,
    parseInt(process.env.STUDIO_CLONE_DELAY_MS || "750", 10) || 750,
  );

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await options.workspace.clone(
        options.repoUrl,
        options.gitToken,
        options.branch,
      );
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = isTransientGitCloneError(message);
      const hasMoreAttempts = attempt < attempts;

      if (!isTransient || !hasMoreAttempts) {
        throw err;
      }

      const delayMs = Math.min(baseDelayMs * attempt, 5000);
      console.warn(
        `[Git] Clone failed (attempt ${attempt}/${attempts}): ${message}`,
      );
      console.log(`[Git] Retrying in ${delayMs}ms...`);

      await options.workspace.cleanup();
      await sleep(delayMs);
    }
  }
}

function safeJoin(root: string, targetPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, targetPath);

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("Invalid path");
  }

  return resolvedTarget;
}

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

  return (
    text
      .replace(
        new RegExp(`(^|[^\\w/])\\/(${prefixGroups})\\/`, "g"),
        `$1${base}/$2/`
      )
      // favicon-like root assets
      .replace(
        /(^|[^\w/])\/(favicon(?:-[^"'`()\s,]+)?\.(?:ico|png|svg))\b/g,
        `$1${base}/$2`
      )
  );
}

function stripDevServerToolingFromHtml(html: string): string {
  return html
    .replace(
      /<script\b[^>]*\bsrc=(["'])([^"']*\/@vite\/client[^"']*)\1[^>]*>\s*<\/script>/gi,
      ""
    )
    .replace(
      /<script\b[^>]*\bsrc=(["'])([^"']*dev-toolbar\/entrypoint\.js[^"']*)\1[^>]*>\s*<\/script>/gi,
      ""
    )
    .replace(
      /<link\b[^>]*\bhref=(["'])([^"']*\/@vite\/client[^"']*)\1[^>]*>/gi,
      ""
    )
    .replace(
      /<link\b[^>]*\bhref=(["'])([^"']*dev-toolbar\/[^"']*)\1[^>]*>/gi,
      ""
    );
}

/**
 * Generates a script that rewrites internal URLs to include the base path.
 * This ensures navigation links like href="/career" and fetch("/api/...") work
 * correctly within the preview iframe.
 */
function createBasePathRewriteScript(basePath: string): string {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  // Minified inline script - runs immediately to intercept all navigation
  return `<script data-vivd-basepath>(function(B){if(window.__vivdBasePath)return;window.__vivdBasePath=B;var defined=function(x){return typeof x!=='undefined'};var shouldRewrite=function(u){if(!u||typeof u!=='string')return false;if(u.startsWith(B)||u.startsWith('//')||u.startsWith('http:')||u.startsWith('https:')||u.startsWith('#')||u.startsWith('mailto:')||u.startsWith('tel:')||u.startsWith('javascript:')||u.startsWith('data:'))return false;return u.startsWith('/');};var rewrite=function(u){return shouldRewrite(u)?B+u:u;};document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(a){var h=a.getAttribute('href');if(shouldRewrite(h)){e.preventDefault();window.location.href=rewrite(h);}}},true);document.addEventListener('submit',function(e){var f=e.target;if(f&&f.tagName==='FORM'){var action=f.getAttribute('action');if(shouldRewrite(action))f.setAttribute('action',rewrite(action));}},true);if(defined(window.fetch)){var oFetch=window.fetch;window.fetch=function(u,o){return oFetch(rewrite(typeof u==='string'?u:u),o);};}if(defined(window.XMLHttpRequest)){var oOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return oOpen.call(this,m,rewrite(u));};}if(defined(window.history)){var oPush=history.pushState;var oReplace=history.replaceState;history.pushState=function(s,t,u){return oPush.call(this,s,t,rewrite(u));};history.replaceState=function(s,t,u){return oReplace.call(this,s,t,rewrite(u));};}})('${base}');</script>`;
}

/**
 * Injects the base path rewrite script into HTML.
 * The script is injected at the start of <head> to run before any other scripts.
 */
function injectBasePathScript(html: string, basePath: string): string {
  const script = createBasePathRewriteScript(basePath);

  // Try to inject after <head> tag
  const headMatch = html.match(/<head(\s[^>]*)?>|<head>/i);
  if (headMatch && headMatch.index !== undefined) {
    const insertPos = headMatch.index + headMatch[0].length;
    return html.slice(0, insertPos) + script + html.slice(insertPos);
  }

  // Fallback: inject after <!DOCTYPE> or at the very start
  const doctypeMatch = html.match(/<!DOCTYPE[^>]*>/i);
  if (doctypeMatch && doctypeMatch.index !== undefined) {
    const insertPos = doctypeMatch.index + doctypeMatch[0].length;
    return html.slice(0, insertPos) + script + html.slice(insertPos);
  }

  // Last resort: prepend
  return script + html;
}

// Configure multer for memory storage (uploads for Asset Explorer and chat)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

// Basic allowlist-style blocking for static file serving.
const BLOCKED_PATHS = [
  ".git",
  ".env",
  "node_modules",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "AGENTS.md",
  "tsconfig.json",
];

function isAllowedProjectFile(filePath: string): boolean {
  const segments = filePath.split("/");
  for (const segment of segments) {
    if (
      segment.startsWith(".") &&
      segment !== ".vivd" &&
      segment !== ".gitignore" &&
      segment !== ".env.example"
    ) {
      return false;
    }
  }

  for (const blocked of BLOCKED_PATHS) {
    if (filePath.includes(blocked)) return false;
  }

  return true;
}

async function writeUploadedFile(
  fullPath: string,
  buffer: Buffer
): Promise<void> {
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, buffer);
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
      const isHtml = ct.includes("text/html");
      let finalText = isHtml ? stripDevServerToolingFromHtml(rewritten) : rewritten;

      // Inject base path rewrite script for HTML pages
      if (isHtml && basePath) {
        finalText = injectBasePathScript(finalText, basePath);
      }

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

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3100", 10);
  const REPO_URL = process.env.REPO_URL;
  const GIT_TOKEN = process.env.GIT_TOKEN;
  const BRANCH = process.env.BRANCH || "main";

  // Ensure connected-mode configuration is consistent.
  // Some environments may not propagate STUDIO_ID reliably; generate one to avoid blocking usage.
  if (process.env.MAIN_BACKEND_URL && !process.env.STUDIO_ID) {
    process.env.STUDIO_ID = crypto.randomUUID();
    console.warn(
      `[Studio] MAIN_BACKEND_URL set but STUDIO_ID missing; generated ${process.env.STUDIO_ID}`,
    );
  }
  validateStudioConfig();

  // Initialize usage reporter for connected mode
  usageReporter.init();

  // CORS for development
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Initialize workspace
  const workspace = new WorkspaceManager();

  if (REPO_URL) {
    console.log(`Cloning repository: ${REPO_URL}`);
    await cloneWorkspaceWithRetry({
      workspace,
      repoUrl: REPO_URL,
      gitToken: GIT_TOKEN,
      branch: BRANCH,
    });
    console.log(`Repository cloned to: ${workspace.getProjectPath()}`);
  } else {
    console.log(
      "No REPO_URL provided. Running in development mode without git."
    );
  }

  // Health check endpoint for service discovery
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      initialized: workspace.isInitialized(),
    });
  });

  // Cleanup endpoint for sendBeacon on page leave (fire-and-forget)
  app.post("/vivd-studio/api/cleanup/preview-leave", (_req, res) => {
    try {
      if (workspace.isInitialized()) {
        const projectDir = workspace.getProjectPath();
        void opencodeServerManager.stopServer(projectDir);
      }
    } catch (err) {
      console.warn("[Cleanup] preview-leave failed:", err);
    }
    res.status(200).end();
  });

  // TRPC middleware
  app.use(
    "/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: () => createContext(workspace),
    })
  );

  // Backend-compatible tRPC path (frontend expects this)
  app.use(
    "/vivd-studio/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: () => createContext(workspace),
    }),
  );

  // Serve workspace files in a backend-compatible path:
  // /vivd-studio/api/projects/:slug/v:version/<file>
  app.use("/vivd-studio/api/projects", async (req, res, next) => {
    try {
      if (!workspace.isInitialized()) {
        return res.status(503).json({ error: "Workspace not initialized" });
      }

      const parts = req.path.split("/").filter(Boolean);
      if (parts.length < 2) {
        return res.status(400).json({ error: "Invalid path" });
      }

      // Ignore slug and version (single-workspace studio)
      const [, versionSegment, ...rest] = parts;
      if (!versionSegment.startsWith("v")) {
        return res.status(400).json({ error: "Invalid version" });
      }

      const relativePath = rest.join("/");
      if (!isAllowedProjectFile(relativePath)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const projectPath = workspace.getProjectPath();
      const resolvedPath = safeJoin(projectPath, relativePath);

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      return res.sendFile(resolvedPath);
    } catch (err) {
      return next(err);
    }
  });

  // Serve raw asset files in a backend-compatible path:
  // /vivd-studio/api/assets/:slug/:version/<file>
  app.use("/vivd-studio/api/assets", async (req, res, next) => {
    try {
      if (!workspace.isInitialized()) {
        return res.status(503).json({ error: "Workspace not initialized" });
      }

      const parts = req.path.split("/").filter(Boolean);
      if (parts.length < 2) {
        return res.status(400).json({ error: "Invalid path" });
      }

      // Ignore slug and version (single-workspace studio)
      const [, , ...rest] = parts;

      const relativePath = rest.join("/");
      if (!isAllowedProjectFile(relativePath)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const projectPath = workspace.getProjectPath();
      const resolvedPath = safeJoin(projectPath, relativePath);

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      return res.sendFile(resolvedPath);
    } catch (err) {
      return next(err);
    }
  });

  // Dropped file upload endpoint (for chat drag-and-drop)
  app.post(
    "/vivd-studio/api/upload-dropped-file/:slug/:version",
    upload.single("file"),
    async (req, res) => {
      try {
        if (!workspace.isInitialized()) {
          return res.status(503).json({ error: "Workspace not initialized" });
        }

        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: "No file provided" });
        }

        const projectPath = workspace.getProjectPath();
        const droppedImagesDir = path.join(
          projectPath,
          ".vivd",
          "dropped-images",
        );
        await fs.ensureDir(droppedImagesDir);

        const uuid = crypto.randomUUID().split("-")[0];
        const sanitizedName = file.originalname.replace(
          /[^a-zA-Z0-9._-]/g,
          "_",
        );
        const uniqueFilename = `${uuid}-${sanitizedName}`;
        const filePath = path.join(droppedImagesDir, uniqueFilename);

        await writeUploadedFile(filePath, file.buffer);

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
        if (!workspace.isInitialized()) {
          return res.status(503).json({ error: "Workspace not initialized" });
        }

        const relativePath =
          typeof req.query.path === "string" ? req.query.path : "";

        const projectPath = workspace.getProjectPath();

        let targetDir: string;
        try {
          targetDir = relativePath
            ? safeJoin(projectPath, relativePath)
            : projectPath;
        } catch {
          return res.status(400).json({ error: "Invalid path" });
        }

        await fs.ensureDir(targetDir);

        const files = req.files as Express.Multer.File[];
        const uploaded: string[] = [];

        for (const file of files) {
          const sanitizedName = file.originalname.replace(
            /[^a-zA-Z0-9._-]/g,
            "_",
          );

          let filePath: string;
          try {
            const rel = relativePath
              ? path.posix.join(
                  relativePath.replace(/\\/g, "/"),
                  sanitizedName,
                )
              : sanitizedName;
            filePath = safeJoin(projectPath, rel);
          } catch {
            return res.status(400).json({ error: "Invalid filename" });
          }

          await writeUploadedFile(filePath, file.buffer);
          uploaded.push(
            relativePath
              ? path.posix.join(
                  relativePath.replace(/\\/g, "/"),
                  sanitizedName,
                )
              : sanitizedName,
          );
        }

        return res.json({ success: true, uploaded });
      } catch (error) {
        console.error("Upload error:", error);
        return res.status(500).json({ error: "Upload failed" });
      }
    },
  );

  // Preview route (static files or dev server proxy)
  app.use("/preview", async (req, res, next) => {
    try {
      if (!workspace.isInitialized()) {
        return res.status(503).json({ error: "Workspace not initialized" });
      }

      const projectPath = workspace.getProjectPath();
      const config = detectProjectType(projectPath);
      const basePath = "/preview";

      if (config.mode === "devserver") {
        // Ensure dev server exists (start async if needed)
        if (!devServerService.hasServer()) {
          await devServerService.getOrStartDevServer(projectPath, basePath);
        }

        const devServerUrl = devServerService.getDevServerUrl();
        if (!devServerUrl) {
          const status = devServerService.getDevServerStatus();
          if (status === "starting" || status === "installing") {
            return res
              .status(503)
              .json({ error: "Dev server is starting...", status });
          }
          return res
            .status(503)
            .json({ error: "Dev server not running", status });
        }

        // Intercept Vite HMR client and dev toolbar requests - return no-op modules.
        // This prevents WebSocket connection attempts when embedding the dev server behind our proxy.
        if (req.originalUrl.includes("/@vite/client")) {
          res.setHeader("Content-Type", "application/javascript");
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
            "// Dev toolbar disabled in preview mode\nexport default {};\n"
          );
        }

        // Restore the full URL - Express strips the mount prefix, but the dev server
        // is configured with --base and expects the full path.
        if (process.env.DEVSERVER_DEBUG === "1") {
          console.log(
            `[DevServer] Proxying ${req.originalUrl} to ${devServerUrl}`
          );
        }
        req.url = req.originalUrl;

        (req as DevPreviewProxyRequest).vivdDevPreviewTarget = devServerUrl;
        (req as DevPreviewProxyRequest).vivdDevPreviewBasePath = basePath;

        return devPreviewProxy(req, res, next);
      }

      // Static mode: serve files from the workspace directory.
      // Express has already stripped the "/preview" prefix from req.path.
      const requestedPath = req.path.replace(/^\/+/, "");
      const relativePath = requestedPath.length ? requestedPath : "index.html";

      let resolvedPath: string;
      try {
        resolvedPath = safeJoin(projectPath, relativePath);
      } catch {
        return res.status(400).json({ error: "Invalid path" });
      }

      // Directory -> index.html
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        resolvedPath = path.join(resolvedPath, "index.html");
      }

      // Clean URLs -> try appending .html
      if (!fs.existsSync(resolvedPath) && !path.extname(resolvedPath)) {
        const withHtml = `${resolvedPath}.html`;
        if (fs.existsSync(withHtml)) {
          resolvedPath = withHtml;
        }
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      if (resolvedPath.endsWith(".html")) {
        const content = await fs.readFile(resolvedPath, "utf-8");
        let processed = rewriteRootAssetUrlsInText(content, basePath);
        processed = injectBasePathScript(processed, basePath);
        res.setHeader("Content-Type", "text/html");
        return res.send(processed);
      }

      return res.sendFile(resolvedPath);
    } catch (err) {
      return next(err);
    }
  });

  // Backend-compatible static preview endpoint:
  // /vivd-studio/api/preview/:slug/v:version/<file>
  app.use("/vivd-studio/api/preview/:slug/v:version", async (req, res, next) => {
    try {
      if (!workspace.isInitialized()) {
        return res.status(503).json({ error: "Workspace not initialized" });
      }

      const { slug, version } = req.params;
      const basePath = `/vivd-studio/api/preview/${slug}/v${version}`;

      const urlWithoutQuery = req.url.split("?")[0];
      const rawFilePath = urlWithoutQuery.startsWith("/")
        ? urlWithoutQuery.slice(1)
        : urlWithoutQuery;
      const filePath = rawFilePath || "index.html";

      if (!isAllowedProjectFile(filePath)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const projectPath = workspace.getProjectPath();
      let resolvedPath: string;
      try {
        resolvedPath = safeJoin(projectPath, filePath);
      } catch {
        return res.status(400).json({ error: "Invalid path" });
      }

      if (
        fs.existsSync(resolvedPath) &&
        fs.statSync(resolvedPath).isDirectory()
      ) {
        resolvedPath = path.join(resolvedPath, "index.html");
      }

      if (!fs.existsSync(resolvedPath) && !path.extname(resolvedPath)) {
        const withHtml = `${resolvedPath}.html`;
        if (fs.existsSync(withHtml)) {
          resolvedPath = withHtml;
        }
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      if (resolvedPath.endsWith(".html")) {
        const content = await fs.readFile(resolvedPath, "utf-8");
        let processed = rewriteRootAssetUrlsInText(content, basePath);
        processed = injectBasePathScript(processed, basePath);
        res.setHeader("Content-Type", "text/html");
        return res.send(processed);
      }

      return res.sendFile(resolvedPath);
    } catch (err) {
      return next(err);
    }
  });

  // Backend-compatible dev server proxy:
  // /vivd-studio/api/devpreview/:slug/v:version/*
  app.use("/vivd-studio/api/devpreview/:slug/v:version", async (req, res, next) => {
    try {
      if (!workspace.isInitialized()) {
        return res.status(503).json({ error: "Workspace not initialized" });
      }

      const { slug, version } = req.params;
      const projectPath = workspace.getProjectPath();
      const basePath = `/vivd-studio/api/devpreview/${slug}/v${version}`;

      const config = detectProjectType(projectPath);
      if (config.mode !== "devserver") {
        return res.status(400).json({ error: "Not a dev server project" });
      }

      if (!devServerService.hasServer()) {
        await devServerService.getOrStartDevServer(projectPath, basePath);
      }

      const devServerUrl = devServerService.getDevServerUrl();
      if (!devServerUrl) {
        const status = devServerService.getDevServerStatus();
        if (status === "starting" || status === "installing") {
          return res
            .status(503)
            .json({ error: "Dev server is starting...", status });
        }
        return res.status(503).json({ error: "Dev server not running", status });
      }

      // Intercept Vite HMR client and dev toolbar requests - return no-op modules.
      if (req.originalUrl.includes("/@vite/client")) {
        res.setHeader("Content-Type", "application/javascript");
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

      if (process.env.DEVSERVER_DEBUG === "1") {
        console.log(`[DevServer] Proxying ${req.originalUrl} to ${devServerUrl}`);
      }

      req.url = req.originalUrl;

      (req as DevPreviewProxyRequest).vivdDevPreviewTarget = devServerUrl;
      (req as DevPreviewProxyRequest).vivdDevPreviewBasePath = basePath;

      return devPreviewProxy(req, res, next);
    } catch (err) {
      return next(err);
    }
  });

  // Serve bundled client in production
  const clientPath = path.join(__dirname, "client");
  app.get("/", (_req, res) => {
    res.redirect(302, "/vivd-studio");
  });
  app.use("/vivd-studio", express.static(clientPath));

  // SPA fallback
  // Express 5 uses `path-to-regexp` which does not accept `"*"` as a route pattern.
  // Use a regex to match everything instead.
  app.get(/.*/, (req, res, next) => {
    // Skip API routes
    if (
      req.path.startsWith("/trpc") ||
      req.path.startsWith("/preview") ||
      req.path.startsWith("/vivd-studio/api/")
    ) {
      return next();
    }
    res.sendFile(path.join(clientPath, "index.html"));
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down studio...");
    await usageReporter.shutdown();
    devServerService.close();
    opencodeServerManager.closeAll();
    await workspace.cleanup();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  app.listen(PORT, () => {
    console.log(`Studio server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start studio server:", error);
  process.exit(1);
});
