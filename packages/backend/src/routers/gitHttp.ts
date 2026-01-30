import express from "express";
import type { Request, Response } from "express";
import * as fs from "fs";
import { gitHttpService } from "../services/GitHttpService";
import { gitAuthMiddleware } from "../routes/gitAuth";
import type { GitAuthRequest } from "../routes/gitAuth";
import { getVersionDir } from "../generator/versionUtils";
import { buildService } from "../services/BuildService";
import { detectProjectType } from "../devserver/projectType";

/**
 * Create Git HTTP router
 * Implements the Git smart HTTP protocol endpoints
 * Routes:
 * - GET /:slug/v:version/info/refs - Discovery endpoint
 * - POST /:slug/v:version/git-upload-pack - Clone/fetch/pull
 * - POST /:slug/v:version/git-receive-pack - Push (with build trigger)
 */
export function createGitHttpRouter() {
  const router = express.Router();

  const getRouteParam = (
    req: Request,
    key: "slug" | "version"
  ): string | null => {
    const raw = req.params[key];
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
    return null;
  };

  // Middleware to ensure binary data handling
  router.use(
    express.raw({
      // `type-is` doesn't reliably match `application/x-git-*` wildcards.
      // Git smart HTTP uses these content-types for request bodies.
      type: (req) => {
        const header = req.headers["content-type"];
        const contentType = Array.isArray(header) ? header[0] : header;
        const mime = typeof contentType === "string" ? contentType.split(";")[0]?.trim() : "";
        return Boolean(mime && mime.startsWith("application/x-git-"));
      },
      limit: "1gb",
    })
  );

  /**
   * Discovery endpoint (info/refs)
   * Returns available refs (branches, tags) for the repository
   */
  router.get(
    "/:slug/v:version/info/refs",
    gitAuthMiddleware,
    async (req: GitAuthRequest, res: Response) => {
      try {
        const slug = getRouteParam(req, "slug");
        const versionParam = getRouteParam(req, "version");
        const version = versionParam ? parseInt(versionParam, 10) : NaN;

        if (!slug) {
          return res.status(400).json({ error: "Invalid project slug" });
        }

        if (!Number.isFinite(version) || version < 1) {
          return res.status(400).json({ error: "Invalid version" });
        }

        const service = req.query.service as string;
        if (!["git-upload-pack", "git-receive-pack"].includes(service)) {
          return res
            .status(400)
            .json({ error: "Invalid or missing service parameter" });
        }

        const versionDir = getVersionDir(slug, version);

        if (!fs.existsSync(versionDir)) {
          return res.status(404).json({ error: "Project not found" });
        }

        const result = await gitHttpService.handleInfoRefs(
          versionDir,
          service
        );

        res.setHeader(
          "Content-Type",
          `application/x-${service}-advertisement`
        );
        res.setHeader("Cache-Control", "no-cache");
        return res.send(result);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[GitHttp] Info refs error:", msg);
        return res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  /**
   * Upload pack endpoint (git-upload-pack)
   * Handles clone, fetch, pull operations
   */
  router.post(
    "/:slug/v:version/git-upload-pack",
    gitAuthMiddleware,
    async (req: GitAuthRequest, res: Response) => {
      try {
        const slug = getRouteParam(req, "slug");
        const versionParam = getRouteParam(req, "version");
        const version = versionParam ? parseInt(versionParam, 10) : NaN;

        if (!slug) {
          return res.status(400).json({ error: "Invalid project slug" });
        }

        if (!Number.isFinite(version) || version < 1) {
          return res.status(400).json({ error: "Invalid version" });
        }

        const versionDir = getVersionDir(slug, version);

        if (!fs.existsSync(versionDir)) {
          return res.status(404).json({ error: "Project not found" });
        }

        const requestBody = req.body;
        if (!Buffer.isBuffer(requestBody)) {
          return res.status(400).json({ error: "Invalid request body" });
        }

        const result = await gitHttpService.handleUploadPack(
          versionDir,
          requestBody
        );

        res.setHeader("Content-Type", "application/x-git-upload-pack-result");
        res.setHeader("Cache-Control", "no-cache");
        return res.send(result);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[GitHttp] Upload pack error:", msg);
        return res.status(500).json({ error: "Upload pack failed" });
      }
    }
  );

  /**
   * Receive pack endpoint (git-receive-pack)
   * Handles push operations with post-push hooks
   */
  router.post(
    "/:slug/v:version/git-receive-pack",
    gitAuthMiddleware,
    async (req: GitAuthRequest, res: Response) => {
      try {
        const slug = getRouteParam(req, "slug");
        const versionParam = getRouteParam(req, "version");
        const version = versionParam ? parseInt(versionParam, 10) : NaN;

        if (!slug) {
          return res.status(400).json({ error: "Invalid project slug" });
        }

        if (!Number.isFinite(version) || version < 1) {
          return res.status(400).json({ error: "Invalid version" });
        }

        const versionDir = getVersionDir(slug, version);

        if (!fs.existsSync(versionDir)) {
          return res.status(404).json({ error: "Project not found" });
        }

        const requestBody = req.body;
        if (!Buffer.isBuffer(requestBody)) {
          return res.status(400).json({ error: "Invalid request body" });
        }

        // Setup post-push hook to trigger build
        const result = await gitHttpService.handleReceivePack(
          versionDir,
          requestBody,
          {
            onSuccess: async (commitHash) => {
              // Detect project type and trigger build if Astro
              try {
                const config = detectProjectType(versionDir);
                if (config.framework === "astro") {
                  console.log(
                    `[GitHttp] Triggering build for ${slug}/v${version} after push`
                  );
                  await buildService.triggerBuild(versionDir, commitHash);
                }
              } catch (err) {
                console.error("[GitHttp] Post-push build trigger error:", err);
              }
            },
          }
        );

        res.setHeader("Content-Type", "application/x-git-receive-pack-result");
        res.setHeader("Cache-Control", "no-cache");
        return res.send(result);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[GitHttp] Receive pack error:", msg);
        return res.status(500).json({ error: "Receive pack failed" });
      }
    }
  );

  return router;
}
