import crypto from "node:crypto";
import type express from "express";
import { verifyStudioBootstrapToken } from "../../../shared/src/studio/bootstrap.js";

const FORWARDED_PREFIX_HEADER = "x-forwarded-prefix";
const FORWARDED_HOST_HEADER = "x-forwarded-host";
const FORWARDED_PROTO_HEADER = "x-forwarded-proto";

export const STUDIO_AUTH_HEADER = "x-vivd-studio-token";
export const STUDIO_AUTH_QUERY = "vivdStudioToken";
export const STUDIO_AUTH_COOKIE = "vivd_studio_token";
export const STUDIO_BOOTSTRAP_TOKEN_PARAM = "bootstrapToken";
export const STUDIO_BOOTSTRAP_NEXT_PARAM = "next";

type ProvidedStudioToken = {
  source: "header" | "authorization" | "query" | "cookie" | null;
  value: string | null;
};

function getCookieValue(req: express.Request, key: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

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

  return null;
}

function isHttpsRequest(req: express.Request): boolean {
  if (req.secure) return true;
  const xfProto = req.headers[FORWARDED_PROTO_HEADER];
  if (typeof xfProto === "string") {
    return xfProto.split(",")[0]?.trim() === "https";
  }
  if (Array.isArray(xfProto) && typeof xfProto[0] === "string") {
    return xfProto[0].split(",")[0]?.trim() === "https";
  }
  return false;
}

function getRequestOrigin(req: express.Request): string | null {
  const hostHeader = req.headers[FORWARDED_HOST_HEADER] ?? req.headers.host;
  const host = Array.isArray(hostHeader)
    ? hostHeader[0]
    : typeof hostHeader === "string"
      ? hostHeader.split(",")[0]?.trim()
      : "";
  if (!host) return null;
  const protocol = isHttpsRequest(req) ? "https" : "http";
  return `${protocol}://${host}`;
}

function getCookiePath(req: express.Request): string {
  const raw = req.get(FORWARDED_PREFIX_HEADER);
  if (typeof raw !== "string") return "/";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return "/";
  return trimmed.replace(/\/+$/, "") || "/";
}

function normalizeForwardedPrefix(pathname: string): string {
  const trimmed = pathname.trim().replace(/\/+$/, "");
  return trimmed === "/" ? "" : trimmed;
}

function isAllowedRuntimeTargetPath(pathname: string): boolean {
  return (
    pathname === "/vivd-studio" ||
    pathname.startsWith("/vivd-studio/") ||
    pathname === "/preview" ||
    pathname.startsWith("/preview/")
  );
}

function stripStudioTokenFromUrl(url: URL): void {
  url.searchParams.delete(STUDIO_AUTH_QUERY);

  const rawHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (!rawHash) return;

  const params = new URLSearchParams(rawHash);
  params.delete(STUDIO_AUTH_QUERY);
  const nextHash = params.toString();
  url.hash = nextHash ? `#${nextHash}` : "";
}

export function resolveStudioBootstrapRedirectTarget(
  req: express.Request,
  nextTarget: string,
): string | null {
  const trimmedTarget = nextTarget.trim();
  if (!trimmedTarget) return null;

  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin) return null;

  let url: URL;
  try {
    url = new URL(trimmedTarget, requestOrigin);
  } catch {
    return null;
  }

  if (url.origin !== requestOrigin) return null;
  stripStudioTokenFromUrl(url);

  const forwardedPrefix = normalizeForwardedPrefix(getCookiePath(req));
  const normalizedPathname =
    forwardedPrefix &&
    (url.pathname === forwardedPrefix ||
      url.pathname.startsWith(`${forwardedPrefix}/`))
      ? url.pathname.slice(forwardedPrefix.length) || "/"
      : url.pathname;

  if (!isAllowedRuntimeTargetPath(normalizedPathname)) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function getStudioAccessToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.STUDIO_ACCESS_TOKEN;
  const token = raw?.trim();
  return token ? token : null;
}

export function getStudioId(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.STUDIO_ID;
  const studioId = raw?.trim();
  return studioId ? studioId : null;
}

