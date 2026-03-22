import crypto from "node:crypto";
import { instanceNetworkSettingsService } from "../../system/InstanceNetworkSettingsService";
import {
  parseBooleanEnv,
  parseNonNegativeInt,
  parsePositiveInt,
  sanitizeForFlyAppId,
} from "../fly/utils";

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
  const host = trimmed.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost");
  const scheme = isLocal ? "http" : "https";
  return `${scheme}://${trimmed}`.replace(/\/+$/, "");
}

function normalizeMainBackendUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
  return new URL("/vivd-studio", `http://${trimmed.replace(/^\/+/, "")}/`)
    .toString()
    .replace(/\/$/, "");
}

function normalizePathPrefix(value: string | undefined, fallback: string): string {
  const raw = (value || "").trim() || fallback;
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeDockerApiVersion(value: string | undefined): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function normalizeDockerPlatform(value: string | undefined): string | null {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;
  return trimmed;
}

export class DockerProviderConfig {
  key(organizationId: string, projectSlug: string, version: number): string {
    return `${organizationId}:${projectSlug}:v${version}`;
  }

  containerNameFor(
    organizationId: string,
    projectSlug: string,
    version: number,
  ): string {
    const key = `${organizationId}:${projectSlug}:v${version}`;
    const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 10);
    const base = sanitizeForFlyAppId(`studio-${projectSlug}-v${version}`);
    const maxBaseLen = 63 - (hash.length + 1);
    const clippedBase = base.length > maxBaseLen ? base.slice(0, maxBaseLen) : base;
    return `${clippedBase}-${hash}`;
  }

  routeIdFor(
    organizationId: string,
    projectSlug: string,
    version: number,
  ): string {
    const key = `${organizationId}:${projectSlug}:v${version}`;
    const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
    const base = sanitizeForFlyAppId(`${projectSlug}-v${version}`);
    const clippedBase = base.length > 24 ? base.slice(0, 24) : base;
    return `${clippedBase}-${hash}`;
  }

  generateStudioAccessToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  get socketPath(): string | null {
    const raw = process.env.DOCKER_STUDIO_SOCKET_PATH?.trim();
    return raw || "/var/run/docker.sock";
  }

  get apiBaseUrl(): string | null {
    const raw = process.env.DOCKER_STUDIO_API_BASE_URL?.trim();
    return raw ? raw.replace(/\/+$/, "") : null;
  }

  get apiVersion(): string {
    return (
      normalizeDockerApiVersion(process.env.DOCKER_STUDIO_API_VERSION) ||
      normalizeDockerApiVersion(process.env.DOCKER_API_VERSION) ||
      "v1.44"
    );
  }

  get fallbackPlatform(): string | null {
    const configured = normalizeDockerPlatform(
      process.env.DOCKER_STUDIO_FALLBACK_PLATFORM,
    );
    if (configured) return configured;
    if (process.env.DOCKER_STUDIO_FALLBACK_PLATFORM !== undefined) return null;
    return "linux/amd64";
  }

  get studioImageRepository(): string {
    const configured = process.env.DOCKER_STUDIO_IMAGE_REPO?.trim();
    if (configured) return configured;
    return "ghcr.io/vivd-studio/vivd-studio";
  }

  get network(): string {
    return process.env.DOCKER_STUDIO_NETWORK?.trim() || "vivd-network";
  }

  get publicBaseUrl(): string {
    const explicit = process.env.DOCKER_STUDIO_PUBLIC_BASE_URL?.trim();
    if (explicit) return normalizeOrigin(explicit);

    const authUrl = process.env.BETTER_AUTH_URL?.trim();
    if (authUrl) return normalizeOrigin(authUrl);

    const networkOrigin = instanceNetworkSettingsService.getResolvedSettings().publicOrigin;
    if (networkOrigin) return normalizeOrigin(networkOrigin);

    const controlPlaneHost =
      process.env.CONTROL_PLANE_HOST?.trim() || process.env.DOMAIN?.trim();
    if (controlPlaneHost) return normalizeOrigin(controlPlaneHost);

    const backendUrl = process.env.BACKEND_URL?.trim();
    if (backendUrl) return normalizeOrigin(backendUrl);

    return "http://localhost";
  }

  get internalProxyBaseUrl(): string {
    const explicit = process.env.DOCKER_STUDIO_INTERNAL_PROXY_BASE_URL?.trim();
    if (explicit) return normalizeOrigin(explicit);
    return "http://caddy";
  }

  get internalMainBackendUrl(): string {
    const explicit = process.env.DOCKER_STUDIO_MAIN_BACKEND_URL?.trim();
    if (explicit) return normalizeMainBackendUrl(explicit);
    return "http://backend:3000/vivd-studio";
  }

  get routePrefix(): string {
    return normalizePathPrefix(process.env.DOCKER_STUDIO_ROUTE_PREFIX, "/_studio");
  }

  routePathFor(routeId: string): string {
    return `${this.routePrefix}/${routeId}`;
  }

  getPublicUrlForRoutePath(routePath: string): string {
    const route = routePath.replace(/^\/+/, "");
    return new URL(route, ensureTrailingSlash(this.publicBaseUrl)).toString();
  }

  getInternalProxyUrlForRoutePath(routePath: string): string {
    const route = routePath.replace(/^\/+/, "");
    return new URL(route, ensureTrailingSlash(this.internalProxyBaseUrl)).toString();
  }

  get runtimeRoutesDir(): string {
    return process.env.CADDY_RUNTIME_ROUTES_DIR || "/etc/caddy/runtime.d";
  }

  get startTimeoutMs(): number {
    const raw = process.env.STUDIO_MACHINE_START_TIMEOUT_MS || "300000";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 300_000;
  }

  get desiredKillTimeoutSeconds(): number {
    return parsePositiveInt(process.env.DOCKER_STUDIO_KILL_TIMEOUT_SECONDS, 180);
  }

  get idleTimeoutMs(): number {
    return parseNonNegativeInt(process.env.DOCKER_STUDIO_IDLE_TIMEOUT_MS, 600_000);
  }

  get idleCheckIntervalMs(): number {
    return parseNonNegativeInt(
      process.env.DOCKER_STUDIO_IDLE_CHECK_INTERVAL_MS,
      30_000,
    );
  }

  get reconcilerEnabled(): boolean {
    return parseBooleanEnv(process.env.DOCKER_STUDIO_RECONCILER_ENABLED, true);
  }

  get reconcilerIntervalMs(): number {
    return parseNonNegativeInt(
      process.env.DOCKER_STUDIO_RECONCILER_INTERVAL_MS,
      600_000,
    );
  }

  get reconcilerDryRun(): boolean {
    return parseBooleanEnv(process.env.DOCKER_STUDIO_RECONCILER_DRY_RUN, false);
  }

  get warmOutdatedImages(): boolean {
    return parseBooleanEnv(
      process.env.DOCKER_STUDIO_RECONCILER_WARM_OUTDATED_IMAGES,
      true,
    );
  }

  get reconcilerConcurrency(): number {
    return parsePositiveInt(
      process.env.DOCKER_STUDIO_RECONCILER_CONCURRENCY,
      20,
    );
  }

  get maxMachineInactivityDays(): number {
    return parsePositiveInt(
      process.env.DOCKER_STUDIO_RECONCILER_MAX_MACHINE_INACTIVITY_DAYS,
      7,
    );
  }

  get maxMachineInactivityMs(): number {
    return this.maxMachineInactivityDays * 24 * 60 * 60 * 1000;
  }

  get cpuLimit(): number {
    return parsePositiveFloat(process.env.DOCKER_STUDIO_CPUS, 1);
  }

  get nanoCpus(): number {
    return Math.max(1, Math.round(this.cpuLimit * 1_000_000_000));
  }

  get memoryMb(): number {
    return parsePositiveInt(process.env.DOCKER_STUDIO_MEMORY_MB, 2048);
  }

  get memoryBytes(): number {
    return this.memoryMb * 1024 * 1024;
  }

  get cpuKindLabel(): string {
    return "docker";
  }
}
