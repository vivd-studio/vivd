import type { StudioMachineProviderKind } from "./types";

interface ResolveStudioBrowserUrlInput {
  controlPlaneMode: "path_based" | "host_based";
  providerKind: StudioMachineProviderKind;
  requestHost?: string | null;
  requestProtocol?: string | null;
  runtimeUrl?: string | null;
  compatibilityUrl?: string | null;
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

function isDefaultPort(protocol: string, port: string): boolean {
  return (
    (protocol === "https:" && (port === "" || port === "443")) ||
    (protocol === "http:" && (port === "" || port === "80"))
  );
}

function isLocalDevelopmentHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".nip.io")
  );
}

function inferRequestProtocol(hostname: string, protocol: string | null): "http" | "https" {
  if (protocol === "http" || protocol === "https") {
    return protocol;
  }
  return isLocalDevelopmentHostname(hostname) ? "http" : "https";
}

function normalizeRequestOrigin(
  requestHost: string | null | undefined,
  requestProtocol: string | null | undefined,
): string | null {
  const host = requestHost?.trim();
  if (!host) return null;

  const hostname = extractHostname(host);
  if (!hostname) return null;

  const normalizedProtocol = requestProtocol?.trim().toLowerCase() || null;
  return `${inferRequestProtocol(hostname, normalizedProtocol)}://${host}`;
}

function normalizeCompatibilityBrowserUrl(
  compatibility: URL,
  request: URL,
  requestIsLocalDevelopment: boolean,
): string {
  if (
    requestIsLocalDevelopment &&
    compatibility.hostname === request.hostname &&
    compatibility.origin !== request.origin
  ) {
    const rewritten = new URL(
      `${compatibility.pathname}${compatibility.search}${compatibility.hash}`,
      request.origin,
    );
    return rewritten.toString();
  }

  return compatibility.toString();
}

export function resolveStudioBrowserUrl(
  input: ResolveStudioBrowserUrlInput,
): string | null {
  const directRuntimeUrl = input.runtimeUrl?.trim() || null;
  const compatibilityUrl = input.compatibilityUrl?.trim() || null;

  if (!directRuntimeUrl) return compatibilityUrl;
  if (!compatibilityUrl) return directRuntimeUrl;

  const requestOrigin = normalizeRequestOrigin(
    input.requestHost,
    input.requestProtocol,
  );
  if (!requestOrigin) return directRuntimeUrl;

  let runtime: URL;
  let request: URL;
  let compatibility: URL;
  try {
    runtime = new URL(directRuntimeUrl, requestOrigin);
    request = new URL(requestOrigin);
    compatibility = new URL(compatibilityUrl, requestOrigin);
  } catch {
    return directRuntimeUrl;
  }

  const requestIsLocalDevelopment = isLocalDevelopmentHostname(request.hostname);
  const normalizedCompatibilityUrl = normalizeCompatibilityBrowserUrl(
    compatibility,
    request,
    requestIsLocalDevelopment,
  );
  const normalizedCompatibility = new URL(normalizedCompatibilityUrl, requestOrigin);

  if (
    requestIsLocalDevelopment &&
    input.providerKind !== "fly" &&
    normalizedCompatibility.origin === request.origin &&
    runtime.origin !== request.origin
  ) {
    return normalizedCompatibilityUrl;
  }

  if (
    normalizedCompatibility.origin === request.origin &&
    runtime.origin !== request.origin
  ) {
    if (input.controlPlaneMode === "path_based") {
      return normalizedCompatibilityUrl;
    }
  }

  if (input.controlPlaneMode === "host_based") {
    return directRuntimeUrl;
  }

  const runtimeUsesNonDefaultPort = !isDefaultPort(
    runtime.protocol,
    runtime.port,
  );

  if (
    !requestIsLocalDevelopment &&
    (runtime.protocol !== request.protocol || runtimeUsesNonDefaultPort)
  ) {
    return normalizedCompatibilityUrl;
  }

  return directRuntimeUrl;
}
