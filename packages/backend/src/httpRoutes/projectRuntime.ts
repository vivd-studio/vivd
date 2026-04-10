import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import archiver from "archiver";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { Multer } from "multer";

import { detectProjectType } from "../devserver/projectType";
import { getVersionDir } from "../generator/versionUtils";
import { safeJoin } from "../fs/safePaths";
import { checkOrganizationAccess } from "../lib/organizationAccess";
import { getInternalPreviewAccessToken } from "../config/preview";
import { buildService } from "../services/project/BuildService";
import {
  downloadArtifactToDirectory,
  getArtifactStorageConfig,
  resolvePublishableArtifactState,
} from "../services/project/ProjectArtifactStateService";
import { projectMetaService } from "../services/project/ProjectMetaService";
import { getProjectArtifactKeyPrefix } from "../services/project/ProjectStoragePaths";
import {
  createS3Client,
  getObjectBuffer,
  getObjectStorageConfigFromEnv,
} from "../services/storage/ObjectStorageService";
import { normalizeOrganizationId } from "../lib/organizationIdentifiers";
import { alignProjectArtifactKeyToSlug } from "../services/project/slugRename";
import {
  SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH,
  SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH,
  SCRATCH_REFERENCE_FILES_RELATIVE_PATH,
} from "@vivd/shared";
import { getScratchCreationMode } from "../generator/initialGeneration";

type CreateContextResult = {
  session: any;
  organizationId: string | null;
};

type ProjectRuntimeRouterDeps = {
  upload: Pick<Multer, "array">;
  createContext: (opts: any) => Promise<CreateContextResult>;
  enforceProjectAccess: (
    req: express.Request,
    res: express.Response,
    session: any,
    organizationId: string,
    slug: string,
  ) => Promise<boolean>;
};

const STUDIO_ALLOWED_DOTFILES = new Set([".vivd", ".gitignore", ".env.example"]);
const STUDIO_BLOCKED_FILE_PATHS = [
  ".git",
  ".env",
  "node_modules",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
];

