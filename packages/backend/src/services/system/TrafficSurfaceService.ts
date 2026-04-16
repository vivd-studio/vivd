import type { HostKind } from "../publish/DomainService";

export type TrafficSurface =
  | "public_site"
  | "platform"
  | "public_ingest"
  | "runtime"
  | "preview"
  | "unknown";

function normalizeHost(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() || "";
  if (!trimmed) return null;
  const host = trimmed.split(",")[0]?.trim() || "";
  if (!host) return null;
  return host.split(":")[0] || null;
}

function normalizePath(value: string | null | undefined): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function readEnvHost(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    return normalizeHost(parsed.host);
  } catch {
    return normalizeHost(trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""));
  }
}

function hostMatches(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left === right);
}

export function classifyTrafficSurface(options: {
  hostKind?: HostKind | null;
  requestHost?: string | null;
  requestPath?: string | null;
  controlPlaneHost?: string | null;
  publicPluginApiHost?: string | null;
  docsHost?: string | null;
}): TrafficSurface {
  const path = normalizePath(options.requestPath);
  const requestHost = normalizeHost(options.requestHost);
  const controlPlaneHost = normalizeHost(options.controlPlaneHost);
  const publicPluginApiHost = normalizeHost(options.publicPluginApiHost);
  const docsHost = normalizeHost(options.docsHost);

  if (path.startsWith("/vivd-studio/api/preview/")) {
    return "preview";
  }

  if (
    path.startsWith("/_studio") ||
    path === "/vivd-studio" ||
    path.startsWith("/vivd-studio/") ||
    path.startsWith("/trpc")
  ) {
    return "platform";
  }

  if (
    path.startsWith("/plugins/") ||
    path.startsWith("/email/v1/feedback/")
  ) {
    return hostMatches(requestHost, publicPluginApiHost) ? "public_ingest" : "platform";
  }

  if (hostMatches(requestHost, docsHost)) return "public_site";
  if (hostMatches(requestHost, publicPluginApiHost)) return "public_ingest";

  if (hostMatches(requestHost, controlPlaneHost)) {
    return options.hostKind === "published_domain" ? "public_site" : "platform";
  }

  if (options.hostKind === "control_plane_host") return "platform";
  if (options.hostKind === "tenant_host" || options.hostKind === "published_domain") {
    return "public_site";
  }

  return "unknown";
}

export class TrafficSurfaceService {
  getConfiguredHosts(): {
    controlPlaneHost: string | null;
    publicPluginApiHost: string | null;
    docsHost: string | null;
  } {
    return {
      controlPlaneHost:
        readEnvHost(process.env.CONTROL_PLANE_HOST) ?? readEnvHost(process.env.DOMAIN),
      publicPluginApiHost: readEnvHost(process.env.VIVD_PUBLIC_PLUGIN_API_HOST),
      docsHost: readEnvHost(process.env.VIVD_DOCS_HOST),
    };
  }

  classifyRequest(options: {
    hostKind?: HostKind | null;
    requestHost?: string | null;
    requestPath?: string | null;
    controlPlaneHost?: string | null;
  }): TrafficSurface {
    const configured = this.getConfiguredHosts();
    return classifyTrafficSurface({
      hostKind: options.hostKind,
      requestHost: options.requestHost,
      requestPath: options.requestPath,
      controlPlaneHost: options.controlPlaneHost ?? configured.controlPlaneHost,
      publicPluginApiHost: configured.publicPluginApiHost,
      docsHost: configured.docsHost,
    });
  }
}

export const trafficSurfaceService = new TrafficSurfaceService();
