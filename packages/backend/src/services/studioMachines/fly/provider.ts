import crypto from "node:crypto";
import type {
  StudioMachineProvider,
  StudioMachineRestartArgs,
  StudioMachineStartArgs,
  StudioMachineStartResult,
} from "../types";
import { normalizeGhcrRepository, resolveLatestSemverImageFromGhcr } from "./ghcr";
import type {
  FlyApiError,
  FlyMachine,
  FlyMachineConfig,
  FlyMachinePort,
  FlyMachineService,
  FlyMachineState,
  FlyStudioMachineReconcileResult,
  FlyStudioMachineSummary,
} from "./types";
import {
  isRecordOfStrings,
  parseBooleanEnv,
  parseIntOrNull,
  parseNonNegativeInt,
  parsePositiveInt,
  sanitizeForFlyAppId,
  sleep,
} from "./utils";

const STUDIO_ACCESS_TOKEN_ENV_KEY = "STUDIO_ACCESS_TOKEN";
const STUDIO_ACCESS_TOKEN_METADATA_KEY = "vivd_studio_access_token";

type MachineReconcileNeeds = {
  image: boolean;
  services: boolean;
  guest: boolean;
  accessToken: boolean;
};

async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const concurrency = Math.max(1, Math.floor(limit));
  let index = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = index++;
        if (i >= items.length) return;
        await worker(items[i]!);
      }
    },
  );

  await Promise.all(runners);
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
  private reconcilerInterval: NodeJS.Timeout | null = null;
  private reconcileInFlight: Promise<FlyStudioMachineReconcileResult> | null = null;
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

  startReconciler(): void {
    // Avoid log spam if Fly isn't configured yet.
    if (!process.env.FLY_API_TOKEN || !process.env.FLY_STUDIO_APP) return;
    if (!this.reconcilerEnabled) return;
    if (this.reconcilerInterval) return;

    const intervalMs = this.reconcilerIntervalMs;
    if (intervalMs <= 0) return;

    this.reconcilerInterval = setInterval(() => {
      void this.reconcileStudioMachines().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[FlyMachines] Reconciler failed: ${message}`);
      });
    }, intervalMs);
    this.reconcilerInterval.unref?.();

    void this.reconcileStudioMachines().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[FlyMachines] Reconciler failed: ${message}`);
    });
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

  private generateStudioAccessToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  private getStudioAccessTokenFromMachine(machine: FlyMachine): string | null {
    const metadataToken = this.getMachineMetadataValue(
      machine,
      STUDIO_ACCESS_TOKEN_METADATA_KEY,
    );
    if (typeof metadataToken === "string" && metadataToken.trim()) {
      return metadataToken.trim();
    }

    const envToken = machine.config?.env?.[STUDIO_ACCESS_TOKEN_ENV_KEY];
    if (typeof envToken === "string" && envToken.trim()) {
      return envToken.trim();
    }

    return null;
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
    return resolveLatestSemverImageFromGhcr({
      repository: this.studioImageRepository,
      timeoutMs: 10_000,
    });
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
    return process.env.FLY_STUDIO_REGION || process.env.FLY_REGION || "fra";
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

  private get reconcilerEnabled(): boolean {
    return parseBooleanEnv(process.env.FLY_STUDIO_RECONCILER_ENABLED, true);
  }

  private get reconcilerIntervalMs(): number {
    return parseNonNegativeInt(process.env.FLY_STUDIO_RECONCILER_INTERVAL_MS, 600_000);
  }

  private get reconcilerDryRun(): boolean {
    return parseBooleanEnv(process.env.FLY_STUDIO_RECONCILER_DRY_RUN, false);
  }

  private get warmOutdatedImages(): boolean {
    return parseBooleanEnv(process.env.FLY_STUDIO_RECONCILER_WARM_OUTDATED_IMAGES, true);
  }

  private get reconcilerConcurrency(): number {
    return parsePositiveInt(process.env.FLY_STUDIO_RECONCILER_CONCURRENCY, 100);
  }

  private get maxMachineAgeDays(): number {
    return parsePositiveInt(process.env.FLY_STUDIO_RECONCILER_MAX_MACHINE_AGE_DAYS, 7);
  }

  private get maxMachineAgeMs(): number {
    return this.maxMachineAgeDays * 24 * 60 * 60 * 1000;
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
    // Fly performance machines should have at least 2 GiB per CPU.
    return this.cpuCount * 2048;
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

  private get desiredGuest(): {
    cpu_kind: "shared" | "performance";
    cpus: number;
    memory_mb: number;
  } {
    return {
      cpu_kind: this.cpuKind,
      cpus: this.cpuCount,
      memory_mb: this.memoryMb,
    };
  }

  private needsGuestUpdate(guest: FlyMachineConfig["guest"] | undefined): boolean {
    if (!guest) return true;
    const desiredGuest = this.desiredGuest;
    return (
      guest.cpu_kind !== desiredGuest.cpu_kind ||
      guest.cpus !== desiredGuest.cpus ||
      guest.memory_mb !== desiredGuest.memory_mb
    );
  }

  private trimToken(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private getMachineMetadataValue(machine: FlyMachine, key: string): string | null {
    const read = (record: unknown): string | null => {
      if (!record || typeof record !== "object") return null;
      const value = (record as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (typeof value === "boolean") return value ? "true" : "false";
      return null;
    };

    return read(machine.config?.metadata) || read(machine.metadata);
  }

  private getConfiguredStudioImage(machine: FlyMachine, desiredImage?: string): string | null {
    const metadataImage = this.trimToken(this.getMachineMetadataValue(machine, "vivd_image"));
    if (metadataImage) return metadataImage;

    const configImage = this.trimToken(
      typeof machine.config?.image === "string" ? machine.config.image : null,
    );
    if (!configImage) return null;

    // Fly may return tag+digest refs (e.g. "...:v1.2.3@sha256:..."). The digest doesn't
    // represent drift for our purposes when we're pinning by tag.
    const digestIndex = !desiredImage?.includes("@") ? configImage.indexOf("@") : -1;
    if (digestIndex !== -1) {
      return this.trimToken(configImage.slice(0, digestIndex));
    }

    return configImage;
  }

  private resolveMachineReconcileState(options: {
    machine: FlyMachine;
    desiredImage: string;
    preferredAccessToken?: string | null;
  }): { accessToken: string; needs: MachineReconcileNeeds } {
    const metadataToken = this.trimToken(
      this.getMachineMetadataValue(options.machine, STUDIO_ACCESS_TOKEN_METADATA_KEY),
    );
    const envToken = this.trimToken(
      options.machine.config?.env?.[STUDIO_ACCESS_TOKEN_ENV_KEY],
    );
    const preferredToken = this.trimToken(options.preferredAccessToken);

    const configuredImage = this.getConfiguredStudioImage(options.machine, options.desiredImage);
    const needsImageUpdate = configuredImage !== options.desiredImage;

    const needsServiceUpdate =
      options.machine.config?.services?.some((service) => {
        const needsAutostart = service.autostart !== false;
        const needsAutostop = service.autostop !== "suspend";
        return needsAutostart || needsAutostop;
      }) ?? true;

    const needs: MachineReconcileNeeds = {
      image: needsImageUpdate,
      services: needsServiceUpdate,
      guest: this.needsGuestUpdate(options.machine.config?.guest),
      accessToken:
        !metadataToken ||
        !envToken ||
        metadataToken !== envToken,
    };

    return {
      accessToken:
        metadataToken ||
        envToken ||
        preferredToken ||
        this.generateStudioAccessToken(),
      needs,
    };
  }

  private hasMachineDrift(needs: MachineReconcileNeeds): boolean {
    return (
      needs.image ||
      needs.services ||
      needs.guest ||
      needs.accessToken
    );
  }

  private getMachineDriftLabels(needs: MachineReconcileNeeds): string[] {
    const labels: string[] = [];
    if (needs.image) labels.push("image");
    if (needs.services) labels.push("services");
    if (needs.guest) labels.push("guest");
    if (needs.accessToken) labels.push("accessToken");
    return labels;
  }

  private shouldStopSuspendedBeforeReconcile(
    state: string | undefined,
    needs: MachineReconcileNeeds,
  ): boolean {
    return state === "suspended" && (needs.image || needs.guest);
  }

  private resolveStudioIdFromMachine(machine: FlyMachine, fallback?: string | null): string {
    return (
      this.getMachineMetadata(machine)?.vivd_studio_id ||
      machine.config?.env?.STUDIO_ID ||
      this.trimToken(fallback) ||
      crypto.randomUUID()
    );
  }

  private withAccessTokenEnv(
    env: Record<string, string> | undefined,
    accessToken: string,
  ): Record<string, string> {
    return {
      ...(env || {}),
      [STUDIO_ACCESS_TOKEN_ENV_KEY]: accessToken,
    };
  }

  private buildReconciledMetadata(options: {
    machine: FlyMachine;
    organizationId: string;
    projectSlug: string;
    version: number;
    port: number;
    studioId: string;
    desiredImage: string;
    accessToken: string;
    extra?: Record<string, string>;
  }): Record<string, string> {
    return {
      ...(this.getMachineMetadata(options.machine) || {}),
      vivd_organization_id: options.organizationId,
      vivd_project_slug: options.projectSlug,
      vivd_project_version: String(options.version),
      vivd_external_port: String(options.port),
      vivd_studio_id: options.studioId,
      vivd_image: options.desiredImage,
      [STUDIO_ACCESS_TOKEN_METADATA_KEY]: options.accessToken,
      ...(options.extra || {}),
    };
  }

  private buildReconciledMachineConfig(options: {
    machine: FlyMachine;
    port: number;
    desiredImage: string;
    accessToken: string;
    needs: MachineReconcileNeeds;
    metadata: Record<string, string>;
    fullEnv?: Record<string, string>;
  }): FlyMachineConfig {
    return {
      ...(options.machine.config || {}),
      ...(options.needs.image ? { image: options.desiredImage } : {}),
      ...(options.needs.services
        ? {
            services: this.normalizeServicesForVivd(
              options.machine.config?.services,
              options.port,
            ),
          }
        : {}),
      ...(options.needs.guest ? { guest: this.desiredGuest } : {}),
      ...(options.needs.accessToken
        ? {
            env:
              options.fullEnv ||
              this.withAccessTokenEnv(
                options.machine.config?.env,
                options.accessToken,
              ),
          }
        : {}),
      metadata: options.metadata,
    };
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

  private getStudioIdentityFromMachine(machine: FlyMachine): {
    organizationId: string;
    projectSlug: string;
    version: number;
  } | null {
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
    return { organizationId, projectSlug, version };
  }

  private getMachineCreatedAtMs(machine: FlyMachine): number | null {
    const raw = machine.created_at || this.getMachineMetadata(machine)?.vivd_created_at;
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
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

  private async destroyMachine(machineId: string): Promise<void> {
    await this.flyFetch<void>(`/machines/${machineId}`, { method: "DELETE" });
    this.machinesCache = null;
  }

  private async suspendMachine(machineId: string): Promise<void> {
    await this.flyFetch(`/machines/${machineId}/suspend`, { method: "POST" });
  }

  private async suspendOrStopMachine(machineId: string): Promise<"suspended" | "stopped"> {
    const initial = await this.getMachine(machineId);
    const initialState = initial.state || "unknown";
    if (initialState === "suspended") return "suspended";
    if (initialState === "stopped") return "stopped";
    if (initialState === "destroyed" || initialState === "destroying") {
      throw new Error(`[FlyMachines] Machine ${machineId} was destroyed`);
    }

    const attempts = 3;
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.suspendMachine(machineId);
        await this.waitForState({
          machineId,
          state: "suspended",
          timeoutMs: 30_000,
        });
        return "suspended";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = message;

        if (message.includes("was destroyed")) throw err;
        if (attempt < attempts) {
          await sleep(Math.min(5000, 750 * attempt));
          continue;
        }
      }
    }

    console.warn(
      `[FlyMachines] Failed to suspend machine ${machineId}: ${lastError || "unknown error"}; falling back to stop.`,
    );
    try {
      await this.stopMachine(machineId);
      await this.waitForState({
        machineId,
        state: "stopped",
        timeoutMs: 60_000,
      });
    } catch {
      // best-effort
    }
    return "stopped";
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

  private async waitForReconcileDriftToClear(options: {
    machineId: string;
    desiredImage: string;
    timeoutMs: number;
  }): Promise<MachineReconcileNeeds | null> {
    const startedAt = Date.now();
    let lastNeeds: MachineReconcileNeeds | null = null;

    while (Date.now() - startedAt < options.timeoutMs) {
      const machine = await this.getMachine(options.machineId);
      const state = machine.state || "unknown";
      if (state === "destroyed" || state === "destroying") {
        throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
      }

      const reconcileState = this.resolveMachineReconcileState({
        machine,
        desiredImage: options.desiredImage,
      });
      lastNeeds = reconcileState.needs;

      if (!this.hasMachineDrift(lastNeeds)) return null;
      await sleep(500);
    }

    return lastNeeds;
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
    const preferredAccessToken = this.trimToken(
      args.env[STUDIO_ACCESS_TOKEN_ENV_KEY],
    );
    let reconcileState = this.resolveMachineReconcileState({
      machine: existing,
      desiredImage,
      preferredAccessToken,
    });
    let accessToken = reconcileState.accessToken;

    if (existing.state === "started" && reconcileState.needs.accessToken) {
      // Access token must be present in the machine env for @vivd/studio to enforce auth.
      // Stop the machine so we can update config and boot with the token.
      await this.stopMachine(existing.id);
      await this.waitForState({
        machineId: existing.id,
        state: "stopped",
        timeoutMs: 60_000,
      });
      existing = await this.getMachine(existing.id);
      reconcileState = this.resolveMachineReconcileState({
        machine: existing,
        desiredImage,
        preferredAccessToken,
      });
      accessToken = reconcileState.accessToken;
    }

    // Only reconcile machine config when it's not running, to avoid disrupting an
    // active studio session. This also ensures the next boot uses the latest image.
    if (
      existing.state !== "started" &&
      this.hasMachineDrift(reconcileState.needs)
    ) {
      // A suspended machine would resume a snapshot; stop it first to boot fresh.
      if (this.shouldStopSuspendedBeforeReconcile(existing.state, reconcileState.needs)) {
        await this.stopMachine(existing.id);
        await this.waitForState({
          machineId: existing.id,
          state: "stopped",
          timeoutMs: 60_000,
        });
      }

      const current = await this.getMachine(existing.id);
      reconcileState = this.resolveMachineReconcileState({
        machine: current,
        desiredImage,
        preferredAccessToken,
      });
      accessToken = reconcileState.accessToken;

      if (this.hasMachineDrift(reconcileState.needs)) {
        const studioId = this.resolveStudioIdFromMachine(current, args.env.STUDIO_ID);
        const env = this.buildStudioEnv({ ...args, studioId, accessToken });
        const metadata = this.buildReconciledMetadata({
          machine: current,
          organizationId: args.organizationId,
          projectSlug: args.projectSlug,
          version: args.version,
          port,
          studioId,
          desiredImage,
          accessToken,
        });
        const config = this.buildReconciledMachineConfig({
          machine: current,
          port,
          desiredImage,
          accessToken,
          needs: reconcileState.needs,
          metadata,
          fullEnv: env,
        });

        await this.updateMachineConfig({
          machineId: existing.id,
          config,
          skipLaunch: true,
        });

        existing = await this.getMachine(existing.id);
      }
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

    const studioId = this.resolveStudioIdFromMachine(existing, args.env.STUDIO_ID);

    this.touchKey(studioKey);
    return { studioId, url, port, accessToken };
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

  private buildStudioEnv(
    args: StudioMachineStartArgs & { studioId: string; accessToken: string },
  ): Record<string, string> {
    const workspaceDir =
      process.env.FLY_STUDIO_WORKSPACE_DIR || "/home/studio/project";
    const opencodeDataHome =
      process.env.FLY_STUDIO_OPENCODE_DATA_HOME ||
      "/home/studio/opencode-data";

    const env: Record<string, string> = {
      PORT: "3100",
      STUDIO_ID: args.studioId,
      [STUDIO_ACCESS_TOKEN_ENV_KEY]: args.accessToken,
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
      "GOOGLE_API_KEY,OPENROUTER_API_KEY,GOOGLE_CLOUD_PROJECT,VERTEX_LOCATION,GOOGLE_APPLICATION_CREDENTIALS,GOOGLE_APPLICATION_CREDENTIALS_JSON,VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH,OPENCODE_MODEL,OPENCODE_MODELS,R2_ENDPOINT,R2_BUCKET,R2_ACCESS_KEY,R2_SECRET_KEY,VIVD_S3_BUCKET,VIVD_S3_ENDPOINT_URL,VIVD_S3_PREFIX,VIVD_S3_SOURCE_URI,VIVD_S3_OPENCODE_PREFIX,VIVD_S3_OPENCODE_URI,AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,AWS_SESSION_TOKEN,AWS_DEFAULT_REGION,AWS_REGION,DEVSERVER_INSTALL_TIMEOUT_MS,VIVD_PACKAGE_CACHE_DIR,DEVSERVER_NODE_MODULES_CACHE,GITHUB_SYNC_ENABLED,GITHUB_SYNC_STRICT,GITHUB_ORG,GITHUB_TOKEN,GITHUB_REPO_PREFIX,GITHUB_REPO_VISIBILITY,GITHUB_API_URL,GITHUB_GIT_HOST,GITHUB_REMOTE_NAME")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    for (const key of passthrough) {
      if (explicitEnvKeys.has(key)) continue;
      const value = process.env[key];
      if (value) env[key] = value;
    }

    if (env.GOOGLE_CLOUD_PROJECT && !env.VERTEX_LOCATION) {
      env.VERTEX_LOCATION = "global";
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

    const accessToken =
      this.getStudioAccessTokenFromMachine(current) ||
      (typeof args.env[STUDIO_ACCESS_TOKEN_ENV_KEY] === "string"
        ? args.env[STUDIO_ACCESS_TOKEN_ENV_KEY]?.trim()
        : null) ||
      this.generateStudioAccessToken();

    const env = this.buildStudioEnv({ ...args, studioId, accessToken });

    const metadata: Record<string, string> = {
      ...(this.getMachineMetadata(current) || {}),
      vivd_organization_id: args.organizationId,
      vivd_project_slug: args.projectSlug,
      vivd_project_version: String(args.version),
      vivd_external_port: String(port),
      vivd_studio_id: studioId,
      vivd_image: desiredImage,
      [STUDIO_ACCESS_TOKEN_METADATA_KEY]: accessToken,
    };

    const config: FlyMachineConfig = {
      ...(current.config || {}),
      image: desiredImage,
      guest: this.desiredGuest,
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
    return { studioId, url, port, accessToken };
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

    const accessToken =
      (typeof args.env[STUDIO_ACCESS_TOKEN_ENV_KEY] === "string"
        ? args.env[STUDIO_ACCESS_TOKEN_ENV_KEY]?.trim()
        : null) || this.generateStudioAccessToken();

    const env = this.buildStudioEnv({ ...args, studioId, accessToken });

    let create: FlyMachine;
    try {
      create = await this.flyFetch<FlyMachine>("/machines", {
        method: "POST",
        body: JSON.stringify({
          name: machineName || undefined,
          region: this.region,
          config: {
            image: desiredImage,
            guest: this.desiredGuest,
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
              [STUDIO_ACCESS_TOKEN_METADATA_KEY]: accessToken,
              vivd_created_at: new Date().toISOString(),
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
    return { studioId, url, port, accessToken };
  }

  async listStudioMachines(): Promise<FlyStudioMachineSummary[]> {
    const desiredImage = await this.getDesiredImage();
    const machines = await this.listMachines();

    const summaries: FlyStudioMachineSummary[] = [];
    for (const machine of machines) {
      const identity = this.getStudioIdentityFromMachine(machine);
      if (!identity) continue;

      const port = this.getMachineExternalPort(machine);
      const image = this.getConfiguredStudioImage(machine, desiredImage);
      const guest = machine.config?.guest;
      const cpuKind = typeof guest?.cpu_kind === "string" ? guest.cpu_kind : null;
      const cpus =
        typeof guest?.cpus === "number" && Number.isFinite(guest.cpus)
          ? guest.cpus
          : null;
      const memoryMb =
        typeof guest?.memory_mb === "number" && Number.isFinite(guest.memory_mb)
          ? guest.memory_mb
          : null;
      const createdAt =
        machine.created_at ||
        this.getMachineMetadata(machine)?.vivd_created_at ||
        null;
      const updatedAt = machine.updated_at || null;

      summaries.push({
        id: machine.id,
        name: machine.name || null,
        state: (machine.state || null) as string | null,
        region: machine.region || null,
        cpuKind,
        cpus,
        memoryMb,
        organizationId: identity.organizationId,
        projectSlug: identity.projectSlug,
        version: identity.version,
        externalPort: port,
        url: port ? this.getPublicUrlForPort(port) : null,
        image,
        desiredImage,
        imageOutdated: !!image && image !== desiredImage,
        createdAt,
        updatedAt,
      });
    }

    summaries.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return summaries;
  }

  async destroyStudioMachine(machineId: string): Promise<void> {
    const machine = await this.getMachine(machineId);
    const identity = this.getStudioIdentityFromMachine(machine);
    if (!identity) {
      throw new Error(
        `[FlyMachines] Refusing to destroy non-studio machine ${machineId}`,
      );
    }

    const state = machine.state || "unknown";
    if (
      state !== "stopped" &&
      state !== "destroyed" &&
      state !== "destroying"
    ) {
      await this.stopMachine(machineId);
      await this.waitForState({
        machineId,
        state: "stopped",
        timeoutMs: 60_000,
      });
    }

    if (state !== "destroyed" && state !== "destroying") {
      await this.destroyMachine(machineId);
    }

    const studioKey = this.key(
      identity.organizationId,
      identity.projectSlug,
      identity.version,
    );
    this.lastActivityByStudioKey.delete(studioKey);
  }

  async warmReconcileStudioMachine(machineId: string): Promise<{ desiredImage: string }> {
    const desiredImage = await this.getDesiredImage();

    const machine = await this.getMachine(machineId);
    const identity = this.getStudioIdentityFromMachine(machine);
    if (!identity) {
      throw new Error(
        `[FlyMachines] Refusing to warm reconcile non-studio machine ${machineId}`,
      );
    }

    const state = machine.state || "unknown";
    if (state === "destroyed" || state === "destroying") {
      return { desiredImage };
    }

    const reconcileState = this.resolveMachineReconcileState({
      machine,
      desiredImage,
    });
    if (!this.hasMachineDrift(reconcileState.needs)) {
      return { desiredImage };
    }

    if (state === "started" || state === "starting") {
      throw new Error(
        `[FlyMachines] Refusing to warm reconcile running machine ${machineId} (state=${state})`,
      );
    }

    let current = machine;
    let currentState = state;
    let currentReconcileState = reconcileState;

    // Suspended machines would resume a snapshot; stop first to boot the new image.
    if (this.shouldStopSuspendedBeforeReconcile(currentState, currentReconcileState.needs)) {
      await this.stopMachine(machineId);
      await this.waitForState({
        machineId,
        state: "stopped",
        timeoutMs: 60_000,
      });
      current = await this.getMachine(machineId);
      currentState = current.state || "unknown";
      currentReconcileState = this.resolveMachineReconcileState({
        machine: current,
        desiredImage,
      });
    }

    if (!this.hasMachineDrift(currentReconcileState.needs)) {
      return { desiredImage };
    }

    if (currentState !== "stopped") {
      throw new Error(
        `[FlyMachines] Cannot warm reconcile machine ${machineId}; expected state=stopped but got state=${currentState}`,
      );
    }

    const port = this.getMachineExternalPort(current);
    if (!port) {
      throw new Error("Missing external port; cannot warm image");
    }

    const studioId = this.resolveStudioIdFromMachine(current);
    const accessToken = currentReconcileState.accessToken;
    const reconciledAt = new Date().toISOString();
    const metadata = this.buildReconciledMetadata({
      machine: current,
      organizationId: identity.organizationId,
      projectSlug: identity.projectSlug,
      version: identity.version,
      port,
      studioId,
      desiredImage,
      accessToken,
      extra: {
        vivd_last_machine_reconcile_at: reconciledAt,
        ...(currentReconcileState.needs.image ? { vivd_last_image_reconcile_at: reconciledAt } : {}),
      },
    });

    const config = this.buildReconciledMachineConfig({
      machine: current,
      port,
      desiredImage,
      accessToken,
      needs: currentReconcileState.needs,
      metadata,
    });

    await this.updateMachineConfig({
      machineId,
      config,
      skipLaunch: true,
    });

    const remainingDrift = await this.waitForReconcileDriftToClear({
      machineId,
      desiredImage,
      timeoutMs: 10_000,
    });
    if (remainingDrift) {
      const driftLabels = this.getMachineDriftLabels(remainingDrift).join(",");
      const refreshed = await this.getMachine(machineId);
      const configImage =
        typeof refreshed.config?.image === "string" ? refreshed.config.image : null;
      const metadataImage = this.trimToken(this.getMachineMetadataValue(refreshed, "vivd_image"));
      console.warn(
        `[FlyMachines] Warm reconcile drift did not clear for ${machineId} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) after config update (drift=${driftLabels}) desiredImage=${desiredImage} configImage=${configImage} vivd_image=${metadataImage}`,
      );
    }

    await this.startMachineHandlingReplacement(machineId);
    const url = this.getPublicUrlForPort(port);
    await this.waitForReady({
      machineId,
      url,
      timeoutMs: Math.min(this.startTimeoutMs, 120_000),
    });

    const parked = await this.suspendOrStopMachine(machineId);
    if (parked !== "suspended") {
      throw new Error(
        `[FlyMachines] Warm reconcile parked machine ${machineId} in state=${parked}; expected suspended`,
      );
    }

    return { desiredImage };
  }

  async reconcileStudioMachines(): Promise<FlyStudioMachineReconcileResult> {
    const existing = this.reconcileInFlight;
    if (existing) return existing;

    const promise = this.reconcileStudioMachinesInner().finally(() => {
      if (this.reconcileInFlight === promise) this.reconcileInFlight = null;
    });
    this.reconcileInFlight = promise;
    return promise;
  }

  private async reconcileStudioMachinesInner(): Promise<FlyStudioMachineReconcileResult> {
    const desiredImage = await this.getDesiredImage();
    const machines = await this.listMachines();
    const now = Date.now();
    const maxAgeMs = this.maxMachineAgeMs;
    const dryRun = this.reconcilerDryRun;

    const result: FlyStudioMachineReconcileResult = {
      desiredImage,
      scanned: 0,
      warmedOutdatedImages: 0,
      destroyedOldMachines: 0,
      skippedRunningMachines: 0,
      dryRun,
      errors: [],
    };

    const studioMachines = machines.flatMap((machine) => {
      const identity = this.getStudioIdentityFromMachine(machine);
      return identity ? [{ machine, identity }] : [];
    });
    result.scanned = studioMachines.length;

    await mapLimit(studioMachines, this.reconcilerConcurrency, async ({ machine, identity }) => {
      const createdAtMs = this.getMachineCreatedAtMs(machine);
      const ageMs = createdAtMs ? now - createdAtMs : null;
      const isOld = ageMs !== null && ageMs >= maxAgeMs;

      // Prefer GC over image warmups for very old machines.
      if (isOld) {
        const state = machine.state || "unknown";
        if (state === "destroyed" || state === "destroying") return;

        if (dryRun) {
          console.log(
            `[FlyMachines] (dry-run) GC old machine ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) state=${state} ageDays=${ageMs ? Math.floor(ageMs / (24 * 60 * 60 * 1000)) : "?"}`,
          );
          return;
        }

        try {
          const current = await this.getMachine(machine.id);
          const currentState = current.state || "unknown";

          if (
            currentState !== "stopped" &&
            currentState !== "destroyed" &&
            currentState !== "destroying"
          ) {
            await this.stopMachine(machine.id);
            await this.waitForState({
              machineId: machine.id,
              state: "stopped",
              timeoutMs: 60_000,
            });
          }

          await this.destroyMachine(machine.id);
          result.destroyedOldMachines++;
          console.log(
            `[FlyMachines] Destroyed old machine ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version})`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push({
            machineId: machine.id,
            action: "gc",
            message,
          });
          console.warn(
            `[FlyMachines] GC failed for machine ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}): ${message}`,
          );
        }

        return;
      }

      const reconcileState = this.resolveMachineReconcileState({
        machine,
        desiredImage,
      });
      if (!this.hasMachineDrift(reconcileState.needs)) return;
      const driftLabels = this.getMachineDriftLabels(reconcileState.needs);

      const state = machine.state || "unknown";
      if (state === "started" || state === "starting") {
        result.skippedRunningMachines++;
        return;
      }

      if (!this.warmOutdatedImages) return;

      if (dryRun) {
        console.log(
          `[FlyMachines] (dry-run) Warm reconciled machine ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) state=${state} drift=${driftLabels.join(",")}`,
        );
        return;
      }

      try {
        let current = await this.getMachine(machine.id);
        let currentState = current.state || "unknown";
        let currentReconcileState = this.resolveMachineReconcileState({
          machine: current,
          desiredImage,
        });

        if (currentState === "destroyed" || currentState === "destroying") return;

        // Suspended machines would resume a snapshot; stop first to boot the new image.
        if (this.shouldStopSuspendedBeforeReconcile(currentState, currentReconcileState.needs)) {
          await this.stopMachine(machine.id);
          await this.waitForState({
            machineId: machine.id,
            state: "stopped",
            timeoutMs: 60_000,
          });
          current = await this.getMachine(machine.id);
          currentState = current.state || "unknown";
          currentReconcileState = this.resolveMachineReconcileState({
            machine: current,
            desiredImage,
          });
        }

        if (!this.hasMachineDrift(currentReconcileState.needs)) return;
        if (current.state !== "stopped") {
          // Unexpected state (e.g. replacing). Skip and retry next cycle.
          return;
        }

        const port = this.getMachineExternalPort(current);
        if (!port) {
          throw new Error("Missing external port; cannot warm image");
        }

        const studioId = this.resolveStudioIdFromMachine(current);
        const accessToken = currentReconcileState.accessToken;
        const reconciledAt = new Date().toISOString();
        const metadata = this.buildReconciledMetadata({
          machine: current,
          organizationId: identity.organizationId,
          projectSlug: identity.projectSlug,
          version: identity.version,
          port,
          studioId,
          desiredImage,
          accessToken,
          extra: {
            vivd_last_machine_reconcile_at: reconciledAt,
            ...(currentReconcileState.needs.image
              ? { vivd_last_image_reconcile_at: reconciledAt }
              : {}),
          },
        });

        const config = this.buildReconciledMachineConfig({
          machine: current,
          port,
          desiredImage,
          accessToken,
          needs: currentReconcileState.needs,
          metadata,
        });

        await this.updateMachineConfig({
          machineId: machine.id,
          config,
          skipLaunch: true,
        });

        const remainingDrift = await this.waitForReconcileDriftToClear({
          machineId: machine.id,
          desiredImage,
          timeoutMs: 10_000,
        });
        if (remainingDrift) {
          const remainingDriftLabels = this.getMachineDriftLabels(remainingDrift).join(",");
          const refreshed = await this.getMachine(machine.id);
          const configImage =
            typeof refreshed.config?.image === "string" ? refreshed.config.image : null;
          const metadataImage = this.trimToken(
            this.getMachineMetadataValue(refreshed, "vivd_image"),
          );
          console.warn(
            `[FlyMachines] Warm reconcile drift did not clear for ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) after config update (drift=${remainingDriftLabels}) desiredImage=${desiredImage} configImage=${configImage} vivd_image=${metadataImage}`,
          );
        }

        await this.startMachineHandlingReplacement(machine.id);
        const url = this.getPublicUrlForPort(port);
        await this.waitForReady({
          machineId: machine.id,
          url,
          timeoutMs: Math.min(this.startTimeoutMs, 120_000),
        });

        // Park the machine quickly so the next user start is fast, without leaving it running.
        const parked = await this.suspendOrStopMachine(machine.id);
        if (parked !== "suspended") {
          throw new Error(
            `[FlyMachines] Warm reconcile parked machine ${machine.id} in state=${parked}; expected suspended`,
          );
        }

        result.warmedOutdatedImages++;
        console.log(
          `[FlyMachines] Warmed reconciled machine ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) drift=${driftLabels.join(",")}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({
          machineId: machine.id,
          action: "warm_reconciled_machine",
          message,
        });
        console.warn(
          `[FlyMachines] Warm reconciled machine failed for ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}): ${message}`,
        );
      }
    });

    return result;
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
  ): Promise<{ url: string; accessToken?: string } | null> {
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
      const url = this.getPublicUrlForPort(port);
      const accessToken = this.getStudioAccessTokenFromMachine(existing);
      if (!accessToken) return null;
      return { url, accessToken };
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