function getRouteParam(req: express.Request, key: string): string | undefined {
  const value = (req.params as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

const PREVIEW_TOKEN_QUERY_PARAM = "__vivd_preview_token";
const PREVIEW_TOKEN_COOKIE_NAME = "vivd_preview_token";
const PREVIEW_TOKEN_HEADER_NAME = "x-vivd-preview-token";

function getQueryParam(req: express.Request, key: string): string | undefined {
  const value = (req.query as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function decodeRequestedStudioFilePath(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    try {
      return decodeURI(value);
    } catch {
      return null;
    }
  }
}

function resolveRequestedStudioFilePath(options: {
  restPath: string;
  queryPath: unknown;
}): string | null {
  const queryPath =
    typeof options.queryPath === "string"
      ? options.queryPath.trim()
      : Array.isArray(options.queryPath) &&
          typeof options.queryPath[0] === "string"
        ? options.queryPath[0].trim()
        : "";
  if (queryPath) {
    return decodeRequestedStudioFilePath(queryPath);
  }

  const restPath = options.restPath.trim();
  if (!restPath) {
    return null;
  }

  return decodeRequestedStudioFilePath(restPath);
}

function isAllowedStudioProjectFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  for (const segment of segments) {
    if (segment.startsWith(".") && !STUDIO_ALLOWED_DOTFILES.has(segment)) {
      return false;
    }
  }

  for (const blocked of STUDIO_BLOCKED_FILE_PATHS) {
    if (normalized.includes(blocked)) return false;
  }

  return true;
}

function getCookieValue(req: express.Request, key: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;

  const entries = cookieHeader.split(";").map((part) => part.trim());
  for (const entry of entries) {
    const eqIndex = entry.indexOf("=");
    if (eqIndex <= 0) continue;
    const name = entry.slice(0, eqIndex);
    if (name !== key) continue;
    const raw = entry.slice(eqIndex + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function isHttpsRequest(req: express.Request): boolean {
  if (req.secure) return true;
  const xfProto = req.headers["x-forwarded-proto"];
  if (typeof xfProto === "string") return xfProto.split(",")[0].trim() === "https";
  if (Array.isArray(xfProto) && typeof xfProto[0] === "string") {
    return xfProto[0].split(",")[0].trim() === "https";
  }
  return false;
}

type CachedPublicPreviewSetting = { enabled: boolean; fetchedAt: number };
const publicPreviewEnabledCache = new Map<string, CachedPublicPreviewSetting>();
const PUBLIC_PREVIEW_ENABLED_CACHE_TTL_MS = 10_000;

async function getCachedPublicPreviewEnabled(
  organizationId: string,
  slug: string,
): Promise<boolean | null> {
  const now = Date.now();
  const cacheKey = `${organizationId}:${slug}`;
  const cached = publicPreviewEnabledCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < PUBLIC_PREVIEW_ENABLED_CACHE_TTL_MS) {
    return cached.enabled;
  }

  const project = await projectMetaService.getProject(organizationId, slug);
  if (!project) return null;

  publicPreviewEnabledCache.set(cacheKey, {
    enabled: project.publicPreviewEnabled,
    fetchedAt: now,
  });
  return project.publicPreviewEnabled;
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
        `baseUrl = "${base.replace(/"/g, '\\"')}/"`,
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
  organizationId: string;
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
    tenantId: options.organizationId,
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

export function createProjectRuntimeRouter(
  deps: ProjectRuntimeRouterDeps,
) {
  const router = express.Router();

  const serveStudioWorkspaceFile = async (
    req: express.Request,
    res: express.Response,
    options: { routeKind: "projects" | "assets" },
  ) => {
    try {
      const requestContext = await deps.createContext({ req, res });
      const session = requestContext.session;
      if (!session) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const organizationId = requestContext.organizationId;
      if (!organizationId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const access = await checkOrganizationAccess({
        session,
        organizationId,
      });
      if (!access.ok) {
        if ("reason" in access && access.reason === "organization_suspended") {
          return res.status(403).json({ error: "Organization is suspended" });
        }
        return res.status(403).json({ error: "Forbidden" });
      }

      const parts = req.path.split("/").filter(Boolean);
      if (parts.length < 2) {
        return res.status(400).json({ error: "Invalid path" });
      }

      const [slug, rawVersionSegment, ...rest] = parts;
      const versionNumber =
        options.routeKind === "projects"
          ? rawVersionSegment?.startsWith("v")
            ? Number.parseInt(rawVersionSegment.slice(1), 10)
            : Number.NaN
          : Number.parseInt(rawVersionSegment || "", 10);
      if (!slug || !Number.isFinite(versionNumber) || versionNumber < 1) {
        return res.status(400).json({ error: "Invalid path" });
      }

      const ok = await deps.enforceProjectAccess(req, res, session, organizationId, slug);
      if (!ok) return;

      const relativePath = resolveRequestedStudioFilePath({
        restPath: rest.join("/"),
        queryPath: req.query?.path,
      });
      if (!relativePath) {
        return res.status(400).json({ error: "Invalid path" });
      }
      if (!isAllowedStudioProjectFile(relativePath)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const versionDir = getVersionDir(organizationId, slug, versionNumber);
      if (!fs.existsSync(versionDir)) {
        return res.status(404).json({ error: "Project version not found" });
      }

      let resolvedPath: string;
      try {
        resolvedPath = safeJoin(versionDir, relativePath, {
          allowDotSegments: true,
        });
      } catch {
        return res.status(400).json({ error: "Invalid path" });
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      res.setHeader("Cache-Control", "private, no-store");
      return res.sendFile(resolvedPath, { dotfiles: "allow" });
    } catch (error) {
      console.error("[ProjectRuntime] Failed to serve Studio workspace file:", error);
      return res.status(500).json({ error: "Failed to load file" });
    }
  };

  router.get("/vivd-studio/api/projects/:slug/v:version/thumbnail", async (req, res) => {
    try {
      const requestContext = await deps.createContext({ req, res });
      const session = requestContext.session;

      if (!session) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const organizationId = requestContext.organizationId;
      if (!organizationId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const access = await checkOrganizationAccess({
        session,
        organizationId,
      });
      if (!access.ok) {
        if ("reason" in access && access.reason === "organization_suspended") {
          return res.status(403).json({ error: "Organization is suspended" });
        }
        return res.status(403).json({ error: "Forbidden" });
      }

      const slug = getRouteParam(req, "slug");
      const version = getRouteParam(req, "version");
      if (!slug || !version) {
        return res.status(400).json({ error: "Invalid route parameters" });
      }
      const ok = await deps.enforceProjectAccess(req, res, session, organizationId, slug);
      if (!ok) return;

      const versionNumber = Number.parseInt(version, 10);
      if (!Number.isFinite(versionNumber) || versionNumber < 1) {
        return res.status(400).json({ error: "Invalid version" });
      }

      const projectVersion = await projectMetaService.getProjectVersion(
        organizationId,
        slug,
        versionNumber,
      );
      const thumbnailKey = alignProjectArtifactKeyToSlug({
        organizationId,
        slug,
        key: projectVersion?.thumbnailKey ?? null,
      });
      if (!thumbnailKey) {
        return res.status(404).json({ error: "Thumbnail not found" });
      }

      const storage = getPreviewBucketConfig();
      if (!storage) {
        return res.status(503).json({ error: "Thumbnail storage is unavailable" });
      }

      const { buffer, contentType } = await getObjectBuffer({
        client: storage.client,
        bucket: storage.bucket,
        key: thumbnailKey,
      });

      res.setHeader("Cache-Control", "private, no-store");
      res.type(contentType ?? "image/webp");
      return res.send(buffer);
    } catch (error) {
      if (isObjectNotFoundError(error)) {
        return res.status(404).json({ error: "Thumbnail not found" });
      }
      console.error("[ProjectRuntime] Failed to serve project thumbnail:", error);
      return res.status(500).json({ error: "Failed to load thumbnail" });
    }
  });

  router.use("/vivd-studio/api/projects", async (req, res) => {
    return serveStudioWorkspaceFile(req, res, { routeKind: "projects" });
  });

  router.use("/vivd-studio/api/assets", async (req, res) => {
    return serveStudioWorkspaceFile(req, res, { routeKind: "assets" });
  });

  // Secure external preview endpoint (unauthenticated but filtered)
  router.use("/vivd-studio/api/preview/:slug/v:version", async (req, res) => {
    const requestContext = await deps.createContext({ req, res });
    let organizationId = requestContext.organizationId;
    const slug = getRouteParam(req, "slug");
    const version = getRouteParam(req, "version");
    if (!slug || !version) {
      return res.status(400).json({ error: "Invalid route parameters" });
    }

    const internalToken = getInternalPreviewAccessToken();
    const tokenCandidate =
      req.get(PREVIEW_TOKEN_HEADER_NAME) ||
      getQueryParam(req, PREVIEW_TOKEN_QUERY_PARAM) ||
      getCookieValue(req, PREVIEW_TOKEN_COOKIE_NAME);

    const tokenOk = Boolean(
      internalToken && tokenCandidate && tokenCandidate === internalToken,
    );

    if (!organizationId && tokenOk) {
      // Internal services (e.g. scraper) can pass explicit org context via header.
      // We only honor this when the internal preview token is present.
      const candidate = normalizeOrganizationId(
        req.get("x-vivd-organization-id") ?? null,
      );
      if (candidate) {
        organizationId = candidate;
      }
    }

    if (!organizationId) return res.status(404).json({ error: "Not found" });

    const publicPreviewEnabled = await getCachedPublicPreviewEnabled(organizationId, slug);
    if (publicPreviewEnabled === null) {
      return res.status(404).json({ error: "Not found" });
    }

    // Project-level gating: disable unauthenticated access to preview URLs.
    // - When public previews are disabled, require a valid session OR an internal access token.
    // - The internal token is primarily used by internal services (e.g. thumbnail scraper).
    if (!publicPreviewEnabled) {
      if (tokenOk && internalToken) {
        // Persist token for subsequent asset requests (e.g. scraper loads HTML first, then assets).
        if (getCookieValue(req, PREVIEW_TOKEN_COOKIE_NAME) !== internalToken) {
          res.cookie(PREVIEW_TOKEN_COOKIE_NAME, internalToken, {
            httpOnly: true,
            sameSite: "lax",
            secure: isHttpsRequest(req),
            maxAge: 5 * 60 * 1000,
            path: "/vivd-studio/api/preview",
          });
        }
      } else {
        const session = requestContext.session;
        if (!session) {
          return res.status(404).json({ error: "Not found" });
        }
        const access = await checkOrganizationAccess({
          session,
          organizationId,
        });
        if (!access.ok) {
          return res.status(404).json({ error: "Not found" });
        }
        const ok = await deps.enforceProjectAccess(req, res, session, organizationId, slug);
        if (!ok) return;
      }
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

    const artifactState = await resolvePublishableArtifactState({
      organizationId,
      slug,
      version: versionNumber,
    });

    // Bucket-first serving in connected/prod mode.
    if (artifactState.storageEnabled) {
      res.setHeader(
        "X-Vivd-Preview-Source",
        `bucket:${artifactState.sourceKind ?? "unknown"}`,
      );

      if (artifactState.readiness === "build_in_progress") {
        return res.status(503).json({
          error: "Build in progress",
          status: "building",
        });
      }

      if (artifactState.readiness === "artifact_not_ready") {
        return res.status(503).json({
          error: artifactState.error || "Artifact not ready",
          status: "error",
        });
      }

      if (artifactState.readiness !== "ready" || !artifactState.sourceKind) {
        return res.status(404).json({ error: "Preview artifact not found" });
      }

      const served = await tryServeFromBucket({
        req,
        res,
        organizationId,
        slug,
        version: versionNumber,
        kind: artifactState.sourceKind,
        filePath,
      });
      if (served === "served") return;
      return res.status(404).json({ error: "File not found" });
    }

    // Local fallback for standalone mode when object storage is disabled.
    res.setHeader("X-Vivd-Preview-Source", "local");
    const versionDir = getVersionDir(organizationId, slug, versionNumber);
    const config = fs.existsSync(versionDir)
      ? detectProjectType(versionDir)
      : { framework: "generic" as const, mode: "static" as const, packageManager: "npm" as const };

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

  // Scratch wizard multipart upload endpoint.
  // Keeps local generation workflow intact before post-generation bucket sync.
  router.post(
    "/vivd-studio/api/upload/:slug/:version",
    deps.upload.array("files", 20),
    async (req, res) => {
      try {
        const requestContext = await deps.createContext({ req, res });
        const session = requestContext.session;
        if (!session) {
          return res.status(401).json({ error: "Unauthorized" });
        }
        const organizationId = requestContext.organizationId;
        if (!organizationId) {
          return res.status(401).json({ error: "Unauthorized" });
        }
        const access = await checkOrganizationAccess({
          session,
          organizationId,
        });
        if (!access.ok) {
          if ("reason" in access && access.reason === "organization_suspended") {
            return res.status(403).json({ error: "Organization is suspended" });
          }
          return res.status(403).json({ error: "Forbidden" });
        }

        const slug = getRouteParam(req, "slug");
        const version = getRouteParam(req, "version");
        if (!slug || !version) {
          return res.status(400).json({ error: "Invalid route parameters" });
        }

        const ok = await deps.enforceProjectAccess(req, res, session, organizationId, slug);
        if (!ok) return;

        const versionNumber = Number.parseInt(version, 10);
        if (!Number.isFinite(versionNumber) || versionNumber < 1) {
          return res.status(400).json({ error: "Invalid version" });
        }

        const rawRelativePath =
          typeof req.query.path === "string" ? req.query.path : "";
        const relativePath = rawRelativePath
          .replace(/\\/g, "/")
          .replace(/^\/+|\/+$/g, "");
        const scratchCreationMode = getScratchCreationMode();
        const remappedRelativePath =
          relativePath === SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH &&
          scratchCreationMode === "legacy_html"
            ? SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH
            : relativePath;

        if (
          relativePath !== SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH &&
          relativePath !== SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH &&
          relativePath !== SCRATCH_REFERENCE_FILES_RELATIVE_PATH
        ) {
          return res.status(400).json({
            error:
              'Invalid upload path. Allowed paths: "images", "references", "src/content/media/shared".',
          });
        }

        const versionDir = getVersionDir(organizationId, slug, versionNumber);
        if (!fs.existsSync(versionDir)) {
          return res.status(404).json({ error: "Project version not found" });
        }

        let targetDir: string;
        try {
          targetDir = safeJoin(versionDir, remappedRelativePath);
        } catch {
          return res.status(400).json({ error: "Invalid path" });
        }

        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const files = req.files as Express.Multer.File[] | undefined;
        if (!files?.length) {
          return res.status(400).json({ error: "No files provided" });
        }

        const uploaded: string[] = [];
        for (const file of files) {
          const sanitizedName =
            file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";

          let filePath: string;
          try {
            const rel = path.posix.join(remappedRelativePath, sanitizedName);
            filePath = safeJoin(versionDir, rel);
          } catch {
            return res.status(400).json({ error: "Invalid filename" });
          }

          fs.writeFileSync(filePath, file.buffer);
          uploaded.push(path.posix.join(remappedRelativePath, sanitizedName));
        }

        await projectMetaService.touchUpdatedAt(organizationId, slug);
        return res.json({ success: true, uploaded });
      } catch (error) {
        console.error("Upload error:", error);
        return res.status(500).json({ error: "Upload failed" });
      }
    },
  );

  // Download project version as ZIP
  router.get("/vivd-studio/api/download/:slug/:version", async (req, res) => {
    let cleanupTempDir: string | null = null;
    try {
      const requestContext = await deps.createContext({ req, res });
      const session = requestContext.session;

      if (!session) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const organizationId = requestContext.organizationId;
      if (!organizationId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const access = await checkOrganizationAccess({
        session,
        organizationId,
      });
      if (!access.ok) {
        if ("reason" in access && access.reason === "organization_suspended") {
          return res.status(403).json({ error: "Organization is suspended" });
        }
        return res.status(403).json({ error: "Forbidden" });
      }

      const slug = getRouteParam(req, "slug");
      const version = getRouteParam(req, "version");
      if (!slug || !version) {
        return res.status(400).json({ error: "Invalid route parameters" });
      }
      const ok = await deps.enforceProjectAccess(req, res, session, organizationId, slug);
      if (!ok) return;

      const versionNumber = Number.parseInt(version, 10);
      if (!Number.isFinite(versionNumber) || versionNumber < 1) {
        return res.status(400).json({ error: "Invalid version" });
      }
      const storage = getArtifactStorageConfig();
      if (!storage) {
        return res.status(503).json({
          error:
            "ZIP download is unavailable because object storage is not configured.",
        });
      }

      let zipSourceDir: string | null = null;
      let zipSourceLabel: "bucket:source" | "bucket:preview" = "bucket:source";
      let artifactState:
        | Awaited<ReturnType<typeof resolvePublishableArtifactState>>
        | null = null;

      // Bucket-first export: use source artifact from object storage so downloads
      // reflect the latest synced studio state; local FS fallback is intentionally disabled.
      const safeSlug = slug.replace(/[^a-zA-Z0-9_-]/g, "_");
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `vivd-download-${safeSlug}-v${versionNumber}-`),
      );
      cleanupTempDir = tempDir;

      const sourceDownload = await downloadArtifactToDirectory({
        organizationId,
        slug,
        version: versionNumber,
        kind: "source",
        destinationDir: tempDir,
      });

      if (sourceDownload.downloaded) {
        zipSourceDir = tempDir;
        zipSourceLabel = "bucket:source";
      } else {
        // Fallback for older Astro versions where only preview artifacts existed.
        artifactState = await resolvePublishableArtifactState({
          organizationId,
          slug,
          version: versionNumber,
        });

        if (
          artifactState.readiness === "ready" &&
          artifactState.sourceKind === "preview"
        ) {
          const previewDownload = await downloadArtifactToDirectory({
            organizationId,
            slug,
            version: versionNumber,
            kind: "preview",
            destinationDir: tempDir,
          });
          if (previewDownload.downloaded) {
            zipSourceDir = tempDir;
            zipSourceLabel = "bucket:preview";
          }
        }
      }

      if (!zipSourceDir) {
        if (!artifactState) {
          artifactState = await resolvePublishableArtifactState({
            organizationId,
            slug,
            version: versionNumber,
          });
        }
        if (cleanupTempDir) {
          fs.rmSync(cleanupTempDir, { recursive: true, force: true });
          cleanupTempDir = null;
        }

        if (artifactState.readiness === "build_in_progress") {
          return res.status(503).json({
            error: "Build in progress",
            status: "building",
          });
        }

        if (artifactState.readiness === "artifact_not_ready") {
          return res.status(503).json({
            error: artifactState.error || "Artifact not ready",
            status: "error",
          });
        }

        return res
          .status(404)
          .json({ error: "Project artifact not found in object storage" });
      }

      const cleanupTemp = () => {
        if (!cleanupTempDir) return;
        fs.rmSync(cleanupTempDir, { recursive: true, force: true });
        cleanupTempDir = null;
      };
      res.on("finish", cleanupTemp);
      res.on("close", cleanupTemp);

      // Set response headers for zip download
      const filename = `${slug}-v${version}.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("X-Vivd-Download-Source", zipSourceLabel);

      // Create archive
      const archive = archiver("zip", {
        zlib: { level: 5 }, // Balanced compression
      });

      // Handle archive errors
      archive.on("error", (err) => {
        console.error("Archive error:", err);
        cleanupTemp();
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to create archive" });
        } else {
          res.end();
        }
      });

      // Pipe archive to response
      archive.pipe(res);

      // Add the version directory contents to the archive (excluding node_modules)
      archive.glob("**/*", {
        cwd: zipSourceDir,
        ignore: ["node_modules/**"],
        dot: true,
      });

      // Finalize the archive
      await archive.finalize();
    } catch (error) {
      if (cleanupTempDir) {
        fs.rmSync(cleanupTempDir, { recursive: true, force: true });
      }
      console.error("Download error:", error);
      return res.status(500).json({ error: "Download failed" });
    }
  });

  return router;
}
