import type { NewsletterPluginConfig } from "./config";
import type { NewsletterPluginServiceDeps } from "./ports";

function stripDefaultPort(host: string): string {
  if (host.endsWith(":80")) return host.slice(0, -3);
  if (host.endsWith(":443")) return host.slice(0, -4);
  return host;
}

function normalizeHostWithUtils(
  raw: string | null | undefined,
  deps: NewsletterPluginServiceDeps,
): string | null {
  return deps.hostUtils.normalizeHostCandidate(raw);
}

export function normalizeHostAllowlist(
  values: string[],
  deps: NewsletterPluginServiceDeps,
): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeHostWithUtils(value, deps))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export function resolveEffectiveSourceHosts(
  config: NewsletterPluginConfig,
  inferredSourceHosts: string[],
  deps: NewsletterPluginServiceDeps,
): string[] {
  const configured = normalizeHostAllowlist(config.sourceHosts, deps);
  if (configured.length > 0) return configured;
  return normalizeHostAllowlist(inferredSourceHosts, deps);
}

export function resolveEffectiveRedirectHosts(
  config: NewsletterPluginConfig,
  effectiveSourceHosts: string[],
  deps: NewsletterPluginServiceDeps,
): string[] {
  const configured = normalizeHostAllowlist(config.redirectHostAllowlist, deps);
  if (configured.length > 0) return configured;
  return effectiveSourceHosts;
}

export function resolveRedirectTarget(
  rawRedirect: string | null | undefined,
  allowlist: string[],
  deps: NewsletterPluginServiceDeps,
): string | null {
  const candidate = (rawRedirect || "").trim();
  if (!candidate || allowlist.length === 0) return null;

  try {
    const url = new URL(candidate);
    const host = normalizeHostWithUtils(url.host, deps);
    if (!deps.hostUtils.isHostAllowed(host, allowlist)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractHostname(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return "";

  if (normalized.startsWith("[")) {
    const closingIndex = normalized.indexOf("]");
    return closingIndex > 0 ? normalized.slice(1, closingIndex) : normalized;
  }

  return normalized.split(":")[0] || "";
}

function isLocalOrLoopbackHostname(hostname: string): boolean {
  if (!hostname) return false;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function isStudioRuntimePath(pathname: string): boolean {
  return (
    pathname === "/_studio" ||
    pathname.startsWith("/_studio/") ||
    pathname === "/vivd-studio" ||
    pathname.startsWith("/vivd-studio/")
  );
}

function resolveStudioPublicHosts(deps: NewsletterPluginServiceDeps): string[] {
  const flyStudioApp = (process.env.FLY_STUDIO_APP || "").trim();
  return Array.from(
    new Set(
      [
        process.env.FLY_STUDIO_PUBLIC_HOST,
        flyStudioApp ? `${flyStudioApp}.fly.dev` : null,
      ]
        .map((value) => normalizeHostWithUtils(value, deps))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function isDurableInferredSuccessRedirectUrl(
  url: URL,
  deps: NewsletterPluginServiceDeps,
): boolean {
  const hostname = extractHostname(url.host);
  if (isLocalOrLoopbackHostname(hostname)) return false;
  if (isStudioRuntimePath(url.pathname || "/")) return false;

  const normalizedHost = normalizeHostWithUtils(url.host, deps);
  if (!normalizedHost) return false;

  const studioPublicHosts = resolveStudioPublicHosts(deps);
  if (
    studioPublicHosts.length > 0 &&
    deps.hostUtils.isHostAllowed(normalizedHost, studioPublicHosts)
  ) {
    return false;
  }

  return true;
}

export function resolveDefaultSuccessRedirectTarget(options: {
  rawReferer?: string | null;
  rawOrigin?: string | null;
  allowlist: string[];
  deps: NewsletterPluginServiceDeps;
}): string | null {
  if (options.allowlist.length === 0) return null;

  for (const rawCandidate of [options.rawReferer, options.rawOrigin]) {
    const candidate = (rawCandidate || "").trim();
    if (!candidate) continue;

    try {
      const url = new URL(candidate);
      const host = normalizeHostWithUtils(url.host, options.deps);
      if (!options.deps.hostUtils.isHostAllowed(host, options.allowlist)) {
        continue;
      }
      if (!isDurableInferredSuccessRedirectUrl(url, options.deps)) {
        return null;
      }
      url.searchParams.set("newsletter", "success");
      url.searchParams.set("_vivd_newsletter", "success");
      return url.toString();
    } catch {
      continue;
    }
  }

  return null;
}

export function withRedirectParam(
  url: string,
  redirectTarget: string | null,
): string {
  if (!redirectTarget) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("redirect", redirectTarget);
  return parsed.toString();
}

export function parseRefererParts(
  rawReferer: string | null | undefined,
): {
  host: string | null;
  path: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
} {
  const candidate = (rawReferer || "").trim();
  if (!candidate) {
    return {
      host: null,
      path: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    };
  }

  try {
    const url = new URL(candidate);
    return {
      host: stripDefaultPort(url.host),
      path: `${url.pathname || "/"}${url.search || ""}`,
      utmSource: url.searchParams.get("utm_source"),
      utmMedium: url.searchParams.get("utm_medium"),
      utmCampaign: url.searchParams.get("utm_campaign"),
    };
  } catch {
    return {
      host: null,
      path: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    };
  }
}
