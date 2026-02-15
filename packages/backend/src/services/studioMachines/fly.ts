import type {
  StudioMachineProvider,
  StudioMachineRestartArgs,
  StudioMachineStartArgs,
  StudioMachineStartResult,
} from "./types";
import crypto from "node:crypto";

type FlyMachineState =
  | "created"
  | "starting"
  | "started"
  | "stopping"
  | "stopped"
  | "replacing"
  | "destroying"
  | "destroyed"
  | "suspended";

type FlyImageRef = {
  registry?: string;
  repository?: string;
  tag?: string;
  digest?: string;
  labels?: Record<string, string>;
};

type FlyMachinePort = {
  port?: number;
  handlers?: string[];
};

type FlyMachineService = {
  protocol?: string;
  internal_port?: number;
  ports?: FlyMachinePort[];
  // New-format string, but the API can return booleans for backwards compat.
  autostop?: "off" | "stop" | "suspend" | boolean | string;
  autostart?: boolean;
  min_machines_running?: number;
  [key: string]: unknown;
};

type FlyMachineGuest = {
  cpu_kind?: "shared" | "performance" | string;
  cpus?: number;
  memory_mb?: number;
  [key: string]: unknown;
};

type FlyMachineConfig = {
  image?: string;
  env?: Record<string, string>;
  guest?: FlyMachineGuest;
  services?: FlyMachineService[];
  metadata?: Record<string, string>;
  // Keep unknown fields when passing configs back to Fly.
  [key: string]: unknown;
};

type FlyMachine = {
  id: string;
  name?: string;
  state?: FlyMachineState | string;
  region?: string;
  instance_id?: string;
  image_ref?: FlyImageRef;
  config?: FlyMachineConfig;
  // Older code used to send top-level metadata, but Fly stores it on config.metadata.
  // Keep this optional for backwards compatibility with any cached shapes.
  metadata?: Record<string, string>;
};

type FlyApiError = {
  error?: string;
  message?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeForFlyAppId(input: string): string {
  // Fly app names: lowercase letters, numbers, and hyphens.
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseIntOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object") return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v !== "string") return false;
  }
  return true;
}

type Semver = { major: number; minor: number; patch: number };

