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
  getSystemSettingValue,
  SYSTEM_SETTING_KEYS,
} from "../../SystemSettingsService";
import type { MachineReconcileNeeds } from "./machineModel";
import {
  buildReconciledMachineConfig,
  buildReconciledMetadata,
  getConfiguredStudioImage,
  getMachineDriftLabels,
  getMachineMetadata,
  getMachineMetadataValue,
  getStudioAccessTokenFromMachine,
  hasMachineDrift,
  needsGuestUpdate,
  resolveMachineReconcileState,
  resolveStudioIdFromMachine,
  shouldStopSuspendedBeforeReconcile,
  trimToken,
  withAccessTokenEnv,
} from "./machineModel";
import {
  allocatePortWorkflow,
  buildStudioEnvWorkflow,
  ensureExistingMachineRunningWorkflow,
  ensureRunningInnerWorkflow,
  recoverCreateNameConflictWorkflow,
  restartInnerWorkflow,
} from "./runtimeWorkflow";
import {
  reconcileStudioMachinesInnerWorkflow,
  warmReconcileStudioMachineWorkflow,
} from "./reconcileWorkflow";
import {
  parseBooleanEnv,
  parseIntOrNull,
  parseNonNegativeInt,
  parsePositiveInt,
  sanitizeForFlyAppId,
  sleep,
} from "./utils";

