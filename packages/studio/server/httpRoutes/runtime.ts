import express from "express";
import path from "path";
import fs from "fs-extra";
import crypto from "node:crypto";
import type { Multer } from "multer";

import { detectProjectType } from "../services/project/projectType.js";
import { devServerService } from "../services/project/DevServerService.js";
import { projectTouchReporter } from "../services/reporting/ProjectTouchReporter.js";
import {
  runtimeQuiesceCoordinator as defaultRuntimeQuiesceCoordinator,
  type RuntimeQuiesceCoordinator,
} from "../services/runtime/RuntimeQuiesceCoordinator.js";
import { requestBucketSync } from "../services/sync/AgentTaskSyncService.js";
import type { WorkspaceManager } from "../workspace/WorkspaceManager.js";
import {
  createStudioBootstrapContractPayload,
  createStudioBootstrapHandler,
  getStudioAccessToken,
  getStudioId,
  sendStudioBootstrapContractJson,
  setStudioBootstrapStatusHeaders,
} from "../http/studioAuth.js";
import {
  normalizeStudioWorkingImageUpload,
  shouldNormalizeStudioWorkingImageUpload,
} from "../services/uploads/uploadNormalization.js";
import { pruneStudioChatAttachments } from "../services/uploads/chatAttachmentRetention.js";
import { injectPreviewBridgeScript } from "../http/previewBridge.js";
import {
  isStudioChatAttachmentDirectory,
  STUDIO_CHAT_ATTACHMENT_DIRECTORY,
} from "@studio/shared/chatAttachmentPolicy";

type DevPreviewProxyRequest = express.Request & {
  vivdDevPreviewTarget?: string;
  vivdDevPreviewBasePath?: string;
};

type StudioRuntimeHttpRoutesDeps = {
  app: express.Express;
  workspace: WorkspaceManager;
  requireStudioAuth: () => express.RequestHandler;
  upload: Pick<Multer, "single" | "array">;
  getSingleRouteParam: (
    value: string | string[] | undefined,
  ) => string | null;
  decodeUriPath: (value: string) => string | null;
  isAllowedProjectFile: (filePath: string) => boolean;
  safeJoin: (root: string, targetPath: string) => string;
  writeUploadedFile: (fullPath: string, buffer: Buffer) => Promise<void>;
  getProxyBasePath: (req: express.Request) => string | null;
  rewriteRootAssetUrlsInText: (text: string, basePath: string) => string;
  injectBasePathScript: (html: string, basePath: string) => string;
  devPreviewProxy: express.RequestHandler;
  onRuntimeActivity?: () => void;
  drainRuntimeTransportForSuspend?: () => void;
  runtimeQuiesceCoordinator?: {
    getQuiesceStatus: RuntimeQuiesceCoordinator["getQuiesceStatus"];
    quiesceForSuspend: RuntimeQuiesceCoordinator["quiesceForSuspend"];
    resumeAfterActivity: () => Promise<void> | void;
  };
};

function readSingleHeaderValue(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (Array.isArray(value)) {
    const first = value.find(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
    return first?.trim() || null;
  }
  return null;
}

function isSuspendCleanupRequest(req: express.Request): boolean {
  const contentType =
    readSingleHeaderValue(req.headers["content-type"])?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return false;
  }

  const contentLengthHeader = readSingleHeaderValue(req.headers["content-length"]);
  const contentLength = Number.parseInt(contentLengthHeader ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > 0) {
    return false;
  }

  const transferEncoding = readSingleHeaderValue(req.headers["transfer-encoding"]);
  if (transferEncoding) {
    return false;
  }

  return true;
}

export function resolveRuntimeRequestedFilePath(options: {
  restPath: string;
  queryPath: unknown;
  decodeUriPath: (value: string) => string | null;
}): string | null {
  const queryPath =
    typeof options.queryPath === "string"
      ? options.queryPath.trim()
      : Array.isArray(options.queryPath) &&
          typeof options.queryPath[0] === "string"
        ? options.queryPath[0].trim()
        : "";
  if (queryPath) {
    try {
      return decodeURIComponent(queryPath);
    } catch {
      const decodedQueryPath = options.decodeUriPath(queryPath);
      if (decodedQueryPath) {
        return decodedQueryPath;
      }
    }
  }

  if (!options.restPath) {
    return null;
  }

  return options.decodeUriPath(options.restPath);
}

