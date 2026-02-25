interface ResolveStudioMainBackendUrlInput {
  providerKind: "local" | "fly";
  requestHost?: string | null;
  backendUrlEnv?: string | null;
  domainEnv?: string | null;
  betterAuthUrlEnv?: string | null;
  backendPort?: string | number | null;
}

function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function toMainBackendUrl(rawOrigin: string): string {
  const origin = normalizeOrigin(rawOrigin);
  const url = new URL("/vivd-studio", origin).toString();
  return url.replace(/\/$/, "");
}

function extractHostname(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.startsWith("[")) {
    const idx = normalized.indexOf("]");
    return idx > 0 ? normalized.slice(1, idx) : normalized;
  }
  return normalized.split(":")[0] || "";
}

function isLocalHost(host: string): boolean {
  const hostname = extractHostname(host);
  if (!hostname) return false;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost")
  );
}

function pickFallbackOrigin(input: ResolveStudioMainBackendUrlInput): string {
  const backendUrl = input.backendUrlEnv?.trim();
  if (backendUrl) return backendUrl;

  const portRaw = String(input.backendPort ?? "").trim();
  const port = portRaw || "3000";

  if (input.providerKind === "local") {
    return `http://127.0.0.1:${port}`;
  }

  const domain = input.domainEnv?.trim();
  if (domain) return domain;

  const authUrl = input.betterAuthUrlEnv?.trim();
  if (authUrl) return authUrl;

  return `http://127.0.0.1:${port}`;
}

/**
 * Resolve the backend URL used by studio machines for connected-mode callbacks.
 *
 * For remote/Fly machines, prefer the host that initiated the studio start so
 * backend context stays aligned with tenant-host routing.
 */
export function resolveStudioMainBackendUrl(
  input: ResolveStudioMainBackendUrlInput,
): string {
  const requestHost = input.requestHost?.trim();
  if (input.providerKind !== "local" && requestHost) {
    const scheme = isLocalHost(requestHost) ? "http" : "https";
    return toMainBackendUrl(`${scheme}://${requestHost}`);
  }

  return toMainBackendUrl(pickFallbackOrigin(input));
}
