import crypto from "node:crypto";
import type express from "express";
import {
  STUDIO_USER_ACTION_TOKEN_COOKIE,
  STUDIO_USER_ACTION_TOKEN_PARAM,
  verifyStudioBootstrapToken,
} from "@vivd/shared/studio";

const FORWARDED_PREFIX_HEADER = "x-forwarded-prefix";
const FORWARDED_HOST_HEADER = "x-forwarded-host";
const FORWARDED_PROTO_HEADER = "x-forwarded-proto";
const FORWARDED_PORT_HEADER = "x-forwarded-port";

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

export function getStudioUserActionToken(req: express.Request): string | null {
  const value = getCookieValue(req, STUDIO_USER_ACTION_TOKEN_COOKIE);
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function getFirstHeaderValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.split(",")[0]?.trim() || "";
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0].split(",")[0]?.trim() || "";
  }
  return "";
}

function splitHostAndPort(host: string): { hostname: string; port: string | null } {
  const trimmed = host.trim();
  if (!trimmed) return { hostname: "", port: null };

  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    const end = trimmed.indexOf("]");
    const hostname = trimmed.slice(0, end + 1);
    const rest = trimmed.slice(end + 1);
    const port = rest.startsWith(":") ? rest.slice(1) : null;
    return { hostname, port: port || null };
  }

  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon > 0 && trimmed.indexOf(":") === lastColon) {
    return {
      hostname: trimmed.slice(0, lastColon),
      port: trimmed.slice(lastColon + 1) || null,
    };
  }

  return { hostname: trimmed, port: null };
}

function isDefaultPort(protocol: string, port: string | null): boolean {
  if (!port) return true;
  return (protocol === "https" && port === "443") || (protocol === "http" && port === "80");
}

function getRequestOrigin(req: express.Request): string | null {
  const protocol = isHttpsRequest(req) ? "https" : "http";

  const forwardedHost = getFirstHeaderValue(req.headers[FORWARDED_HOST_HEADER]);
  const directHost = getFirstHeaderValue(req.headers.host);
  const forwardedPort = getFirstHeaderValue(req.headers[FORWARDED_PORT_HEADER]);

  const preferred = forwardedHost || directHost;
  if (!preferred) return null;

  const preferredParts = splitHostAndPort(preferred);
  const directParts = splitHostAndPort(directHost);
  const effectivePort =
    preferredParts.port ||
    forwardedPort ||
    directParts.port;

  const host = isDefaultPort(protocol, effectivePort)
    ? preferredParts.hostname
    : `${preferredParts.hostname}:${effectivePort}`;
  if (!host) return null;

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

function setScopedStudioCookie(
  req: express.Request,
  res: express.Response,
  name: string,
  token: string,
): void {
  if (getCookieValue(req, name) === token) return;

  const secure = isHttpsRequest(req);
  res.cookie(name, token, {
    httpOnly: true,
    // Fly embeds use a cross-site runtime host in prod, so secure requests need
    // SameSite=None. Mark them partitioned as well so modern browsers can keep
    // sending the cookie inside the embedded Studio iframe even with tighter
    // third-party cookie handling.
    sameSite: secure ? "none" : "lax",
    partitioned: secure,
    secure,
    path: getCookiePath(req),
  });
}

export function setStudioAuthCookie(
  req: express.Request,
  res: express.Response,
  token: string,
): void {
  setScopedStudioCookie(req, res, STUDIO_AUTH_COOKIE, token);
}

export function setStudioUserActionCookie(
  req: express.Request,
  res: express.Response,
  token: string,
): void {
  setScopedStudioCookie(req, res, STUDIO_USER_ACTION_TOKEN_COOKIE, token);
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
    const userActionToken = body[STUDIO_USER_ACTION_TOKEN_PARAM];

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
      console.warn("[StudioAuth] Rejected bootstrap target", {
        requestOrigin: getRequestOrigin(req),
        nextTarget,
        host: getFirstHeaderValue(req.headers.host),
        forwardedHost: getFirstHeaderValue(req.headers[FORWARDED_HOST_HEADER]),
        forwardedPort: getFirstHeaderValue(req.headers[FORWARDED_PORT_HEADER]),
        forwardedProto: getFirstHeaderValue(req.headers[FORWARDED_PROTO_HEADER]),
        forwardedPrefix: getFirstHeaderValue(req.headers[FORWARDED_PREFIX_HEADER]),
      });
      return res.status(400).json({ error: "Invalid bootstrap target" });
    }

    setStudioAuthCookie(req, res, accessToken);
    if (typeof userActionToken === "string" && userActionToken.trim()) {
      setStudioUserActionCookie(req, res, userActionToken.trim());
    }
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
