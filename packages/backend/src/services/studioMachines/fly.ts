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

export class FlyStudioMachineProvider implements StudioMachineProvider {
  kind = "fly" as const;

  private machinesCache: { machines: FlyMachine[]; fetchedAt: number } | null =
    null;
  private inflight = new Map<string, Promise<StudioMachineStartResult>>();
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Avoid log spam if Fly isn't configured yet.
    if (!process.env.FLY_API_TOKEN || !process.env.FLY_STUDIO_APP) return;

    // Best-effort background refresh so `getUrl()` / `isRunning()` can work
    // without making the provider interface async.
    this.refreshInterval = setInterval(() => {
      void this.refreshMachines();
    }, 5_000);
    // Don't keep the backend process alive just to refresh the Fly cache.
    this.refreshInterval.unref?.();
    void this.refreshMachines();
  }

  private key(projectSlug: string, version: number): string {
    return `${projectSlug}:${version}`;
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
      "GOOGLE_API_KEY,OPENROUTER_API_KEY,OPENCODE_MODEL,OPENCODE_MODELS,R2_ENDPOINT,R2_BUCKET,R2_ACCESS_KEY,R2_SECRET_KEY,VIVD_S3_BUCKET,VIVD_S3_ENDPOINT_URL,VIVD_S3_PREFIX,VIVD_S3_SOURCE_URI,VIVD_S3_OPENCODE_PREFIX,VIVD_S3_OPENCODE_URI,AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,AWS_SESSION_TOKEN,AWS_DEFAULT_REGION,AWS_REGION")
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
    const machines = await this.listMachines();
    const existing = this.findMachine(machines, args.projectSlug, args.version);

    if (existing) {
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

      return { studioId, url, port };
    }

    const port = this.allocatePort(machines);
    const studioId = args.env.STUDIO_ID || crypto.randomUUID();

    const env = this.buildStudioEnv({ ...args, studioId });

    const machineNameBase = sanitizeForFlyAppId(`studio-${args.projectSlug}-v${args.version}`);
    const machineName =
      machineNameBase.length > 45 ? machineNameBase.slice(0, 45) : machineNameBase;

    const create = await this.flyFetch<FlyMachine>("/machines", {
      method: "POST",
      body: JSON.stringify({
        name: machineName || undefined,
        region: this.region,
        config: {
          image: this.image,
          guest: {
            cpu_kind: "shared",
            cpus: 1,
            memory_mb: 1024,
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

    const url = this.getPublicUrlForPort(port);
    await this.waitForReady({
      machineId: create.id,
      url,
      timeoutMs: this.startTimeoutMs,
    });

    return { studioId, url, port };
  }

  async stop(projectSlug: string, version: number): Promise<void> {
    const machines = await this.listMachines();
    const existing = this.findMachine(machines, projectSlug, version);
    if (!existing) return;
    await this.stopMachine(existing.id);
  }

  getUrl(projectSlug: string, version: number): string | null {
    const cached = this.machinesCache?.machines;
    if (!cached) {
      void this.refreshMachines();
      return null;
    }
    if (cached) {
      const existing = this.findMachine(cached, projectSlug, version);
      if (!existing) return null;
      const port = this.getMachineExternalPort(existing);
      return port ? this.getPublicUrlForPort(port) : null;
    }
    return null;
  }

  isRunning(projectSlug: string, version: number): boolean {
    const cached = this.machinesCache?.machines;
    if (!cached) {
      void this.refreshMachines();
      return false;
    }
    if (!cached) return false;
    const existing = this.findMachine(cached, projectSlug, version);
    return !!existing && existing.state === "started";
  }
}
