import { isIP } from "node:net";

export function inferSchemeForHost(host: string): "http" | "https" {
  const normalized = host.trim().toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.includes(".localhost") ||
    isIP(normalized) !== 0
  ) {
    return "http";
  }
  return "https";
}

function toOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `${inferSchemeForHost(trimmed)}://${trimmed}`;
}

export function resolveAuthBaseUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    toOrigin(env.VIVD_APP_URL) ??
    toOrigin(env.BETTER_AUTH_URL) ??
    toOrigin(env.CONTROL_PLANE_HOST) ??
    toOrigin(env.DOMAIN)
  );
}

export function rewriteUrlOrigin(
  inputUrl: string,
  targetOrigin: string | null | undefined,
): string {
  if (!targetOrigin) return inputUrl;

  try {
    const url = new URL(inputUrl);
    const target = new URL(targetOrigin);
    url.protocol = target.protocol;
    url.host = target.host;
    return url.toString();
  } catch {
    return inputUrl;
  }
}
