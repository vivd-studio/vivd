import type { InstallProfile } from "../system/InstallProfileService";
import type { StudioMachineProviderKind } from "./types";

interface ResolveStudioBrowserUrlInput {
  installProfile: InstallProfile;
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

export function resolveStudioBrowserUrl(
  input: ResolveStudioBrowserUrlInput,
): string | null {
  const directRuntimeUrl = input.runtimeUrl?.trim() || null;
  const compatibilityUrl = input.compatibilityUrl?.trim() || null;

  if (!directRuntimeUrl) return compatibilityUrl;
  if (!compatibilityUrl) return directRuntimeUrl;

  if (input.providerKind === "local" || input.installProfile === "platform") {
    return directRuntimeUrl;
  }

  const requestOrigin = normalizeRequestOrigin(
    input.requestHost,
    input.requestProtocol,
  );
  if (!requestOrigin) return directRuntimeUrl;

  let runtime: URL;
  let request: URL;
  try {
    runtime = new URL(directRuntimeUrl, requestOrigin);
    request = new URL(requestOrigin);
  } catch {
    return directRuntimeUrl;
  }

  const runtimeUsesNonDefaultPort = !isDefaultPort(
    runtime.protocol,
    runtime.port,
  );
  const requestIsLocalDevelopment = isLocalDevelopmentHostname(request.hostname);

  if (
    !requestIsLocalDevelopment &&
    (runtime.protocol !== request.protocol || runtimeUsesNonDefaultPort)
  ) {
    return compatibilityUrl;
  }

  return directRuntimeUrl;
}