function parseSemverTag(tag: string): { version: Semver; normalized: string } | null {
  const match = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if (![major, minor, patch].every((n) => Number.isFinite(n) && n >= 0)) {
    return null;
  }

  return {
    version: { major, minor, patch },
    normalized: `${major}.${minor}.${patch}`,
  };
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function pickLatestSemverTag(tags: string[]): string | null {
  const byVersion = new Map<string, { version: Semver; tagWithV?: string; tagNoV?: string }>();

  for (const tag of tags) {
    const parsed = parseSemverTag(tag);
    if (!parsed) continue;
    const entry =
      byVersion.get(parsed.normalized) || { version: parsed.version };
    if (tag.startsWith("v")) {
      entry.tagWithV = tag;
    } else {
      entry.tagNoV = tag;
    }
    byVersion.set(parsed.normalized, entry);
  }

  let best: { version: Semver; tag: string } | null = null;
  for (const entry of byVersion.values()) {
    const tag = entry.tagNoV || entry.tagWithV;
    if (!tag) continue;

    if (!best || compareSemver(entry.version, best.version) > 0) {
      best = { version: entry.version, tag };
    }
  }

  return best?.tag || null;
}

function normalizeGhcrRepository(input: string): { ownerRepo: string; imageBase: string } {
  let value = input.trim();

  if (value.startsWith("https://")) value = value.slice("https://".length);
  if (value.startsWith("http://")) value = value.slice("http://".length);

  // Allow passing full image refs (strip tag/digest).
  value = value.split("@")[0];
  const lastSlash = value.lastIndexOf("/");
  const lastColon = value.lastIndexOf(":");
  if (lastColon > lastSlash) value = value.slice(0, lastColon);

  if (value.startsWith("ghcr.io/")) value = value.slice("ghcr.io/".length);
  if (!value.includes("/")) {
    throw new Error(
      `[FlyMachines] Invalid GHCR repository "${input}". Expected "owner/repo" or "ghcr.io/owner/repo".`,
    );
  }

  return { ownerRepo: value, imageBase: `ghcr.io/${value}` };
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGhcrPullToken(options: {
  ownerRepo: string;
  timeoutMs: number;
}): Promise<string> {
  const tokenUrl = new URL("https://ghcr.io/token");
  tokenUrl.searchParams.set("service", "ghcr.io");
  tokenUrl.searchParams.set("scope", `repository:${options.ownerRepo}:pull`);

  const data = await fetchJsonWithTimeout<{ token?: string }>(
    tokenUrl.toString(),
    { method: "GET" },
    options.timeoutMs,
  );
  if (!data.token) throw new Error("Missing token in GHCR response");
  return data.token;
}

async function fetchGhcrTags(options: {
  ownerRepo: string;
  token: string;
  timeoutMs: number;
}): Promise<string[]> {
  const tagsUrl = `https://ghcr.io/v2/${options.ownerRepo}/tags/list`;
  const data = await fetchJsonWithTimeout<{ tags?: string[] }>(
    tagsUrl,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${options.token}`,
      },
    },
    options.timeoutMs,
  );

  if (!Array.isArray(data.tags)) return [];
  return data.tags.filter((tag): tag is string => typeof tag === "string");
}

export class FlyStudioMachineProvider implements StudioMachineProvider {
  kind = "fly" as const;

  private machinesCache: { machines: FlyMachine[]; fetchedAt: number } | null =
    null;
  private inflight = new Map<string, Promise<StudioMachineStartResult>>();
  private resolvedImageCache: { image: string; fetchedAt: number } | null = null;
  private resolveImageInflight: Promise<string> | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;
  private idleCleanupInterval: NodeJS.Timeout | null = null;
  private lastActivityByStudioKey = new Map<string, number>();
  private idleStopInFlight = new Set<string>();

  constructor() {
    // Avoid log spam if Fly isn't configured yet.
    if (!process.env.FLY_API_TOKEN || !process.env.FLY_STUDIO_APP) return;

    // Best-effort background refresh to reduce latency for status checks.
    this.refreshInterval = setInterval(() => {
      void this.refreshMachines();
    }, 5_000);
    // Don't keep the backend process alive just to refresh the Fly cache.
    this.refreshInterval.unref?.();
    void this.refreshMachines();

    if (this.idleTimeoutMs > 0) {
      this.idleCleanupInterval = setInterval(() => {
        void this.stopIdleMachines();
      }, this.idleCheckIntervalMs);
      this.idleCleanupInterval.unref?.();
      void this.stopIdleMachines();
    }
  }

  private key(organizationId: string, projectSlug: string, version: number): string {
    return `${organizationId}:${projectSlug}:v${version}`;
  }

  private machineNameFor(
    organizationId: string,
    projectSlug: string,
    version: number
  ): string {
    const key = `${organizationId}:${projectSlug}:v${version}`;
    const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 10);
    const base = sanitizeForFlyAppId(`studio-${projectSlug}-v${version}`);
    const maxBaseLen = 45 - (hash.length + 1);
    const clippedBase = base.length > maxBaseLen ? base.slice(0, maxBaseLen) : base;
    return `${clippedBase}-${hash}`;
  }

  private get token(): string {
    const token = process.env.FLY_API_TOKEN;
    if (!token) {
      throw new Error(
        "Missing FLY_API_TOKEN. Create a token with `fly tokens create` and set it in your backend environment.",
      );
    }
    return token;
  }

  private get appName(): string {
    const app = process.env.FLY_STUDIO_APP;
    if (!app) {
      throw new Error(
        "Missing FLY_STUDIO_APP (Fly app name to host studio machines). Create one with `fly apps create <name>`.",
      );
    }
    return app;
  }

  private get studioImageRepository(): string {
    const configured = process.env.FLY_STUDIO_IMAGE_REPO?.trim();
    if (configured) return configured;
    return "ghcr.io/vivd-studio/vivd-studio";
  }

  private get fallbackStudioImage(): string {
    try {
      const { imageBase } = normalizeGhcrRepository(this.studioImageRepository);
      return `${imageBase}:latest`;
    } catch {
      return "ghcr.io/vivd-studio/vivd-studio:latest";
    }
  }

  private async resolveLatestStudioImageFromGhcr(): Promise<string> {
    const { ownerRepo, imageBase } = normalizeGhcrRepository(
      this.studioImageRepository,
    );
    const token = await fetchGhcrPullToken({
      ownerRepo,
      timeoutMs: 10_000,
    });
    const tags = await fetchGhcrTags({
      ownerRepo,
      token,
      timeoutMs: 10_000,
    });

    const latestTag = pickLatestSemverTag(tags);
    if (!latestTag) {
      throw new Error(
        `No semver tags found for GHCR repository ${ownerRepo} (tags=${tags.length})`,
      );
    }

    return `${imageBase}:${latestTag}`;
  }

  private async getDesiredImage(): Promise<string> {
    const configured = process.env.FLY_STUDIO_IMAGE;
    if (configured && configured.trim().length > 0) return configured;

    const now = Date.now();
    const refreshMs = 300_000; // 5 minutes
    if (this.resolvedImageCache && now - this.resolvedImageCache.fetchedAt < refreshMs) {
      return this.resolvedImageCache.image;
    }

    const inflight = this.resolveImageInflight;
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const resolved = await this.resolveLatestStudioImageFromGhcr();
        this.resolvedImageCache = { image: resolved, fetchedAt: Date.now() };
        return resolved;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[FlyMachines] Failed to resolve latest studio image: ${message}`);
        return this.resolvedImageCache?.image || this.fallbackStudioImage;
      } finally {
        this.resolveImageInflight = null;
      }
    })();

    this.resolveImageInflight = promise;
    return promise;
  }

  private get region(): string {
    return process.env.FLY_STUDIO_REGION || process.env.FLY_REGION || "iad";
  }

  private get portStart(): number {
    const raw = process.env.FLY_STUDIO_PORT_START || "3100";
    const parsed = Number.parseInt(raw, 10);
    return Math.max(1024, Number.isFinite(parsed) ? parsed : 3100);
  }

  private get publicHost(): string {
    return process.env.FLY_STUDIO_PUBLIC_HOST || `${this.appName}.fly.dev`;
  }

  private get publicProtocol(): string {
    return process.env.FLY_STUDIO_PUBLIC_PROTOCOL || "https";
  }

  private get startTimeoutMs(): number {
    const raw = process.env.STUDIO_MACHINE_START_TIMEOUT_MS || "300000";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 300_000;
  }

  private get idleTimeoutMs(): number {
    return parseNonNegativeInt(process.env.FLY_STUDIO_IDLE_TIMEOUT_MS, 120_000);
  }

  private get idleCheckIntervalMs(): number {
    return parseNonNegativeInt(
      process.env.FLY_STUDIO_IDLE_CHECK_INTERVAL_MS,
      30_000,
    );
  }

  private get cpuKind(): "shared" | "performance" {
    const configured = (process.env.FLY_STUDIO_CPU_KIND || "shared")
      .trim()
      .toLowerCase();
    return configured === "performance" ? "performance" : "shared";
  }

  private get cpuCount(): number {
    return parsePositiveInt(process.env.FLY_STUDIO_CPUS, 1);
  }

  private get minimumMemoryMb(): number {
    if (this.cpuKind !== "performance") return 256;
    // Performance machines require more RAM; enforce a conservative floor.
    return Math.max(4096, this.cpuCount * 2048);
  }

  private get memoryMb(): number {
    const configured = parsePositiveInt(process.env.FLY_STUDIO_MEMORY_MB, 1024);
    const minimum = this.minimumMemoryMb;
    if (configured < minimum) {
      console.warn(
        `[FlyMachines] FLY_STUDIO_MEMORY_MB=${configured} too low for cpu_kind=${this.cpuKind}, cpus=${this.cpuCount}; using ${minimum} MiB.`,
      );
      return minimum;
    }
    return configured;
  }

  private async flyFetch<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = `https://api.machines.dev/v1/apps/${this.appName}${path}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, { ...init, headers });
    if (response.ok) {
      // Some endpoints return empty bodies.
      const text = await response.text();
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    }

    const bodyText = await response.text();
    let body: FlyApiError | null = null;
    try {
      body = bodyText ? (JSON.parse(bodyText) as FlyApiError) : null;
    } catch {
      body = null;
    }

    const message =
      body?.error ||
      body?.message ||
      (bodyText ? bodyText.slice(0, 400) : "") ||
      `${response.status} ${response.statusText}`;

    throw new Error(`[FlyMachines] ${message}`);
  }

  private async listMachines(): Promise<FlyMachine[]> {
    const now = Date.now();
    if (this.machinesCache && now - this.machinesCache.fetchedAt < 2000) {
      return this.machinesCache.machines;
    }
    const machines = await this.flyFetch<FlyMachine[]>("/machines", {
      method: "GET",
    });
    this.machinesCache = { machines, fetchedAt: now };
    return machines;
  }

  private async refreshMachines(): Promise<void> {
    try {
      await this.listMachines();
    } catch (err) {
      // Don't crash the backend if Fly isn't configured in local dev yet.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[FlyMachines] Refresh failed: ${message}`);
    }
  }

  private async stopIdleMachines(): Promise<void> {
    const idleTimeoutMs = this.idleTimeoutMs;
    if (idleTimeoutMs <= 0) return;

    const now = Date.now();
    const machines = await this.listMachines();

    for (const machine of machines) {
      if (machine.state !== "started") continue;

      const studioKey = this.getStudioKeyFromMachine(machine);
      if (!studioKey) continue;

      const lastActivity = this.lastActivityByStudioKey.get(studioKey);
      if (!lastActivity) {
        this.lastActivityByStudioKey.set(studioKey, now);
        continue;
      }

      if (now - lastActivity < idleTimeoutMs) continue;
      if (this.idleStopInFlight.has(studioKey)) continue;

      this.idleStopInFlight.add(studioKey);
      try {
        const action = await this.suspendOrStopMachine(machine.id);
        this.lastActivityByStudioKey.delete(studioKey);
        const idleSeconds = Math.max(1, Math.round((now - lastActivity) / 1000));
        console.log(
          `[FlyMachines] ${action === "suspended" ? "Suspended" : "Stopped"} idle machine ${machine.id} for ${studioKey} after ${idleSeconds}s without keepalive`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[FlyMachines] Failed to suspend/stop idle machine ${machine.id} for ${studioKey}: ${message}`,
        );
      } finally {
        this.idleStopInFlight.delete(studioKey);
      }
    }
  }

  private findMachine(
    machines: FlyMachine[],
    organizationId: string,
    projectSlug: string,
    version: number,
  ): FlyMachine | null {
    const v = String(version);
    const expectedOrg = organizationId.trim() || "default";
    return (
      machines.find((machine) => {
        const metadata = this.getMachineMetadata(machine);
        const machineOrg = (
          metadata?.vivd_organization_id ||
          machine.config?.env?.VIVD_TENANT_ID ||
          "default"
        ).trim() || "default";
        const machineSlug =
          metadata?.vivd_project_slug || machine.config?.env?.VIVD_PROJECT_SLUG;
        const machineVersion =
          metadata?.vivd_project_version ||
          machine.config?.env?.VIVD_PROJECT_VERSION;
        return (
          machineOrg === expectedOrg &&
          machineSlug === projectSlug && machineVersion === v
        );
      }) || null
    );
  }

  private findMachineByName(machines: FlyMachine[], machineName: string): FlyMachine | null {
    return machines.find((machine) => machine.name === machineName) || null;
  }

  private getStudioKeyFromMachine(machine: FlyMachine): string | null {
    const metadata = this.getMachineMetadata(machine);
    const organizationId = (
      metadata?.vivd_organization_id ||
      machine.config?.env?.VIVD_TENANT_ID ||
      "default"
    ).trim() || "default";
    const projectSlug =
      metadata?.vivd_project_slug || machine.config?.env?.VIVD_PROJECT_SLUG;
    const version = parseIntOrNull(
      metadata?.vivd_project_version || machine.config?.env?.VIVD_PROJECT_VERSION,
    );
    if (!projectSlug || !version) return null;
    return this.key(organizationId, projectSlug, version);
  }

  private touchKey(studioKey: string): void {
    this.lastActivityByStudioKey.set(studioKey, Date.now());
  }

  private getMachineMetadata(machine: FlyMachine): Record<string, string> | null {
    const fromConfig = machine.config?.metadata;
    if (isRecordOfStrings(fromConfig)) return fromConfig;
    const legacy = machine.metadata;
    if (isRecordOfStrings(legacy)) return legacy;
    return null;
  }

  private getMachineExternalPort(machine: FlyMachine): number | null {
    const fromMetadata = parseIntOrNull(
      this.getMachineMetadata(machine)?.vivd_external_port,
    );
    if (fromMetadata) return fromMetadata;

    const ports = machine.config?.services?.flatMap((s) => s.ports ?? []) ?? [];
    const port = ports.map((p) => p.port).find((p) => typeof p === "number");
    return typeof port === "number" ? port : null;
  }

  private getPublicUrlForPort(port: number): string {
    const needsPort =
      !(this.publicProtocol === "https" && port === 443) &&
      !(this.publicProtocol === "http" && port === 80);
    return `${this.publicProtocol}://${this.publicHost}${needsPort ? `:${port}` : ""}`;
  }

  private isMachineGettingReplacedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return (
      normalized.includes("failed_precondition") &&
      normalized.includes("machine getting replaced")
    );
  }

  private async startMachine(machineId: string): Promise<void> {
    await this.flyFetch(`/machines/${machineId}/start`, { method: "POST" });
  }

  private async startMachineHandlingReplacement(machineId: string): Promise<void> {
    const startedAt = Date.now();
    const timeoutMs = 60_000;
    let delayMs = 750;

    while (Date.now() - startedAt < timeoutMs) {
      const machine = await this.getMachine(machineId);
      const state = machine.state || "unknown";

      if (state === "destroyed" || state === "destroying") {
        throw new Error(`[FlyMachines] Machine ${machineId} was destroyed`);
      }

      if (state === "started" || state === "starting") return;

      if (state !== "replacing") {
        try {
          await this.startMachine(machineId);
          return;
        } catch (err) {
          if (!this.isMachineGettingReplacedError(err)) throw err;
          // Fall through to retry loop (state should eventually stop being "replacing").
        }
      }

      await sleep(delayMs);
      delayMs = Math.min(5000, Math.round(delayMs * 1.4));
    }

    throw new Error(
      `[FlyMachines] Timed out waiting for machine to finish replacement (${machineId})`,
    );
  }

  private async stopMachine(machineId: string): Promise<void> {
    await this.flyFetch(`/machines/${machineId}/stop`, { method: "POST" });
  }

  private async suspendMachine(machineId: string): Promise<void> {
    await this.flyFetch(`/machines/${machineId}/suspend`, { method: "POST" });
  }

  private async suspendOrStopMachine(machineId: string): Promise<"suspended" | "stopped"> {
    try {
      await this.suspendMachine(machineId);
      return "suspended";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[FlyMachines] Failed to suspend machine ${machineId}: ${message}; falling back to stop.`,
      );
      await this.stopMachine(machineId);
      return "stopped";
    }
  }

  private async getMachine(machineId: string): Promise<FlyMachine> {
    return this.flyFetch<FlyMachine>(`/machines/${machineId}`, { method: "GET" });
  }

  private async waitForReady(options: {
    machineId: string;
    url: string;
    timeoutMs: number;
  }): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < options.timeoutMs) {
      const machine = await this.getMachine(options.machineId);
      const state = machine.state || "unknown";

      if (state === "destroyed" || state === "destroying") {
        throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
      }

      if (state === "started") {
        try {
          const response = await fetch(`${options.url}/health`, { method: "GET" });
          if (response.ok) {
            const data = (await response.json()) as { status?: string };
            if (data.status === "ok") return;
          }
        } catch {
          // Not ready yet
        }
      }

      await sleep(1000);
    }

    throw new Error(
      `[FlyMachines] Timed out waiting for machine to become ready (${options.machineId})`,
    );
  }

  private async waitForState(options: {
    machineId: string;
    state: FlyMachineState;
    timeoutMs: number;
  }): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < options.timeoutMs) {
      const machine = await this.getMachine(options.machineId);
      const state = machine.state || "unknown";

      if (state === options.state) return;
      if (state === "destroyed" || state === "destroying") {
        throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
      }

      await sleep(500);
    }

    throw new Error(
      `[FlyMachines] Timed out waiting for machine to reach state=${options.state} (${options.machineId})`,
    );
  }

  private normalizeServicesForVivd(
    services: FlyMachineService[] | undefined,
    externalPort: number,
  ): FlyMachineService[] {
    const normalized = (services && services.length > 0 ? services : [{}]).map(
      (service) => {
        const ports = (service.ports && service.ports.length > 0
          ? service.ports
          : [{ port: externalPort, handlers: ["tls", "http"] }]) as FlyMachinePort[];

        // Ensure the external port we expect is present.
        const hasExternalPort = ports.some((p) => p.port === externalPort);
        if (!hasExternalPort) {
          ports.push({ port: externalPort, handlers: ["tls", "http"] });
        }

        return {
          ...service,
          protocol: service.protocol || "tcp",
          internal_port: service.internal_port || 3100,
          ports,
          autostop: "suspend",
          autostart: false,
          min_machines_running: 0,
        };
      },
    );

    return normalized;
  }

  private async updateMachineConfig(options: {
    machineId: string;
    config: FlyMachineConfig;
    skipLaunch?: boolean;
  }): Promise<FlyMachine> {
    const body: Record<string, unknown> = { config: options.config };
    if (options.skipLaunch) body.skip_launch = true;
    const machine = await this.flyFetch<FlyMachine>(`/machines/${options.machineId}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    this.machinesCache = null;
    return machine;
  }

  private async ensureExistingMachineRunning(
    existing: FlyMachine,
    args: StudioMachineStartArgs,
    studioKey: string,
  ): Promise<StudioMachineStartResult> {
    const port = this.getMachineExternalPort(existing);
    if (!port) {
      throw new Error(
        `[FlyMachines] Found machine ${existing.id} for ${args.projectSlug}/v${args.version} but could not determine its external port. Destroy it or recreate it.`,
      );
    }

    const desiredImage = await this.getDesiredImage();
    const configuredImage =
      typeof existing.config?.image === "string" ? existing.config.image : null;
    const needsImageUpdate = configuredImage !== desiredImage;

    const needsServiceUpdate =
      existing.config?.services?.some((service) => {
        const needsAutostart = service.autostart !== false;
        const needsAutostop = service.autostop !== "suspend";
        return needsAutostart || needsAutostop;
      }) ?? true;

    // Only reconcile machine config when it's not running, to avoid disrupting an
    // active studio session. This also ensures the next boot uses the latest image.
    if (existing.state !== "started" && (needsImageUpdate || needsServiceUpdate)) {
      // A suspended machine would resume a snapshot; stop it first to boot fresh.
      if (needsImageUpdate && existing.state === "suspended") {
        await this.stopMachine(existing.id);
        await this.waitForState({
          machineId: existing.id,
          state: "stopped",
          timeoutMs: 60_000,
        });
      }

      const current = await this.getMachine(existing.id);

      const studioId =
        this.getMachineMetadata(current)?.vivd_studio_id ||
        current.config?.env?.STUDIO_ID ||
        args.env.STUDIO_ID ||
        crypto.randomUUID();

      const metadata: Record<string, string> = {
        ...(this.getMachineMetadata(current) || {}),
        vivd_organization_id: args.organizationId,
        vivd_project_slug: args.projectSlug,
        vivd_project_version: String(args.version),
        vivd_external_port: String(port),
        vivd_studio_id: studioId,
        vivd_image: desiredImage,
      };

      const config: FlyMachineConfig = {
        ...(current.config || {}),
        ...(needsImageUpdate ? { image: desiredImage } : {}),
        // Keep services stable and prevent wakeups from stray traffic.
        ...(needsServiceUpdate
          ? { services: this.normalizeServicesForVivd(current.config?.services, port) }
          : {}),
        metadata,
      };

      await this.updateMachineConfig({
        machineId: existing.id,
        config,
        skipLaunch: true,
      });

      existing = await this.getMachine(existing.id);
    }

    if (existing.state !== "started") {
      await this.startMachineHandlingReplacement(existing.id);
    }

    const url = this.getPublicUrlForPort(port);
    await this.waitForReady({
      machineId: existing.id,
      url,
      timeoutMs: this.startTimeoutMs,
    });

    const studioId =
      this.getMachineMetadata(existing)?.vivd_studio_id ||
      existing.config?.env?.STUDIO_ID ||
      args.env.STUDIO_ID ||
      crypto.randomUUID();

    this.touchKey(studioKey);
    return { studioId, url, port };
  }

  private async recoverCreateNameConflict(
    error: unknown,
    machineName: string,
  ): Promise<FlyMachine | null> {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    const isNameConflict =
      normalized.includes("already_exists") &&
      normalized.includes("unique machine name");
    if (!isNameConflict) return null;

    const machineIdMatch = message.match(/machine ID ([a-z0-9]+)/i);
    const machineId = machineIdMatch?.[1];
    if (machineId) {
      try {
        return await this.getMachine(machineId);
      } catch {
        // Fall through to list-based lookup.
      }
    }

    this.machinesCache = null;
    const machines = await this.listMachines();
    return this.findMachineByName(machines, machineName);
  }

  private allocatePort(machines: FlyMachine[]): number {
    const used = new Set<number>();
    for (const machine of machines) {
      const port = this.getMachineExternalPort(machine);
      if (port) used.add(port);
    }

    for (let i = 0; i < 500; i++) {
      const candidate = this.portStart + i;
      if (candidate > 65535) break;
      if (!used.has(candidate)) return candidate;
    }

    throw new Error(
      `[FlyMachines] No available ports (start=${this.portStart}). Set FLY_STUDIO_PORT_START to a different range.`,
    );
  }

  private buildStudioEnv(args: StudioMachineStartArgs & { studioId: string }): Record<string, string> {
    const workspaceDir =
      process.env.FLY_STUDIO_WORKSPACE_DIR || "/home/studio/project";
    const opencodeDataHome =
      process.env.FLY_STUDIO_OPENCODE_DATA_HOME ||
      "/home/studio/opencode-data";

    const env: Record<string, string> = {
      PORT: "3100",
      STUDIO_ID: args.studioId,
      VIVD_TENANT_ID: args.organizationId,
      VIVD_PROJECT_SLUG: args.projectSlug,
      VIVD_PROJECT_VERSION: String(args.version),
      VIVD_WORKSPACE_DIR: workspaceDir,
      VIVD_OPENCODE_DATA_HOME: opencodeDataHome,
      XDG_DATA_HOME: opencodeDataHome,
      // Fly machines are isolated; fixed internal ports are fine.
      DEV_SERVER_PORT_START: "5100",
      OPENCODE_PORT_START: "4096",
    };

	    const explicitEnvKeys = new Set(Object.keys(args.env));
	    for (const [k, v] of Object.entries(args.env)) {
	      if (typeof v === "string") env[k] = v;
	    }

	    // Optional passthrough for local-first testing (keeps config explicit).
		    const passthrough = (process.env.FLY_STUDIO_ENV_PASSTHROUGH ||
		      "GOOGLE_API_KEY,OPENROUTER_API_KEY,OPENCODE_MODEL,OPENCODE_MODELS,R2_ENDPOINT,R2_BUCKET,R2_ACCESS_KEY,R2_SECRET_KEY,VIVD_S3_BUCKET,VIVD_S3_ENDPOINT_URL,VIVD_S3_PREFIX,VIVD_S3_SOURCE_URI,VIVD_S3_OPENCODE_PREFIX,VIVD_S3_OPENCODE_URI,AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,AWS_SESSION_TOKEN,AWS_DEFAULT_REGION,AWS_REGION,DEVSERVER_INSTALL_TIMEOUT_MS,VIVD_PACKAGE_CACHE_DIR,DEVSERVER_NODE_MODULES_CACHE,GITHUB_SYNC_ENABLED,GITHUB_SYNC_STRICT,GITHUB_ORG,GITHUB_TOKEN,GITHUB_REPO_PREFIX,GITHUB_REPO_VISIBILITY,GITHUB_API_URL,GITHUB_GIT_HOST,GITHUB_REMOTE_NAME")
		      .split(",")
		      .map((k) => k.trim())
		      .filter(Boolean);

	    for (const key of passthrough) {
	      if (explicitEnvKeys.has(key)) continue;
	      const value = process.env[key];
	      if (value) env[key] = value;
	    }

    return env;
  }

  async ensureRunning(args: StudioMachineStartArgs): Promise<StudioMachineStartResult> {
    const key = this.key(args.organizationId, args.projectSlug, args.version);
    const existingInflight = this.inflight.get(key);
    if (existingInflight) return existingInflight;

    const promise = this.ensureRunningInner(args).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  async restart(args: StudioMachineRestartArgs): Promise<StudioMachineStartResult> {
    if (args.mode !== "hard") {
      return this.ensureRunning(args);
    }

    const key = this.key(args.organizationId, args.projectSlug, args.version);
    const existingInflight = this.inflight.get(key);
    if (existingInflight) {
      try {
        await existingInflight;
      } catch {
        // Ignore and proceed with restart.
      }
    }

    const promise = this.restartInner(args).finally(() => {
      if (this.inflight.get(key) === promise) {
        this.inflight.delete(key);
      }
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async restartInner(args: StudioMachineRestartArgs): Promise<StudioMachineStartResult> {
    const studioKey = this.key(args.organizationId, args.projectSlug, args.version);
    const machineName = this.machineNameFor(args.organizationId, args.projectSlug, args.version);

    const machines = await this.listMachines();
    const existing =
      this.findMachineByName(machines, machineName) ||
      this.findMachine(machines, args.organizationId, args.projectSlug, args.version);

    // No machine exists yet; start normally.
    if (!existing) {
      return this.ensureRunningInner(args);
    }

    const port = this.getMachineExternalPort(existing);
    if (!port) {
      throw new Error(
        `[FlyMachines] Found machine ${existing.id} for ${args.projectSlug}/v${args.version} but could not determine its external port. Destroy it or recreate it.`,
      );
    }

    const current = await this.getMachine(existing.id);
    const state = current.state || "unknown";
    if (state === "destroyed" || state === "destroying") {
      // Machine is gone; start normally.
      this.machinesCache = null;
      return this.ensureRunningInner(args);
    }

    // Force a fresh boot so the studio entrypoint rehydrates from S3.
    if (state !== "stopped") {
      await this.stopMachine(existing.id);
      await this.waitForState({
        machineId: existing.id,
        state: "stopped",
        timeoutMs: 60_000,
      });
    }

    const desiredImage = await this.getDesiredImage();
    const studioId =
      this.getMachineMetadata(current)?.vivd_studio_id ||
      current.config?.env?.STUDIO_ID ||
      args.env.STUDIO_ID ||
      crypto.randomUUID();

    const env = this.buildStudioEnv({ ...args, studioId });

    const metadata: Record<string, string> = {
      ...(this.getMachineMetadata(current) || {}),
      vivd_organization_id: args.organizationId,
      vivd_project_slug: args.projectSlug,
      vivd_project_version: String(args.version),
      vivd_external_port: String(port),
      vivd_studio_id: studioId,
      vivd_image: desiredImage,
    };

    const config: FlyMachineConfig = {
      ...(current.config || {}),
      image: desiredImage,
      env,
      services: this.normalizeServicesForVivd(current.config?.services, port),
      metadata,
    };

    await this.updateMachineConfig({
      machineId: existing.id,
      config,
      skipLaunch: true,
    });

    await this.startMachineHandlingReplacement(existing.id);

    const url = this.getPublicUrlForPort(port);
    await this.waitForReady({
      machineId: existing.id,
      url,
      timeoutMs: this.startTimeoutMs,
    });

    this.touchKey(studioKey);
    return { studioId, url, port };
  }

  private async ensureRunningInner(
    args: StudioMachineStartArgs,
  ): Promise<StudioMachineStartResult> {
    const studioKey = this.key(args.organizationId, args.projectSlug, args.version);
    const machineName = this.machineNameFor(args.organizationId, args.projectSlug, args.version);
    const machines = await this.listMachines();
    const existing =
      this.findMachineByName(machines, machineName) ||
      this.findMachine(machines, args.organizationId, args.projectSlug, args.version);

    if (existing) {
      return this.ensureExistingMachineRunning(existing, args, studioKey);
    }

    const port = this.allocatePort(machines);
    const studioId = args.env.STUDIO_ID || crypto.randomUUID();
    const desiredImage = await this.getDesiredImage();

    const env = this.buildStudioEnv({ ...args, studioId });

    let create: FlyMachine;
    try {
      create = await this.flyFetch<FlyMachine>("/machines", {
        method: "POST",
        body: JSON.stringify({
          name: machineName || undefined,
          region: this.region,
          config: {
            image: desiredImage,
            guest: {
              cpu_kind: this.cpuKind,
              cpus: this.cpuCount,
              memory_mb: this.memoryMb,
            },
            env,
            services: [
              {
                protocol: "tcp",
                internal_port: 3100,
                ports: [{ port, handlers: ["tls", "http"] }],
                autostop: "suspend",
                // We control lifecycle explicitly via the backend. Autostart can wake machines
                // from stray traffic (e.g. previews, probes), so keep it off.
                autostart: false,
                min_machines_running: 0,
              },
            ],
            metadata: {
              vivd_organization_id: args.organizationId,
              vivd_project_slug: args.projectSlug,
              vivd_project_version: String(args.version),
              vivd_external_port: String(port),
              vivd_studio_id: studioId,
              vivd_image: desiredImage,
            },
          },
        }),
      });
    } catch (error) {
      const recovered = await this.recoverCreateNameConflict(error, machineName);
      if (recovered) {
        return this.ensureExistingMachineRunning(recovered, args, studioKey);
      }
      throw error;
    }

    const url = this.getPublicUrlForPort(port);
    await this.waitForReady({
      machineId: create.id,
      url,
      timeoutMs: this.startTimeoutMs,
    });

    this.touchKey(studioKey);
    return { studioId, url, port };
  }

  touch(organizationId: string, projectSlug: string, version: number): void {
    this.touchKey(this.key(organizationId, projectSlug, version));
  }

  async stop(organizationId: string, projectSlug: string, version: number): Promise<void> {
    const studioKey = this.key(organizationId, projectSlug, version);
    this.lastActivityByStudioKey.delete(studioKey);

    const machines = await this.listMachines();
    const existing =
      this.findMachineByName(
        machines,
        this.machineNameFor(organizationId, projectSlug, version),
      ) || this.findMachine(machines, organizationId, projectSlug, version);
    if (!existing) return;
    if (existing.state === "started") {
      await this.suspendOrStopMachine(existing.id);
    }
  }

  async getUrl(
    organizationId: string,
    projectSlug: string,
    version: number
  ): Promise<string | null> {
    try {
      const machines = await this.listMachines();
      const existing =
        this.findMachineByName(
          machines,
          this.machineNameFor(organizationId, projectSlug, version),
        ) || this.findMachine(machines, organizationId, projectSlug, version);
      if (!existing) return null;
      if (existing.state !== "started") return null;
      const port = this.getMachineExternalPort(existing);
      if (!port) return null;
      return this.getPublicUrlForPort(port);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[FlyMachines] getUrl failed for ${organizationId}:${projectSlug}/v${version}: ${message}`,
      );
      return null;
    }
  }

  async isRunning(organizationId: string, projectSlug: string, version: number): Promise<boolean> {
    try {
      const machines = await this.listMachines();
      const existing =
        this.findMachineByName(
          machines,
          this.machineNameFor(organizationId, projectSlug, version),
        ) || this.findMachine(machines, organizationId, projectSlug, version);
      return !!existing && existing.state === "started";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[FlyMachines] isRunning failed for ${organizationId}:${projectSlug}/v${version}: ${message}`,
      );
      return false;
    }
  }
}
