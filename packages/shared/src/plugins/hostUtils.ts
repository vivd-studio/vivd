export interface SourceHeaders {
  origin?: string | null;
  referer?: string | null;
}

function normalizeHostInput(input: string): string {
  return input.trim().toLowerCase();
}

function stripDefaultPorts(host: string): string {
  if (host.endsWith(":80")) return host.slice(0, -3);
  if (host.endsWith(":443")) return host.slice(0, -4);
  return host;
}

export function normalizeHostCandidate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = normalizeHostInput(raw);
  if (!normalized) return null;

  const candidate = normalized.includes("://") ? normalized : `https://${normalized}`;
  try {
    const host = new URL(candidate).host;
    if (!host) return null;
    return stripDefaultPorts(host);
  } catch {
    return null;
  }
}

export function extractSourceHostFromHeaders(headers: SourceHeaders): string | null {
  const originHost = normalizeHostCandidate(headers.origin);
  if (originHost) return originHost;

  const refererHost = normalizeHostCandidate(headers.referer);
  if (refererHost) return refererHost;

  return null;
}

export function isHostAllowed(sourceHost: string | null, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!sourceHost) return false;

  const normalizedSourceHost = normalizeHostCandidate(sourceHost);
  if (!normalizedSourceHost) return false;
  const sourceHostname = normalizedSourceHost.split(":")[0];

  for (const allowedHost of allowlist) {
    const normalizedAllowed = normalizeHostCandidate(allowedHost);
    if (!normalizedAllowed) continue;
    if (normalizedAllowed === normalizedSourceHost) return true;
    if (normalizedAllowed.split(":")[0] === sourceHostname) return true;
  }

  return false;
}

function normalizeHostAllowlist(allowlist: string[]): string[] {
  const normalized = new Set<string>();

  for (const host of allowlist) {
    const candidate = normalizeHostCandidate(host);
    if (!candidate) continue;
    normalized.add(candidate);
  }

  return [...normalized];
}

export function resolveEffectiveSourceHosts(
  configuredSourceHosts: string[],
  inferredSourceHosts: string[],
): string[] {
  const normalizedConfigured = normalizeHostAllowlist(configuredSourceHosts);
  if (normalizedConfigured.length > 0) return normalizedConfigured;
  return normalizeHostAllowlist(inferredSourceHosts);
}

export function resolveEffectiveRedirectHosts(
  configuredRedirectHosts: string[],
  effectiveSourceHosts: string[],
): string[] {
  const normalizedRedirect = normalizeHostAllowlist(configuredRedirectHosts);
  if (normalizedRedirect.length > 0) return normalizedRedirect;
  return normalizeHostAllowlist(effectiveSourceHosts);
}

export function resolveRedirectTarget(
  rawRedirect: string | null | undefined,
  allowlist: string[],
): string | null {
  if (!rawRedirect) return null;
  if (allowlist.length === 0) return null;

  const candidate = rawRedirect.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    const host = normalizeHostCandidate(parsed.host);
    if (!isHostAllowed(host, allowlist)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseAbsoluteUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  const candidate = raw.trim();
  if (!candidate) return null;

  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function resolveAllowedAbsoluteUrl(
  rawUrl: string | null | undefined,
  allowlist: string[],
): URL | null {
  const parsed = parseAbsoluteUrl(rawUrl);
  if (!parsed) return null;

  const host = normalizeHostCandidate(parsed.host);
  if (!host) return null;
  if (!isHostAllowed(host, allowlist)) return null;

  return parsed;
}

export function resolveDefaultSuccessRedirectTarget(options: {
  rawReferer?: string | null;
  rawOrigin?: string | null;
  allowlist: string[];
  successParam?: string;
  successValue?: string;
}): string | null {
  if (options.allowlist.length === 0) return null;

  const successParam = options.successParam?.trim() || "_vivd_contact";
  const successValue = options.successValue?.trim() || "success";

  const refererUrl = resolveAllowedAbsoluteUrl(options.rawReferer, options.allowlist);
  if (refererUrl) {
    refererUrl.searchParams.set(successParam, successValue);
    return refererUrl.toString();
  }

  const originUrl = resolveAllowedAbsoluteUrl(options.rawOrigin, options.allowlist);
  if (!originUrl) return null;

  originUrl.pathname = originUrl.pathname || "/";
  originUrl.searchParams.set(successParam, successValue);
  return originUrl.toString();
}

export function toTurnstileDomains(allowlist: string[], maxDomains: number): string[] {
  if (maxDomains <= 0) return [];

  const domains = new Set<string>();
  for (const host of allowlist) {
    const normalized = normalizeHostCandidate(host);
    if (!normalized) continue;

    try {
      const parsed = new URL(`https://${normalized}`);
      const hostname = parsed.hostname.trim().toLowerCase();
      if (!hostname) continue;
      // Cloudflare Turnstile domain restrictions expect hostnames, not raw IPv6 literals.
      if (hostname.includes(":")) continue;
      domains.add(hostname);
      if (domains.size >= maxDomains) break;
    } catch {
      continue;
    }
  }

  return [...domains];
}