export function resolveForwardedRuntimeBasePath(
  routeBasePath: string,
  proxyBasePath: string | null,
): string {
  const normalizedRouteBasePath = routeBasePath.startsWith("/")
    ? routeBasePath
    : `/${routeBasePath}`;
  const trimmedRouteBasePath =
    normalizedRouteBasePath === "/"
      ? normalizedRouteBasePath
      : normalizedRouteBasePath.replace(/\/+$/, "");

  if (!proxyBasePath) {
    return trimmedRouteBasePath;
  }

  const trimmedProxyBasePath = proxyBasePath.replace(/\/+$/, "");
  if (!trimmedProxyBasePath) {
    return trimmedRouteBasePath;
  }

  return `${trimmedProxyBasePath}${trimmedRouteBasePath}`;
}

export function registerStudioRuntimeHttpRoutes(
  deps: StudioRuntimeHttpRoutesDeps,
) {
  const {
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
    onRuntimeActivity,
  } = deps;
  const runtimeQuiesceCoordinator =
    deps.runtimeQuiesceCoordinator ?? defaultRuntimeQuiesceCoordinator;

  const resumeRuntimeAfterActivity: express.RequestHandler = (_req, _res, next) => {
    onRuntimeActivity?.();
    void runtimeQuiesceCoordinator.resumeAfterActivity();
    next();
  };

  const serveWorkspaceFile = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
    options: { routeKind: "projects" | "assets" },
  ) => {
    try {
      if (!workspace.isInitialized()) {
        return res.status(503).json({ error: "Workspace not initialized" });
      }

      const parts = req.path.split("/").filter(Boolean);
      if (parts.length < 2) {
        return res.status(400).json({ error: "Invalid path" });
      }

      const versionSegment =
        options.routeKind === "projects" ? parts[1] : `v${parts[1]}`;
      if (!versionSegment?.startsWith("v")) {
        return res.status(400).json({ error: "Invalid version" });
      }

      const relativePath = resolveRuntimeRequestedFilePath({
        restPath: parts.slice(2).join("/"),
        queryPath: req.query?.path,
        decodeUriPath,
      });
      if (!relativePath) {
        return res.status(400).json({ error: "Invalid path" });
      }
      if (!isAllowedProjectFile(relativePath)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const projectPath = workspace.getProjectPath();
      const resolvedPath = safeJoin(projectPath, relativePath);

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      return res.sendFile(resolvedPath, { dotfiles: "allow" });
    } catch (err) {
      return next(err);
    }
  };

  // Health check endpoint for service discovery
  app.get("/health", (_req, res) => {
    const initialized = workspace.isInitialized();
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "no-store");
    res.json({
      status: initialized ? "ok" : "starting",
      initialized,
    });
  });

  app.options("/vivd-studio/api/bootstrap-status", (_req, res) => {
    setStudioBootstrapStatusHeaders(res);
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(204).end();
  });

  app.get("/vivd-studio/api/bootstrap-status", (_req, res) => {
    if (!workspace.isInitialized()) {
      return sendStudioBootstrapContractJson(
        res,
        503,
        createStudioBootstrapContractPayload({
          code: "runtime_starting",
          retryable: true,
          canBootstrap: false,
          message: "Studio is starting",
        }),
        { cors: true },
      );
    }

    if (!getStudioAccessToken(process.env) || !getStudioId(process.env)) {
      return sendStudioBootstrapContractJson(
        res,
        503,
        createStudioBootstrapContractPayload({
          code: "bootstrap_unconfigured",
          retryable: false,
          canBootstrap: false,
          message: "Studio bootstrap is not configured",
        }),
        { cors: true },
      );
    }

    return sendStudioBootstrapContractJson(
      res,
      200,
      createStudioBootstrapContractPayload({
        status: "ready",
        retryable: false,
        canBootstrap: true,
        message: "Studio is ready",
      }),
      { cors: true },
    );
  });

  // Cleanup endpoint for sendBeacon on page leave (fire-and-forget)
  app.post("/vivd-studio/api/cleanup/preview-leave", requireStudioAuth(), async (req, res) => {
    if (!isSuspendCleanupRequest(req)) {
      return res.status(200).end();
    }

    try {
      const projectDir = workspace.isInitialized() ? workspace.getProjectPath() : null;
      await runtimeQuiesceCoordinator.quiesceForSuspend({ projectDir });
    } catch (err) {
      console.warn("[Cleanup] preview-leave failed:", err);
    }
    if (deps.drainRuntimeTransportForSuspend) {
      res.once("finish", () => {
        setImmediate(() => {
          try {
            deps.drainRuntimeTransportForSuspend?.();
          } catch (error) {
            console.warn("[Cleanup] preview-leave transport drain failed:", error);
          }
        });
      });
    }
    res.set("Connection", "close");
    res.status(200).end();
  });

  app.get("/vivd-studio/api/cleanup/status", requireStudioAuth(), (_req, res) => {
    res.json(runtimeQuiesceCoordinator.getQuiesceStatus());
  });

  app.post(
    "/vivd-studio/api/bootstrap",
    resumeRuntimeAfterActivity,
    express.urlencoded({ extended: false }),
    createStudioBootstrapHandler(process.env, {
      canBootstrap: () => workspace.isInitialized(),
    }),
  );

  // Serve workspace files in a backend-compatible path:
  // /vivd-studio/api/projects/:slug/v:version/<file>
  app.use(
    "/vivd-studio/api/projects",
    requireStudioAuth(),
    resumeRuntimeAfterActivity,
    async (req, res, next) => {
      return serveWorkspaceFile(req, res, next, { routeKind: "projects" });
    },
  );

  // Serve raw asset files in a backend-compatible path:
  // /vivd-studio/api/assets/:slug/:version/<file>
  app.use(
    "/vivd-studio/api/assets",
    requireStudioAuth(),
    resumeRuntimeAfterActivity,
    async (req, res, next) => {
      return serveWorkspaceFile(req, res, next, { routeKind: "assets" });
    },
  );

  // Dropped file upload endpoint (for chat drag-and-drop)
  app.post(
    "/vivd-studio/api/upload-dropped-file/:slug/:version",
    requireStudioAuth(),
    resumeRuntimeAfterActivity,
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
          STUDIO_CHAT_ATTACHMENT_DIRECTORY,
        );
        await fs.ensureDir(droppedImagesDir);

        const uuid = crypto.randomUUID().split("-")[0];
        const sanitizedName = file.originalname.replace(
          /[^a-zA-Z0-9._-]/g,
          "_",
        );
        const preparedUpload = await normalizeStudioWorkingImageUpload({
          filename: `${uuid}-${sanitizedName}`,
          buffer: file.buffer,
        });
        const filePath = path.join(droppedImagesDir, preparedUpload.filename);

        await writeUploadedFile(filePath, preparedUpload.buffer);
        await pruneStudioChatAttachments({ projectDir: projectPath });
        const slug = getSingleRouteParam(req.params?.slug);
        if (!slug) {
          return res.status(400).json({ error: "Invalid slug" });
        }
        const relativePath = `${STUDIO_CHAT_ATTACHMENT_DIRECTORY}/${preparedUpload.filename}`;
        projectTouchReporter.touch(slug);
        requestBucketSync("upload-dropped-file", {
          slug,
          relativePath,
        });

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
    requireStudioAuth(),
    resumeRuntimeAfterActivity,
    upload.array("files", 20),
    async (req, res) => {
      try {
        if (!workspace.isInitialized()) {
          return res.status(503).json({ error: "Workspace not initialized" });
        }

        const relativePath =
          typeof req.query.path === "string" ? req.query.path : "";
        const requestedFilename =
          typeof req.query.filename === "string" ? req.query.filename.trim() : "";

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
        if (requestedFilename && files.length !== 1) {
          return res.status(400).json({
            error: "Filename override requires exactly one uploaded file",
          });
        }
        let uploaded: string[] = [];

        for (const file of files) {
          const sanitizedName = file.originalname.replace(
            /[^a-zA-Z0-9._-]/g,
            "_",
          );
          const sanitizedRequestedFilename = requestedFilename
            ? requestedFilename.replace(/[^a-zA-Z0-9._-]/g, "_")
            : "";
          if (requestedFilename && !sanitizedRequestedFilename) {
            return res.status(400).json({ error: "Invalid filename" });
          }
          const preparedUpload = shouldNormalizeStudioWorkingImageUpload(
            relativePath,
          )
            ? await normalizeStudioWorkingImageUpload({
                filename: sanitizedRequestedFilename || sanitizedName,
                buffer: file.buffer,
              })
            : {
                filename: sanitizedRequestedFilename || sanitizedName,
                buffer: file.buffer,
              };

          let filePath: string;
          try {
            const rel = relativePath
              ? path.posix.join(
                  relativePath.replace(/\\/g, "/"),
                  preparedUpload.filename,
                )
              : preparedUpload.filename;
            filePath = safeJoin(projectPath, rel);
          } catch {
            return res.status(400).json({ error: "Invalid filename" });
          }

          await writeUploadedFile(filePath, preparedUpload.buffer);
          uploaded.push(
            relativePath
              ? path.posix.join(
                  relativePath.replace(/\\/g, "/"),
                  preparedUpload.filename,
                )
              : preparedUpload.filename,
          );
        }

        const slug = getSingleRouteParam(req.params?.slug);
        if (!slug) {
          return res.status(400).json({ error: "Invalid slug" });
        }
        if (isStudioChatAttachmentDirectory(relativePath)) {
          const pruneResult = await pruneStudioChatAttachments({
            projectDir: projectPath,
          });
          if (pruneResult.deletedPaths.length > 0) {
            const deletedPaths = new Set(pruneResult.deletedPaths);
            uploaded = uploaded.filter((filePath) => !deletedPaths.has(filePath));
          }
        }
        projectTouchReporter.touch(slug);
        requestBucketSync("upload-files", {
          slug,
          uploadedCount: uploaded.length,
          relativePath,
        });
        return res.json({ success: true, uploaded });
      } catch (error) {
        console.error("Upload error:", error);
        return res.status(500).json({ error: "Upload failed" });
      }
    },
  );

  // Preview route (static files or dev server proxy)
  app.use("/", requireStudioAuth(), async (req, res, next) => {
    try {
      onRuntimeActivity?.();
      void runtimeQuiesceCoordinator.resumeAfterActivity();

      if (!workspace.isInitialized()) {
        return res.status(503).json({ error: "Workspace not initialized" });
      }

      if (
        req.path === "/health" ||
        req.path.startsWith("/preview") ||
        req.path.startsWith("/vivd-studio") ||
        req.path.startsWith("/trpc")
      ) {
        return next();
      }

      const projectPath = workspace.getProjectPath();
      const config = detectProjectType(projectPath);

      if (config.mode === "devserver") {
        if (!devServerService.hasServer()) {
          await devServerService.getOrStartDevServer(projectPath, "/");
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

        if (req.originalUrl.includes("dev-toolbar/entrypoint.js")) {
          res.setHeader("Content-Type", "application/javascript");
          return res.send(
            "// Dev toolbar disabled in preview mode\nexport default {};\n",
          );
        }

        if (process.env.DEVSERVER_DEBUG === "1") {
          console.log(
            `[DevServer] Proxying ${req.originalUrl} to ${devServerUrl}`,
          );
        }

        (req as DevPreviewProxyRequest).vivdDevPreviewTarget = devServerUrl;
        (req as DevPreviewProxyRequest).vivdDevPreviewBasePath =
          getProxyBasePath(req) ?? "";
        return devPreviewProxy(req, res, next);
      }

      const requestedPath = req.path.replace(/^\/+/, "");
      const relativePathRaw = requestedPath.length ? requestedPath : "index.html";
      let relativePath = decodeUriPath(relativePathRaw);
      if (!relativePath) {
        return res.status(400).json({ error: "Invalid path" });
      }

      let resolvedPath: string;
      try {
        resolvedPath = safeJoin(projectPath, relativePath);
      } catch {
        return res.status(400).json({ error: "Invalid path" });
      }

      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        resolvedPath = path.join(resolvedPath, "index.html");
        relativePath = path.posix.join(relativePath.replace(/\\/g, "/"), "index.html");
      }

      if (!fs.existsSync(resolvedPath) && !path.extname(resolvedPath)) {
        const withHtml = `${resolvedPath}.html`;
        if (fs.existsSync(withHtml)) {
          resolvedPath = withHtml;
          const normalizedRelativePath = relativePath
            .replace(/\\/g, "/")
            .replace(/\/+$/, "");
          relativePath = `${normalizedRelativePath}.html`;
        }
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      if (!isAllowedProjectFile(relativePath.replace(/\\/g, "/"))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (resolvedPath.endsWith(".html")) {
        const content = await fs.readFile(resolvedPath, "utf-8");
        const processed = injectPreviewBridgeScript(
          content,
          getProxyBasePath(req),
        );
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
  app.use(
    "/vivd-studio/api/preview/:slug/v:version",
    requireStudioAuth(),
    resumeRuntimeAfterActivity,
    async (req, res, next) => {
      try {
        if (!workspace.isInitialized()) {
          return res.status(503).json({ error: "Workspace not initialized" });
        }

        const { slug, version } = req.params;
        const basePath = `/vivd-studio/api/preview/${slug}/v${version}`;
        const forwardedBasePath = resolveForwardedRuntimeBasePath(
          basePath,
          getProxyBasePath(req),
        );

        const urlWithoutQuery = req.url.split("?")[0];
        const rawFilePath = urlWithoutQuery.startsWith("/")
          ? urlWithoutQuery.slice(1)
          : urlWithoutQuery;
        const filePathRaw = rawFilePath || "index.html";
        const filePath = decodeUriPath(filePathRaw);
        if (!filePath) {
          return res.status(400).json({ error: "Invalid path" });
        }

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
          let processed = rewriteRootAssetUrlsInText(content, forwardedBasePath);
          processed = injectBasePathScript(processed, forwardedBasePath);
          processed = injectPreviewBridgeScript(
            processed,
            getProxyBasePath(req),
          );
          res.setHeader("Content-Type", "text/html");
          return res.send(processed);
        }

        return res.sendFile(resolvedPath);
      } catch (err) {
        return next(err);
      }
    },
  );

}