export function safeTokenEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function getRequestStudioToken(req: express.Request): ProvidedStudioToken {
  const headerValue = req.get(STUDIO_AUTH_HEADER);
  if (typeof headerValue === "string" && headerValue.trim()) {
    return { source: "header", value: headerValue.trim() };
  }

  const auth = req.get("authorization");
  if (typeof auth === "string" && auth.trim()) {
    const match = auth.trim().match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      return { source: "authorization", value: match[1].trim() };
    }
  }

  const queryValue = (req.query?.[STUDIO_AUTH_QUERY] ?? null) as
    | string
    | string[]
    | null;
  if (typeof queryValue === "string" && queryValue.trim()) {
    return { source: "query", value: queryValue.trim() };
  }

  const cookieValue = getCookieValue(req, STUDIO_AUTH_COOKIE);
  if (typeof cookieValue === "string" && cookieValue.trim()) {
    return { source: "cookie", value: cookieValue.trim() };
  }

  return { source: null, value: null };
}

export function setStudioAuthCookie(
  req: express.Request,
  res: express.Response,
  token: string,
): void {
  if (getCookieValue(req, STUDIO_AUTH_COOKIE) === token) return;

  const secure = isHttpsRequest(req);
  res.cookie(STUDIO_AUTH_COOKIE, token, {
    httpOnly: true,
    // Fly embeds use a cross-site runtime host in prod, so secure requests need
    // SameSite=None or the iframe never sends the auth cookie back.
    sameSite: secure ? "none" : "lax",
    secure,
    path: getCookiePath(req),
  });
}

function persistStudioAuthCookie(
  req: express.Request,
  res: express.Response,
  token: string,
  source: ProvidedStudioToken["source"],
): void {
  if (source !== "header" && source !== "authorization" && source !== "query") {
    return;
  }

  setStudioAuthCookie(req, res, token);
}

export function createStudioBootstrapHandler(
  env: NodeJS.ProcessEnv = process.env,
): express.RequestHandler {
  return (req, res) => {
    const accessToken = getStudioAccessToken(env);
    const studioId = getStudioId(env);
    if (!accessToken || !studioId) {
      return res.status(503).json({ error: "Studio bootstrap unavailable" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const bootstrapToken = body[STUDIO_BOOTSTRAP_TOKEN_PARAM];
    const nextTarget = body[STUDIO_BOOTSTRAP_NEXT_PARAM];

    if (typeof bootstrapToken !== "string" || !bootstrapToken.trim()) {
      return res.status(400).json({ error: "Missing bootstrap token" });
    }
    if (typeof nextTarget !== "string" || !nextTarget.trim()) {
      return res.status(400).json({ error: "Missing bootstrap target" });
    }

    const verified = verifyStudioBootstrapToken(bootstrapToken, {
      accessToken,
      studioId,
    });
    if (!verified) {
      return res.status(401).json({ error: "Invalid bootstrap token" });
    }

    const redirectTarget = resolveStudioBootstrapRedirectTarget(req, nextTarget);
    if (!redirectTarget) {
      return res.status(400).json({ error: "Invalid bootstrap target" });
    }

    setStudioAuthCookie(req, res, accessToken);
    res.setHeader("cache-control", "no-store");
    return res.redirect(303, redirectTarget);
  };
}

export function createRequireStudioAuth(
  env: NodeJS.ProcessEnv = process.env,
): express.RequestHandler {
  return (req, res, next) => {
    const required = getStudioAccessToken(env);
    if (!required) return next();

    if (req.method === "OPTIONS") return next();

    const provided = getRequestStudioToken(req);
    if (provided.value && safeTokenEquals(provided.value, required)) {
      persistStudioAuthCookie(req, res, required, provided.source);
      return next();
    }

    const combinedPath = `${req.baseUrl || ""}${req.path || ""}`;
    const wantsJson =
      combinedPath.startsWith("/trpc") ||
      combinedPath.startsWith("/vivd-studio/api/");

    if (wantsJson) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return res.status(401).send("Unauthorized");
  };
}
