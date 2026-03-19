import express from "express";
import path from "path";
import fs from "fs-extra";
import crypto from "node:crypto";
import type { Multer } from "multer";

import { detectProjectType } from "../services/project/projectType.js";
import { devServerService } from "../services/project/DevServerService.js";
import { serverManager as opencodeServerManager } from "../opencode/serverManager.js";
import { projectTouchReporter } from "../services/reporting/ProjectTouchReporter.js";
import { requestBucketSync } from "../services/sync/AgentTaskSyncService.js";
import type { WorkspaceManager } from "../workspace/WorkspaceManager.js";

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
};

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
  } = deps;

  // Health check endpoint for service discovery
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      initialized: workspace.isInitialized(),
    });
  });

  // Cleanup endpoint for sendBeacon on page leave (fire-and-forget)
  app.post("/vivd-studio/api/cleanup/preview-leave", requireStudioAuth(), (_req, res) => {
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

  // Serve workspace files in a backend-compatible path:
  // /vivd-studio/api/projects/:slug/v:version/<file>
  app.use("/vivd-studio/api/projects", requireStudioAuth(), async (req, res, next) => {
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

      const relativePathRaw = rest.join("/");
      const relativePath = decodeUriPath(relativePathRaw);
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

      return res.sendFile(resolvedPath);
    } catch (err) {
      return next(err);
    }
  });

  // Serve raw asset files in a backend-compatible path:
  // /vivd-studio/api/assets/:slug/:version/<file>
  app.use("/vivd-studio/api/assets", requireStudioAuth(), async (req, res, next) => {
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

      const relativePathRaw = rest.join("/");
      const relativePath = decodeUriPath(relativePathRaw);
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

      return res.sendFile(resolvedPath);
    } catch (err) {
      return next(err);
    }
  });

  // Dropped file upload endpoint (for chat drag-and-drop)
  app.post(
    "/vivd-studio/api/upload-dropped-file/:slug/:version",
    requireStudioAuth(),
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
        const slug = getSingleRouteParam(req.params?.slug);
        if (!slug) {
          return res.status(400).json({ error: "Invalid slug" });
        }
        const relativePath = `.vivd/dropped-images/${uniqueFilename}`;
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

        const slug = getSingleRouteParam(req.params?.slug);
        if (!slug) {
          return res.status(400).json({ error: "Invalid slug" });
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
  app.use("/preview", async (req, res, next) => {
    try {
      if (!workspace.isInitialized()) {
        return res.status(503).json({ error: "Workspace not initialized" });
      }

      const projectPath = workspace.getProjectPath();
      const config = detectProjectType(projectPath);
      const basePath = "/preview";
      const forwardedBasePath = resolveForwardedRuntimeBasePath(
        basePath,
        getProxyBasePath(req),
      );

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

        if (process.env.DEVSERVER_DEBUG === "1") {
          console.log(
            `[DevServer] Proxying ${req.originalUrl} to ${devServerUrl}`
          );
        }

        (req as DevPreviewProxyRequest).vivdDevPreviewTarget = devServerUrl;
        (req as DevPreviewProxyRequest).vivdDevPreviewBasePath = forwardedBasePath;

        return devPreviewProxy(req, res, next);
      }

      // Static mode: serve files from the workspace directory.
      // Express has already stripped the "/preview" prefix from req.path.
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

      // Directory -> index.html
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        resolvedPath = path.join(resolvedPath, "index.html");
        relativePath = path.posix.join(relativePath.replace(/\\/g, "/"), "index.html");
      }

      // Clean URLs -> try appending .html
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
        let processed = rewriteRootAssetUrlsInText(content, forwardedBasePath);
        processed = injectBasePathScript(processed, forwardedBasePath);
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
      const forwardedBasePath = resolveForwardedRuntimeBasePath(
        basePath,
        getProxyBasePath(req),
      );

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
          "// Dev toolbar disabled in preview mode\nexport default {};\n"
        );
      }

      if (process.env.DEVSERVER_DEBUG === "1") {
        console.log(
          `[DevServer] Proxying ${req.originalUrl} to ${devServerUrl}`
        );
      }

      (req as DevPreviewProxyRequest).vivdDevPreviewTarget = devServerUrl;
      (req as DevPreviewProxyRequest).vivdDevPreviewBasePath = forwardedBasePath;

      return devPreviewProxy(req, res, next);
    } catch (err) {
      return next(err);
    }
  });
}
