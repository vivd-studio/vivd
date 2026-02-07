import type {
  StudioMachineProvider,
  StudioMachineStartArgs,
  StudioMachineStartResult,
} from "./types";
import crypto from "node:crypto";
import { getActiveTenantId } from "../../generator/versionUtils";

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

type FlyMachine = {
  id: string;
  name?: string;
  state?: FlyMachineState | string;
  region?: string;
  config?: {
    env?: Record<string, string>;
    services?: Array<{
      protocol?: string;
      internal_port?: number;
      ports?: Array<{
        port?: number;
        handlers?: string[];
      }>;
    }>;
  };
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

export class FlyStudioMachineProvider implements StudioMachineProvider {
  kind = "fly" as const;

  private machinesCache: { machines: FlyMachine[]; fetchedAt: number } | null =
    null;
  private inflight = new Map<string, Promise<StudioMachineStartResult>>();
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

  private key(projectSlug: string, version: number): string {
    return `${projectSlug}:${version}`;
  }

  private machineNameFor(projectSlug: string, version: number): string {
    const machineNameBase = sanitizeForFlyAppId(`studio-${projectSlug}-v${version}`);
    return machineNameBase.length > 45
      ? machineNameBase.slice(0, 45)
      : machineNameBase;
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

  private get image(): string {
    return (
      process.env.FLY_STUDIO_IMAGE || "ghcr.io/vivd-studio/vivd-studio:latest"
    );
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

  private get memoryMb(): number {
    return Math.max(256, parsePositiveInt(process.env.FLY_STUDIO_MEMORY_MB, 1024));
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
        await this.stopMachine(machine.id);
        this.lastActivityByStudioKey.delete(studioKey);
        const idleSeconds = Math.max(1, Math.round((now - lastActivity) / 1000));
        console.log(
          `[FlyMachines] Stopped idle machine ${machine.id} for ${studioKey} after ${idleSeconds}s without keepalive`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[FlyMachines] Failed to stop idle machine ${machine.id} for ${studioKey}: ${message}`,
        );
      } finally {
        this.idleStopInFlight.delete(studioKey);
      }
    }
  }

  private findMachine(
    machines: FlyMachine[],
    projectSlug: string,
    version: number,
  ): FlyMachine | null {
    const v = String(version);
    return (
      machines.find(
        (m) =>
          m.metadata?.vivd_project_slug === projectSlug &&
          m.metadata?.vivd_project_version === v,
      ) || null
    );
  }

  private findMachineByName(machines: FlyMachine[], machineName: string): FlyMachine | null {
    return machines.find((machine) => machine.name === machineName) || null;
  }

  private getStudioKeyFromMachine(machine: FlyMachine): string | null {
    const projectSlug = machine.metadata?.vivd_project_slug;
    const version = parseIntOrNull(machine.metadata?.vivd_project_version);
    if (!projectSlug || !version) return null;
    return this.key(projectSlug, version);
  }

  private touchKey(studioKey: string): void {
    this.lastActivityByStudioKey.set(studioKey, Date.now());
  }

  private getMachineExternalPort(machine: FlyMachine): number | null {
    const fromMetadata = parseIntOrNull(machine.metadata?.vivd_external_port);
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

  private async startMachine(machineId: string): Promise<void> {
    await this.flyFetch(`/machines/${machineId}/start`, { method: "POST" });
  }

  private async stopMachine(machineId: string): Promise<void> {
    await this.flyFetch(`/machines/${machineId}/stop`, { method: "POST" });
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

    if (existing.state !== "started") {
      await this.startMachine(existing.id);
    }

    const url = this.getPublicUrlForPort(port);
    await this.waitForReady({
      machineId: existing.id,
      url,
      timeoutMs: this.startTimeoutMs,
    });

    const studioId =
      existing.metadata?.vivd_studio_id ||
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
      VIVD_TENANT_ID: getActiveTenantId(),
      VIVD_PROJECT_SLUG: args.projectSlug,
      VIVD_PROJECT_VERSION: String(args.version),
      VIVD_WORKSPACE_DIR: workspaceDir,
      VIVD_OPENCODE_DATA_HOME: opencodeDataHome,
      XDG_DATA_HOME: opencodeDataHome,
      // Fly machines are isolated; fixed internal ports are fine.
      DEV_SERVER_PORT_START: "5100",
      OPENCODE_PORT_START: "4096",
    };

    for (const [k, v] of Object.entries(args.env)) {
      if (typeof v === "string" && v.length > 0) {
        env[k] = v;
      }
    }

    // Optional passthrough for local-first testing (keeps config explicit).
    const passthrough = (process.env.FLY_STUDIO_ENV_PASSTHROUGH ||
      "GOOGLE_API_KEY,OPENROUTER_API_KEY,OPENCODE_MODEL,OPENCODE_MODELS,R2_ENDPOINT,R2_BUCKET,R2_ACCESS_KEY,R2_SECRET_KEY,VIVD_S3_BUCKET,VIVD_S3_ENDPOINT_URL,VIVD_S3_PREFIX,VIVD_S3_SOURCE_URI,VIVD_S3_OPENCODE_PREFIX,VIVD_S3_OPENCODE_URI,AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,AWS_SESSION_TOKEN,AWS_DEFAULT_REGION,AWS_REGION,DEVSERVER_INSTALL_TIMEOUT_MS,VIVD_PACKAGE_CACHE_DIR,DEVSERVER_NODE_MODULES_CACHE")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    for (const key of passthrough) {
      const value = process.env[key];
      if (value) env[key] = value;
    }

    return env;
  }

  async ensureRunning(args: StudioMachineStartArgs): Promise<StudioMachineStartResult> {
    const key = this.key(args.projectSlug, args.version);
    const existingInflight = this.inflight.get(key);
    if (existingInflight) return existingInflight;

    const promise = this.ensureRunningInner(args).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async ensureRunningInner(
    args: StudioMachineStartArgs,
  ): Promise<StudioMachineStartResult> {
    const studioKey = this.key(args.projectSlug, args.version);
    const machineName = this.machineNameFor(args.projectSlug, args.version);
    const machines = await this.listMachines();
    const existing =
      this.findMachine(machines, args.projectSlug, args.version) ||
      this.findMachineByName(machines, machineName);

    if (existing) {
      return this.ensureExistingMachineRunning(existing, args, studioKey);
    }

    const port = this.allocatePort(machines);
    const studioId = args.env.STUDIO_ID || crypto.randomUUID();

    const env = this.buildStudioEnv({ ...args, studioId });

    let create: FlyMachine;
    try {
      create = await this.flyFetch<FlyMachine>("/machines", {
        method: "POST",
        body: JSON.stringify({
          name: machineName || undefined,
          region: this.region,
          config: {
            image: this.image,
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
                autostart: true,
                min_machines_running: 0,
              },
            ],
          },
          metadata: {
            vivd_project_slug: args.projectSlug,
            vivd_project_version: String(args.version),
            vivd_external_port: String(port),
            vivd_studio_id: studioId,
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

  touch(projectSlug: string, version: number): void {
    this.touchKey(this.key(projectSlug, version));
  }

  async stop(projectSlug: string, version: number): Promise<void> {
    const studioKey = this.key(projectSlug, version);
    this.lastActivityByStudioKey.delete(studioKey);

    const machines = await this.listMachines();
    const existing =
      this.findMachine(machines, projectSlug, version) ||
      this.findMachineByName(machines, this.machineNameFor(projectSlug, version));
    if (!existing) return;
    await this.stopMachine(existing.id);
  }

  async getUrl(projectSlug: string, version: number): Promise<string | null> {
    try {
      const machines = await this.listMachines();
      const existing =
        this.findMachine(machines, projectSlug, version) ||
        this.findMachineByName(machines, this.machineNameFor(projectSlug, version));
      if (!existing) return null;
      if (existing.state !== "started") return null;
      const port = this.getMachineExternalPort(existing);
      if (!port) return null;
      this.touch(projectSlug, version);
      return this.getPublicUrlForPort(port);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[FlyMachines] getUrl failed for ${projectSlug}/v${version}: ${message}`,
      );
      return null;
    }
  }

  async isRunning(projectSlug: string, version: number): Promise<boolean> {
    try {
      const machines = await this.listMachines();
      const existing =
        this.findMachine(machines, projectSlug, version) ||
        this.findMachineByName(machines, this.machineNameFor(projectSlug, version));
      return !!existing && existing.state === "started";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[FlyMachines] isRunning failed for ${projectSlug}/v${version}: ${message}`,
      );
      return false;
    }
  }
}
