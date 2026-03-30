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
import { devServerService } from "./services/project/DevServerService.js";
import { serverManager as opencodeServerManager } from "./opencode/serverManager.js";
import { usageReporter } from "./services/reporting/UsageReporter.js";
import { workspaceStateReporter } from "./services/reporting/WorkspaceStateReporter.js";
import { registerStudioRuntimeHttpRoutes } from "./httpRoutes/runtime.js";
import {
  injectBasePathScript,
  rewriteRootAssetUrlsInText,
  stripDevServerToolingFromHtml,
} from "./http/basePathRewrite.js";
import {
  createPreviewBridgeScript,
  injectPreviewBridgeScript,
} from "./http/previewBridge.js";
import { createRequireStudioAuth } from "./http/studioAuth.js";
import { handleStudioPreviewUpgrade } from "./http/devServerUpgrade.js";
import { registerStudioClientHttpRoutes } from "./httpRoutes/client.js";
import { validateStudioConfig } from "@vivd/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type DevPreviewProxyRequest = express.Request & {
  vivdDevPreviewTarget?: string;
  vivdDevPreviewBasePath?: string;
};

const FORWARDED_PREFIX_HEADER = "x-forwarded-prefix";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProxyBasePath(req: express.Request): string | null {
  const raw = req.get(FORWARDED_PREFIX_HEADER);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  return trimmed.replace(/\/+$/, "") || null;
}

function getSingleRouteParam(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string" && first.trim()) return first;
  }
  return null;
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

function decodeUriPath(value: string): string | null {
  try {
    // decodeURI intentionally does NOT decode reserved characters like "/" so we
    // don't accidentally turn "%2F" into path separators.
    return decodeURI(value);
  } catch {
    return null;
  }
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
    proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      const basePath =
        (req as DevPreviewProxyRequest).vivdDevPreviewBasePath || "";
      const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;

      // Rewrite redirects so root-relative Location headers stay within the proxy base.
      const rawLocation = proxyRes.headers["location"] as
        | string
        | string[]
        | undefined;
      if (base && rawLocation) {
        const rewriteLocation = (location: string) => {
          if (
            !location ||
            !location.startsWith("/") ||
            location.startsWith("//") ||
            location.startsWith("http://") ||
            location.startsWith("https://")
          ) {
            return location;
          }

          // Avoid double-prefixing.
          if (location === base || location.startsWith(`${base}/`)) return location;

          return `${base}${location}`;
        };

        if (typeof rawLocation === "string") {
          res.setHeader("location", rewriteLocation(rawLocation));
        } else if (Array.isArray(rawLocation)) {
          res.setHeader("location", rawLocation.map(rewriteLocation));
        }
      }

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
        if (!ct.includes("text/html")) {
          return responseBuffer;
        }

        const html = responseBuffer.toString("utf8");
        return Buffer.from(injectPreviewBridgeScript(html), "utf8");
      }

      let text = responseBuffer.toString("utf8");
      const isHtml = ct.includes("text/html");
      if (isHtml) {
        text = injectPreviewBridgeScript(text);
      }
      const shouldRewrite = Boolean(basePath && basePath !== "/");
      const rewritten = shouldRewrite
        ? rewriteRootAssetUrlsInText(text, basePath)
        : text;
      let finalText = isHtml ? stripDevServerToolingFromHtml(rewritten) : rewritten;

      // Inject base path rewrite script for HTML pages
      if (isHtml && shouldRewrite) {
        finalText = injectBasePathScript(finalText, basePath);
      }
      if (isHtml) {
        finalText = injectPreviewBridgeScript(finalText);
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
  const HOST = process.env.STUDIO_HOST || "0.0.0.0";
  const WORKSPACE_DIR =
    process.env.VIVD_WORKSPACE_DIR || process.env.WORKSPACE_DIR;
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

  const requireStudioAuth = () => createRequireStudioAuth(process.env);

  // TRPC middleware
  app.use(
    "/trpc",
    requireStudioAuth(),
    createExpressMiddleware({
      router: appRouter,
      createContext: ({ req, res }) => createContext(workspace, req, res),
    })
  );

  // Backend-compatible tRPC path (frontend expects this)
  app.use(
    "/vivd-studio/api/trpc",
    requireStudioAuth(),
    createExpressMiddleware({
      router: appRouter,
      createContext: ({ req, res }) => createContext(workspace, req, res),
    }),
  );

  app.get(
    "/vivd-studio/api/preview-bridge.js",
    requireStudioAuth(),
    (_req, res) => {
      res.type("application/javascript").send(createPreviewBridgeScript());
    },
  );

  registerStudioRuntimeHttpRoutes({
    app,
    workspace,
    requireStudioAuth,
    upload,
    getSingleRouteParam,
    decodeUriPath,
    isAllowedProjectFile,
    safeJoin,
    writeUploadedFile,
    getProxyBasePath,
    rewriteRootAssetUrlsInText,
    injectBasePathScript,
    devPreviewProxy,
  });

  const clientPath = path.join(__dirname, "client");
  const clientIndexPath = path.join(clientPath, "index.html");
  registerStudioClientHttpRoutes({
    app,
    requireStudioAuth,
    clientPath,
    clientIndexPath,
    getProxyBasePath,
    rewriteRootAssetUrlsInText,
    injectBasePathScript,
  });

  // Bind the port before workspace hydration/open completes so Fly and the
  // startup stub can hand off cleanly without connection-refused gaps. The
  // /health endpoint reports "starting" until the workspace is initialized.
  const server = app.listen(PORT, HOST, () => {
    console.log(`Studio server running on http://${HOST}:${PORT}`);
  });
  server.on("upgrade", (req, socket, head) => {
    void handleStudioPreviewUpgrade({
      req,
      socket,
      head,
      env: process.env,
      workspace,
      proxy: devPreviewProxy,
    }).then((handled) => {
      if (!handled && !socket.destroyed) {
        socket.destroy();
      }
    }).catch((error) => {
      console.error("[DevServer] WebSocket upgrade error:", error);
      if (!socket.destroyed) {
        socket.destroy();
      }
    });
  });

  if (WORKSPACE_DIR) {
    console.log(`Using workspace directory: ${WORKSPACE_DIR}`);
    await workspace.open(WORKSPACE_DIR);
    console.log(`Workspace ready at: ${workspace.getProjectPath()}`);
  } else if (REPO_URL) {
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
      "No VIVD_WORKSPACE_DIR/WORKSPACE_DIR or REPO_URL provided. Workspace not initialized."
    );
  }

  const projectSlug = (process.env.VIVD_PROJECT_SLUG || "").trim();
  const projectVersion = Number.parseInt(process.env.VIVD_PROJECT_VERSION || "", 10);
  const canReportWorkspaceState =
    workspace.isInitialized() &&
    projectSlug.length > 0 &&
    Number.isFinite(projectVersion) &&
    projectVersion > 0;

  if (canReportWorkspaceState) {
    workspaceStateReporter.start({
      workspace,
      slug: projectSlug,
      version: projectVersion,
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down studio...");
    await workspaceStateReporter.shutdown();
    await usageReporter.shutdown();
    await devServerService.close();
    await opencodeServerManager.closeAll();
    await workspace.cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error) => {
  console.error("Failed to start studio server:", error);
  process.exit(1);
});
