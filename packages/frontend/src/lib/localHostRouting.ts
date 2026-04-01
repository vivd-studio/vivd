function splitHostAndPort(host: string): { hostname: string; port: string | null } {
  const trimmed = host.trim().toLowerCase();
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

export function stripPort(host: string): string {
  return splitHostAndPort(host).hostname;
}

export function isLocalDevelopmentHost(host: string): boolean {
  const normalizedHost = stripPort(host);
  return (
    normalizedHost === "localhost" ||
    normalizedHost === "127.0.0.1" ||
    normalizedHost.endsWith(".localhost") ||
    normalizedHost.endsWith(".local") ||
    normalizedHost.endsWith(".nip.io")
  );
}

export function inferSchemeForHost(host: string): "http" | "https" {
  if (isLocalDevelopmentHost(host)) {
    return "http";
  }
  return "https";
}

export function resolveLocalDevelopmentHost(
  targetHost: string | null | undefined,
  currentHost: string | null | undefined,
): string | null {
  const normalizedTarget = (targetHost || "").trim().toLowerCase();
  if (!normalizedTarget) return null;

  const normalizedCurrent = (currentHost || "").trim().toLowerCase();
  if (
    !normalizedCurrent ||
    !isLocalDevelopmentHost(normalizedTarget) ||
    !isLocalDevelopmentHost(normalizedCurrent)
  ) {
    return normalizedTarget;
  }

  const targetParts = splitHostAndPort(normalizedTarget);
  if (targetParts.port) {
    return normalizedTarget;
  }

  const currentParts = splitHostAndPort(normalizedCurrent);
  if (!currentParts.port) {
    return normalizedTarget;
  }

  return `${targetParts.hostname}:${currentParts.port}`;
}

export function buildHostOrigin(
  targetHost: string,
  currentHost?: string | null,
): string {
  const resolvedHost =
    resolveLocalDevelopmentHost(targetHost, currentHost) ??
    targetHost.trim().toLowerCase();
  return `${inferSchemeForHost(resolvedHost)}://${resolvedHost}`;
}