const STUDIO_IMAGE_TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

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
    return getStudioAccessTokenFromMachine(machine);
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

  async getDesiredImage(): Promise<string> {
    const configured = process.env.FLY_STUDIO_IMAGE?.trim();
    if (configured) return configured;

    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl) {
      try {
        const storedTagRaw = await getSystemSettingValue(
          SYSTEM_SETTING_KEYS.studioMachineImageTagOverride,
        );
        const storedTag = storedTagRaw?.trim() || "";
        if (storedTag && STUDIO_IMAGE_TAG_PATTERN.test(storedTag)) {
          let imageBase = "ghcr.io/vivd-studio/vivd-studio";
          try {
            imageBase = normalizeGhcrRepository(this.studioImageRepository).imageBase;
          } catch {
            // Ignore invalid repo; keep hardcoded fallback base.
          }
          return `${imageBase}:${storedTag}`;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[FlyMachines] Failed to load studio image override tag: ${message}`);
      }
    }

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
    return parseNonNegativeInt(process.env.FLY_STUDIO_IDLE_TIMEOUT_MS, 600_000);
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

  private get desiredKillTimeoutSeconds(): number {
    return parsePositiveInt(process.env.FLY_STUDIO_KILL_TIMEOUT_SECONDS, 180);
  }

  private needsGuestUpdate(guest: FlyMachineConfig["guest"] | undefined): boolean {
    return needsGuestUpdate(guest, this.desiredGuest);
  }

  private trimToken(value: string | null | undefined): string | null {
    return trimToken(value);
  }

  private getMachineMetadataValue(machine: FlyMachine, key: string): string | null {
    return getMachineMetadataValue(machine, key);
  }

  private getConfiguredStudioImage(machine: FlyMachine, desiredImage?: string): string | null {
    return getConfiguredStudioImage(machine, desiredImage);
  }

  private resolveMachineReconcileState(options: {
    machine: FlyMachine;
    desiredImage: string;
    preferredAccessToken?: string | null;
  }): { accessToken: string; needs: MachineReconcileNeeds } {
    return resolveMachineReconcileState({
      ...options,
      desiredGuest: this.desiredGuest,
      generateStudioAccessToken: () => this.generateStudioAccessToken(),
    });
  }

  private hasMachineDrift(needs: MachineReconcileNeeds): boolean {
    return hasMachineDrift(needs);
  }

  private getMachineDriftLabels(needs: MachineReconcileNeeds): string[] {
    return getMachineDriftLabels(needs);
  }

  private shouldStopSuspendedBeforeReconcile(
    state: string | undefined,
    needs: MachineReconcileNeeds,
  ): boolean {
    return shouldStopSuspendedBeforeReconcile(state, needs);
  }

  private resolveStudioIdFromMachine(machine: FlyMachine, fallback?: string | null): string {
    return resolveStudioIdFromMachine(machine, fallback);
  }

  private withAccessTokenEnv(
    env: Record<string, string> | undefined,
    accessToken: string,
  ): Record<string, string> {
    return withAccessTokenEnv(env, accessToken);
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
    return buildReconciledMetadata(options);
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
    return buildReconciledMachineConfig({
      ...options,
      desiredGuest: this.desiredGuest,
      normalizeServicesForVivd: (services, externalPort) =>
        this.normalizeServicesForVivd(services, externalPort),
    });
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
    return getMachineMetadata(machine);
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
    return ensureExistingMachineRunningWorkflow(
      {
        getMachineExternalPort: (machine) => this.getMachineExternalPort(machine),
        getDesiredImage: () => this.getDesiredImage(),
        trimToken: (value) => this.trimToken(value),
        resolveMachineReconcileState: (options) =>
          this.resolveMachineReconcileState(options),
        stopMachine: (machineId) => this.stopMachine(machineId),
        waitForState: (options) => this.waitForState(options),
        getMachine: (machineId) => this.getMachine(machineId),
        hasMachineDrift: (needs) => this.hasMachineDrift(needs),
        shouldStopSuspendedBeforeReconcile: (state, needs) =>
          this.shouldStopSuspendedBeforeReconcile(state, needs),
        resolveStudioIdFromMachine: (machine, fallback) =>
          this.resolveStudioIdFromMachine(machine, fallback),
        buildStudioEnv: (input) => this.buildStudioEnv(input),
        buildReconciledMetadata: (options) => this.buildReconciledMetadata(options),
        buildReconciledMachineConfig: (options) =>
          this.buildReconciledMachineConfig(options),
        updateMachineConfig: (options) => this.updateMachineConfig(options),
        startMachineHandlingReplacement: (machineId) =>
          this.startMachineHandlingReplacement(machineId),
        getPublicUrlForPort: (port) => this.getPublicUrlForPort(port),
        waitForReady: (options) => this.waitForReady(options),
        startTimeoutMs: this.startTimeoutMs,
        touchKey: (key) => this.touchKey(key),
      },
      existing,
      args,
      studioKey,
    );
  }

  private async recoverCreateNameConflict(
    error: unknown,
    machineName: string,
  ): Promise<FlyMachine | null> {
    return recoverCreateNameConflictWorkflow(
      {
        getMachine: (machineId) => this.getMachine(machineId),
        clearMachinesCache: () => {
          this.machinesCache = null;
        },
        listMachines: () => this.listMachines(),
        findMachineByName: (machines, name) => this.findMachineByName(machines, name),
      },
      error,
      machineName,
    );
  }

  private allocatePort(machines: FlyMachine[]): number {
    return allocatePortWorkflow(
      {
        getMachineExternalPort: (machine) => this.getMachineExternalPort(machine),
        portStart: this.portStart,
      },
      machines,
    );
  }

  private buildStudioEnv(
    args: StudioMachineStartArgs & { studioId: string; accessToken: string },
  ): Record<string, string> {
    return buildStudioEnvWorkflow(
      { desiredKillTimeoutSeconds: this.desiredKillTimeoutSeconds },
      args,
    );
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
    return restartInnerWorkflow(
      {
        key: (organizationId, projectSlug, version) =>
          this.key(organizationId, projectSlug, version),
        machineNameFor: (organizationId, projectSlug, version) =>
          this.machineNameFor(organizationId, projectSlug, version),
        listMachines: () => this.listMachines(),
        findMachineByName: (machines, name) => this.findMachineByName(machines, name),
        findMachine: (machines, organizationId, projectSlug, version) =>
          this.findMachine(machines, organizationId, projectSlug, version),
        ensureRunningInner: (input) => this.ensureRunningInner(input),
        getMachineExternalPort: (machine) => this.getMachineExternalPort(machine),
        getMachine: (machineId) => this.getMachine(machineId),
        clearMachinesCache: () => {
          this.machinesCache = null;
        },
        stopMachine: (machineId) => this.stopMachine(machineId),
        waitForState: (options) => this.waitForState(options),
        getDesiredImage: () => this.getDesiredImage(),
        getMachineMetadata: (machine) => this.getMachineMetadata(machine),
        getStudioAccessTokenFromMachine: (machine) =>
          this.getStudioAccessTokenFromMachine(machine),
        generateStudioAccessToken: () => this.generateStudioAccessToken(),
        buildStudioEnv: (input) => this.buildStudioEnv(input),
        desiredGuest: this.desiredGuest,
        desiredKillTimeoutSeconds: this.desiredKillTimeoutSeconds,
        normalizeServicesForVivd: (services, externalPort) =>
          this.normalizeServicesForVivd(services, externalPort),
        updateMachineConfig: (options) => this.updateMachineConfig(options),
        startMachineHandlingReplacement: (machineId) =>
          this.startMachineHandlingReplacement(machineId),
        getPublicUrlForPort: (port) => this.getPublicUrlForPort(port),
        waitForReady: (options) => this.waitForReady(options),
        startTimeoutMs: this.startTimeoutMs,
        touchKey: (key) => this.touchKey(key),
      },
      args,
    );
  }

  private async ensureRunningInner(
    args: StudioMachineStartArgs,
  ): Promise<StudioMachineStartResult> {
    return ensureRunningInnerWorkflow(
      {
        key: (organizationId, projectSlug, version) =>
          this.key(organizationId, projectSlug, version),
        machineNameFor: (organizationId, projectSlug, version) =>
          this.machineNameFor(organizationId, projectSlug, version),
        listMachines: () => this.listMachines(),
        findMachineByName: (machines, name) => this.findMachineByName(machines, name),
        findMachine: (machines, organizationId, projectSlug, version) =>
          this.findMachine(machines, organizationId, projectSlug, version),
        ensureExistingMachineRunning: (existing, input, studioKey) =>
          this.ensureExistingMachineRunning(existing, input, studioKey),
        allocatePort: (machines) => this.allocatePort(machines),
        getDesiredImage: () => this.getDesiredImage(),
        generateStudioAccessToken: () => this.generateStudioAccessToken(),
        buildStudioEnv: (input) => this.buildStudioEnv(input),
        createMachine: ({ machineName, config }) =>
          this.flyFetch<FlyMachine>("/machines", {
            method: "POST",
            body: JSON.stringify({
              name: machineName || undefined,
              region: this.region,
              config,
            }),
          }),
        region: this.region,
        desiredGuest: this.desiredGuest,
        desiredKillTimeoutSeconds: this.desiredKillTimeoutSeconds,
        recoverCreateNameConflict: (error, machineName) =>
          this.recoverCreateNameConflict(error, machineName),
        getPublicUrlForPort: (port) => this.getPublicUrlForPort(port),
        waitForReady: (options) => this.waitForReady(options),
        startTimeoutMs: this.startTimeoutMs,
        touchKey: (key) => this.touchKey(key),
      },
      args,
    );
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
    return warmReconcileStudioMachineWorkflow(
      {
        getDesiredImage: () => this.getDesiredImage(),
        getMachine: (id) => this.getMachine(id),
        getStudioIdentityFromMachine: (machine) => this.getStudioIdentityFromMachine(machine),
        resolveMachineReconcileState: (options) =>
          this.resolveMachineReconcileState(options),
        hasMachineDrift: (needs) => this.hasMachineDrift(needs),
        shouldStopSuspendedBeforeReconcile: (state, needs) =>
          this.shouldStopSuspendedBeforeReconcile(state, needs),
        stopMachine: (id) => this.stopMachine(id),
        waitForState: (options) => this.waitForState(options),
        getMachineExternalPort: (machine) => this.getMachineExternalPort(machine),
        resolveStudioIdFromMachine: (machine, fallback) =>
          this.resolveStudioIdFromMachine(machine, fallback),
        buildReconciledMetadata: (options) => this.buildReconciledMetadata(options),
        buildReconciledMachineConfig: (options) =>
          this.buildReconciledMachineConfig(options),
        updateMachineConfig: (options) => this.updateMachineConfig(options),
        waitForReconcileDriftToClear: (options) =>
          this.waitForReconcileDriftToClear(options),
        getMachineDriftLabels: (needs) => this.getMachineDriftLabels(needs),
        trimToken: (value) => this.trimToken(value),
        getMachineMetadataValue: (machine, key) => this.getMachineMetadataValue(machine, key),
        startMachineHandlingReplacement: (id) => this.startMachineHandlingReplacement(id),
        getPublicUrlForPort: (port) => this.getPublicUrlForPort(port),
        waitForReady: (options) => this.waitForReady(options),
        startTimeoutMs: this.startTimeoutMs,
        suspendOrStopMachine: (id) => this.suspendOrStopMachine(id),
      },
      machineId,
    );
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
    return reconcileStudioMachinesInnerWorkflow({
      getDesiredImage: () => this.getDesiredImage(),
      listMachines: () => this.listMachines(),
      maxMachineAgeMs: this.maxMachineAgeMs,
      reconcilerDryRun: this.reconcilerDryRun,
      getStudioIdentityFromMachine: (machine) => this.getStudioIdentityFromMachine(machine),
      getMachineCreatedAtMs: (machine) => this.getMachineCreatedAtMs(machine),
      reconcilerConcurrency: this.reconcilerConcurrency,
      getMachine: (id) => this.getMachine(id),
      stopMachine: (id) => this.stopMachine(id),
      waitForState: (options) => this.waitForState(options),
      destroyMachine: (id) => this.destroyMachine(id),
      resolveMachineReconcileState: (options) => this.resolveMachineReconcileState(options),
      hasMachineDrift: (needs) => this.hasMachineDrift(needs),
      getMachineDriftLabels: (needs) => this.getMachineDriftLabels(needs),
      warmOutdatedImages: this.warmOutdatedImages,
      shouldStopSuspendedBeforeReconcile: (state, needs) =>
        this.shouldStopSuspendedBeforeReconcile(state, needs),
      getMachineExternalPort: (machine) => this.getMachineExternalPort(machine),
      resolveStudioIdFromMachine: (machine, fallback) =>
        this.resolveStudioIdFromMachine(machine, fallback),
      buildReconciledMetadata: (options) => this.buildReconciledMetadata(options),
      buildReconciledMachineConfig: (options) =>
        this.buildReconciledMachineConfig(options),
      updateMachineConfig: (options) => this.updateMachineConfig(options),
      waitForReconcileDriftToClear: (options) => this.waitForReconcileDriftToClear(options),
      trimToken: (value) => this.trimToken(value),
      getMachineMetadataValue: (machine, key) => this.getMachineMetadataValue(machine, key),
      startMachineHandlingReplacement: (id) => this.startMachineHandlingReplacement(id),
      getPublicUrlForPort: (port) => this.getPublicUrlForPort(port),
      waitForReady: (options) => this.waitForReady(options),
      startTimeoutMs: this.startTimeoutMs,
      suspendOrStopMachine: (id) => this.suspendOrStopMachine(id),
    });
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
