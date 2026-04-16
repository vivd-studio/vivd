import type {
  ManagedStudioMachineProvider,
  StudioMachineParkResult,
  StudioMachineRestartArgs,
  StudioMachineStartArgs,
  StudioMachineStartResult,
  StudioMachineUrlResult,
  StudioRuntimeAuthIdentity,
} from "../types";
import { mergeManagedStudioMachineEnv } from "../env";
import { listStudioVisitMsByIdentity } from "../visitStore";
import {
  pickStableStudioMachineEnv,
  resolveStableStudioMachineEnv,
} from "../stableRuntimeEnv";
import type {
  FlyMachine,
  FlyMachineConfig,
  FlyMachineState,
  FlyStudioMachineReconcileResult,
  FlyStudioMachineSummary,
} from "./types";
import { FlyApiClient } from "./apiClient";
import { FlyStudioImageResolver } from "./imageResolver";
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
  normalizeServicesForVivd,
  resolveMachineReconcileState,
  resolveStudioIdFromMachine,
  shouldStopSuspendedBeforeReconcile,
  trimToken,
} from "./machineModel";
import {
  allocatePortWorkflow,
  buildStudioEnvDriftSubsetFromDesiredEnv,
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
  destroyStudioMachineWorkflow,
  getStudioMachineUrlWorkflow,
  isStudioMachineRunningWorkflow,
  listStudioMachinesWorkflow,
  stopStudioMachineWorkflow,
} from "./managementWorkflow";
import {
  findMachine,
  findMachineByName,
  getMachineCreatedAtMs,
  getMachineExternalPort,
  getStudioIdentityFromMachine,
  getStudioKeyFromMachine,
} from "./machineInventory";
import {
  startMachineHandlingReplacement,
  suspendOrStopMachine,
  waitForReady,
  waitForState,
} from "./lifecycle";
import { FlyProviderConfig } from "./providerConfig";
import { FlyRuntimeRouteService } from "./runtimeRouteService";
import { requestRuntime } from "./runtimeHttp";
import { shouldCreateStudioCompatibilityRoutes } from "../compatibilityRoutePolicy";
import { parseNonNegativeInt, sleep } from "./utils";

const STUDIO_AUTH_HEADER = "x-vivd-studio-token";
const DEFAULT_PARK_RUNTIME_CLEANUP_DRAIN_MS = 3_000;
const RUNTIME_CLEANUP_STATUS_POLL_MS = 250;
const RUNTIME_CLEANUP_STATUS_TIMEOUT_MS = 15_000;

function getParkRuntimeCleanupDrainMs(): number {
  return parseNonNegativeInt(
    process.env.VIVD_FLY_PARK_RUNTIME_CLEANUP_DRAIN_MS,
    DEFAULT_PARK_RUNTIME_CLEANUP_DRAIN_MS,
  );
}

function hasSuspendAutostop(machine: FlyMachine): boolean {
  const services = machine.config?.services;
  if (!Array.isArray(services) || services.length === 0) return false;
  return services.some((service) => String(service?.autostop || "").toLowerCase() === "suspend");
}

function isSuspendRetryEligible(machine: FlyMachine): boolean {
  return hasSuspendAutostop(machine);
}

function isRuntimeCleanupStartupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("runtime cleanup") &&
    normalized.includes("503") &&
    (normalized.includes("starting up") || normalized.includes('"status":"starting"'))
  );
}

export class FlyStudioMachineProvider implements ManagedStudioMachineProvider {
  kind = "fly" as const;

  private readonly config = new FlyProviderConfig();
  private readonly routeService = new FlyRuntimeRouteService({
    getRoutesDir: () => this.config.runtimeRoutesDir,
    getRoutePath: (routeId) => this.config.routePathFor(routeId),
  });
  private readonly apiClient = new FlyApiClient({
    getToken: () => this.config.token,
    getAppName: () => this.config.appName,
  });
  private readonly imageResolver = new FlyStudioImageResolver({
    getStudioImageRepository: () => this.config.studioImageRepository,
  });

  private inflight = new Map<string, Promise<StudioMachineStartResult>>();
  private refreshInterval: NodeJS.Timeout | null = null;
  private idleCleanupInterval: NodeJS.Timeout | null = null;
  private reconcilerInterval: NodeJS.Timeout | null = null;
  private reconcileInFlight: Promise<FlyStudioMachineReconcileResult> | null = null;
  private lastActivityByStudioKey = new Map<string, number>();
  private idleStopInFlight = new Set<string>();
  private suspendFallbackReasons = new Map<string, string>();

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

    if (this.config.idleTimeoutMs > 0) {
      this.idleCleanupInterval = setInterval(() => {
        void this.stopIdleMachines();
      }, this.config.idleCheckIntervalMs);
      this.idleCleanupInterval.unref?.();
      void this.stopIdleMachines();
    }
  }

  startReconciler(): void {
    // Avoid log spam if Fly isn't configured yet.
    if (!process.env.FLY_API_TOKEN || !process.env.FLY_STUDIO_APP) return;
    if (!this.config.reconcilerEnabled) return;
    if (this.reconcilerInterval) return;

    const intervalMs = this.config.reconcilerIntervalMs;
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

  invalidateDesiredImageCache(): void {
    this.imageResolver.invalidateDesiredImageCache();
  }

  async getDesiredImage(options?: { forceRefresh?: boolean }): Promise<string> {
    return this.imageResolver.getDesiredImage(options);
  }

  private async refreshMachines(): Promise<void> {
    try {
      await this.apiClient.listMachines();
    } catch (err) {
      // Don't crash the backend if Fly isn't configured in local dev yet.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[FlyMachines] Refresh failed: ${message}`);
    }
  }

  private async stopIdleMachines(): Promise<void> {
    const idleTimeoutMs = this.config.idleTimeoutMs;
    if (idleTimeoutMs <= 0) return;

    const now = Date.now();
    let machines: FlyMachine[];
    try {
      machines = await this.apiClient.listMachines();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[FlyMachines] Idle cleanup failed: ${message}`);
      return;
    }

    for (const machine of machines) {
      if (machine.state !== "started") continue;

      const studioKey = getStudioKeyFromMachine(
        machine,
        (organizationId, projectSlug, version) =>
          this.config.key(organizationId, projectSlug, version),
      );
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
        const identity = getStudioIdentityFromMachine(machine);
        if (identity) {
          const routeId = this.config.routeIdFor(
            identity.organizationId,
            identity.projectSlug,
            identity.version,
          );
          await this.routeService.removeRuntimeRoute(routeId);
        }
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

  private touchKey(studioKey: string): void {
    this.lastActivityByStudioKey.set(studioKey, Date.now());
  }

  private resolveMachineReconcileState(options: {
    machine: FlyMachine;
    desiredImage: string;
    preferredAccessToken?: string | null;
    desiredEnvSubset?: Record<string, string>;
  }): { accessToken: string; needs: MachineReconcileNeeds } {
    return resolveMachineReconcileState({
      ...options,
      desiredGuest: this.config.desiredGuest,
      generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
    });
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
      desiredGuest: this.config.desiredGuest,
      normalizeServicesForVivd,
    });
  }

  private async getMachine(machineId: string): Promise<FlyMachine> {
    return this.apiClient.getMachine(machineId);
  }

  private async waitForReady(options: {
    machineId: string;
    url: string;
    timeoutMs: number;
  }): Promise<void> {
    return waitForReady({
      ...options,
      getMachine: (id) => this.getMachine(id),
    });
  }

  private async waitForState(options: {
    machineId: string;
    state: FlyMachineState;
    timeoutMs: number;
  }): Promise<void> {
    return waitForState({
      ...options,
      getMachine: (id) => this.getMachine(id),
    });
  }

  private async startMachineHandlingReplacement(
    machineId: string,
    timeoutMs?: number,
  ): Promise<void> {
    await startMachineHandlingReplacement({
      machineId,
      getMachine: (id) => this.getMachine(id),
      startMachine: (id) => this.apiClient.startMachine(id),
      timeoutMs: timeoutMs ?? this.config.startTimeoutMs,
    });
  }

  private async suspendOrStopMachine(machineId: string): Promise<"suspended" | "stopped"> {
    this.suspendFallbackReasons.delete(machineId);
    const result = await suspendOrStopMachine({
      machineId,
      getMachine: (id) => this.getMachine(id),
      suspendMachine: (id) => this.apiClient.suspendMachine(id),
      stopMachine: (id) => this.apiClient.stopMachine(id),
      onFallbackStop: ({ machineId: failedMachineId, lastError }) => {
        this.suspendFallbackReasons.set(
          failedMachineId,
          lastError || "unknown error",
        );
      },
      waitForState: (options) => this.waitForState(options),
    });
    if (result === "suspended") {
      this.suspendFallbackReasons.delete(machineId);
    }
    return result;
  }

  getLastSuspendFallbackReason(machineId: string): string | null {
    return this.suspendFallbackReasons.get(machineId) || null;
  }

  private async cleanupRuntimeBeforePark(machine: FlyMachine): Promise<void> {
    if ((machine.state || "unknown") !== "started") return;

    const port = getMachineExternalPort(machine);
    const accessToken = getStudioAccessTokenFromMachine(machine);
    if (!port || !accessToken) return;

    const url = this.config.getPublicUrlForPort(port);
    let cleanupError: unknown = null;
    try {
      await this.requestRuntimeCleanup(url, accessToken);
    } catch (error) {
      cleanupError = error;
      if (isRuntimeCleanupStartupError(error)) {
        try {
          await this.waitForReady({
            machineId: machine.id,
            url,
            timeoutMs: this.config.startTimeoutMs,
          });
          await this.requestRuntimeCleanup(url, accessToken);
          cleanupError = null;
        } catch (retryError) {
          cleanupError = retryError;
        }
      }
    }

    if (cleanupError) {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      console.warn(
        `[FlyMachines] Runtime cleanup before park failed for ${machine.id}: ${message}`,
      );
      return;
    }

    const drainMs = getParkRuntimeCleanupDrainMs();
    if (drainMs > 0) {
      await sleep(drainMs);
    }
  }

  private async waitForRuntimeCleanupIdle(
    url: string,
    accessToken: string,
    timeoutMs = RUNTIME_CLEANUP_STATUS_TIMEOUT_MS,
  ): Promise<boolean> {
    const cleanupStatusUrl = new URL("/vivd-studio/api/cleanup/status", url);
    const startedAt = Date.now();
    let lastState = "unknown";
    let lastSubsystems = "unknown";

    while (Date.now() - startedAt < timeoutMs) {
      const response = await requestRuntime({
        url: cleanupStatusUrl.toString(),
        method: "GET",
        headers: {
          [STUDIO_AUTH_HEADER]: accessToken,
          Accept: "application/json",
        },
        timeoutMs: 5_000,
      });

      if (response.status === 404) {
        return false;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `[FlyMachines] Runtime cleanup status failed ${response.status}: ${
            response.body || "unknown error"
          }`,
        );
      }

      const parsed = JSON.parse(response.body || "{}") as {
        state?: string;
        subsystems?: Record<string, string>;
      };
      lastState = typeof parsed.state === "string" ? parsed.state : "unknown";
      lastSubsystems = parsed.subsystems
        ? Object.entries(parsed.subsystems)
            .map(([name, state]) => `${name}=${state}`)
            .join(",")
        : "unknown";

      if (lastState === "idle") {
        return true;
      }

      await sleep(RUNTIME_CLEANUP_STATUS_POLL_MS);
    }

    throw new Error(
      `[FlyMachines] Runtime cleanup did not reach idle state within ${timeoutMs}ms (state=${lastState}; subsystems=${lastSubsystems})`,
    );
  }

  private async requestRuntimeCleanup(
    url: string,
    accessToken: string,
  ): Promise<void> {
    const cleanupUrl = new URL("/vivd-studio/api/cleanup/preview-leave", url);
    const response = await requestRuntime({
      url: cleanupUrl.toString(),
      method: "POST",
      headers: {
        [STUDIO_AUTH_HEADER]: accessToken,
      },
      timeoutMs: 15_000,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `[FlyMachines] Runtime cleanup failed ${response.status}: ${
          response.body || "unknown error"
        }`,
      );
    }

    await this.waitForRuntimeCleanupIdle(url, accessToken);
  }

  private buildStudioEnv(
    args: StudioMachineStartArgs & { studioId: string; accessToken: string },
  ): Record<string, string> {
    return buildStudioEnvWorkflow(
      { desiredKillTimeoutSeconds: this.config.desiredKillTimeoutSeconds },
      args,
    );
  }

  protected async resolveStableStudioRuntimeEnv(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<Record<string, string>> {
    return resolveStableStudioMachineEnv({
      providerKind: "fly",
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
    });
  }

  private async buildReconciledEnv(options: {
    machine: FlyMachine;
    organizationId: string;
    projectSlug: string;
    version: number;
    studioId: string;
    accessToken: string;
  }): Promise<{ desiredEnvSubset: Record<string, string>; fullEnv: Record<string, string> }> {
    let stableRuntimeEnv = pickStableStudioMachineEnv(options.machine.config?.env);
    try {
      stableRuntimeEnv = {
        ...stableRuntimeEnv,
        ...(await this.resolveStableStudioRuntimeEnv({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[FlyMachines] Failed to resolve stable runtime env for ${options.organizationId}:${options.projectSlug}/v${options.version}; reusing machine env fallback: ${message}`,
      );
    }

    const desiredEnv = this.buildStudioEnv({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      version: options.version,
      env: stableRuntimeEnv,
      studioId: options.studioId,
      accessToken: options.accessToken,
    });
    const desiredEnvSubset = buildStudioEnvDriftSubsetFromDesiredEnv(desiredEnv, []);

    return {
      desiredEnvSubset,
      fullEnv: mergeManagedStudioMachineEnv({
        currentEnv: options.machine.config?.env,
        desiredEnv,
        driftSubset: desiredEnvSubset,
      }),
    };
  }

  private allocatePort(machines: FlyMachine[]): number {
    return allocatePortWorkflow(
      {
        getMachineExternalPort,
        portStart: this.config.portStart,
      },
      machines,
    );
  }

  private async recoverCreateNameConflict(
    error: unknown,
    machineName: string,
  ): Promise<FlyMachine | null> {
    return recoverCreateNameConflictWorkflow(
      {
        getMachine: (machineId) => this.getMachine(machineId),
        clearMachinesCache: () => this.apiClient.clearMachinesCache(),
        listMachines: () => this.apiClient.listMachines(),
        findMachineByName,
      },
      error,
      machineName,
    );
  }

  private async ensureExistingMachineRunning(
    existing: FlyMachine,
    args: StudioMachineStartArgs,
    studioKey: string,
  ): Promise<StudioMachineStartResult> {
    const compatibilityRoutesEnabled =
      await shouldCreateStudioCompatibilityRoutes(this.kind);
    return ensureExistingMachineRunningWorkflow(
      {
        routeIdFor: (organizationId, projectSlug, version) =>
          this.config.routeIdFor(organizationId, projectSlug, version),
        upsertRuntimeRoute: compatibilityRoutesEnabled
          ? (options) => this.routeService.upsertRuntimeRoute(options)
          : async (options) => {
              await this.routeService.removeRuntimeRoute(options.routeId);
              return null;
            },
        getMachineExternalPort,
        getDesiredImage: () => this.getDesiredImage(),
        trimToken,
        resolveMachineReconcileState: (options) => this.resolveMachineReconcileState(options),
        stopMachine: (machineId) => this.apiClient.stopMachine(machineId),
        waitForState: (options) => this.waitForState(options),
        getMachine: (machineId) => this.getMachine(machineId),
        hasMachineDrift,
        shouldStopSuspendedBeforeReconcile,
        resolveStudioIdFromMachine,
        buildStudioEnv: (input) => this.buildStudioEnv(input),
        buildReconciledMetadata,
        buildReconciledMachineConfig: (options) => this.buildReconciledMachineConfig(options),
        updateMachineConfig: (options) => this.apiClient.updateMachineConfig(options),
        startMachineHandlingReplacement: (machineId, timeoutMs) =>
          this.startMachineHandlingReplacement(machineId, timeoutMs),
        getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
        waitForReady: (options) => this.waitForReady(options),
        startTimeoutMs: this.config.startTimeoutMs,
        touchKey: (key) => this.touchKey(key),
      },
      existing,
      args,
      studioKey,
    );
  }

  async ensureRunning(args: StudioMachineStartArgs): Promise<StudioMachineStartResult> {
    const key = this.config.key(args.organizationId, args.projectSlug, args.version);
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

    const key = this.config.key(args.organizationId, args.projectSlug, args.version);
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
    const compatibilityRoutesEnabled =
      await shouldCreateStudioCompatibilityRoutes(this.kind);
    return restartInnerWorkflow(
      {
        key: (organizationId, projectSlug, version) =>
          this.config.key(organizationId, projectSlug, version),
        machineNameFor: (organizationId, projectSlug, version) =>
          this.config.machineNameFor(organizationId, projectSlug, version),
        routeIdFor: (organizationId, projectSlug, version) =>
          this.config.routeIdFor(organizationId, projectSlug, version),
        listMachines: () => this.apiClient.listMachines(),
        findMachineByName,
        findMachine,
        ensureRunningInner: (startArgs) => this.ensureRunningInner(startArgs),
        getMachineExternalPort,
        getMachine: (machineId) => this.getMachine(machineId),
        clearMachinesCache: () => this.apiClient.clearMachinesCache(),
        stopMachine: (machineId) => this.apiClient.stopMachine(machineId),
        waitForState: (options) => this.waitForState(options),
        getDesiredImage: () => this.getDesiredImage(),
        getMachineMetadata,
        getStudioAccessTokenFromMachine,
        generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
        buildStudioEnv: (input) => this.buildStudioEnv(input),
        desiredGuest: this.config.desiredGuest,
        desiredKillTimeoutSeconds: this.config.desiredKillTimeoutSeconds,
        normalizeServicesForVivd,
        updateMachineConfig: (options) => this.apiClient.updateMachineConfig(options),
        upsertRuntimeRoute: compatibilityRoutesEnabled
          ? (options) => this.routeService.upsertRuntimeRoute(options)
          : async (options) => {
              await this.routeService.removeRuntimeRoute(options.routeId);
              return null;
            },
        startMachineHandlingReplacement: (machineId, timeoutMs) =>
          this.startMachineHandlingReplacement(machineId, timeoutMs),
        getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
        waitForReady: (options) => this.waitForReady(options),
        startTimeoutMs: this.config.startTimeoutMs,
        touchKey: (studioKey) => this.touchKey(studioKey),
      },
      args,
    );
  }

  private async ensureRunningInner(
    args: StudioMachineStartArgs,
  ): Promise<StudioMachineStartResult> {
    const compatibilityRoutesEnabled =
      await shouldCreateStudioCompatibilityRoutes(this.kind);
    return ensureRunningInnerWorkflow(
      {
        key: (organizationId, projectSlug, version) =>
          this.config.key(organizationId, projectSlug, version),
        machineNameFor: (organizationId, projectSlug, version) =>
          this.config.machineNameFor(organizationId, projectSlug, version),
        routeIdFor: (organizationId, projectSlug, version) =>
          this.config.routeIdFor(organizationId, projectSlug, version),
        listMachines: () => this.apiClient.listMachines(),
        findMachineByName,
        findMachine,
        ensureExistingMachineRunning: (existing, startArgs, studioKey) =>
          this.ensureExistingMachineRunning(existing, startArgs, studioKey),
        allocatePort: (machines) => this.allocatePort(machines),
        getDesiredImage: () => this.getDesiredImage(),
        generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
        buildStudioEnv: (input) => this.buildStudioEnv(input),
        createMachine: ({ machineName, config }) =>
          this.apiClient.createMachine({
            machineName,
            config,
            region: this.config.region,
          }),
        desiredGuest: this.config.desiredGuest,
        desiredKillTimeoutSeconds: this.config.desiredKillTimeoutSeconds,
        recoverCreateNameConflict: (error, machineName) =>
          this.recoverCreateNameConflict(error, machineName),
        upsertRuntimeRoute: compatibilityRoutesEnabled
          ? (options) => this.routeService.upsertRuntimeRoute(options)
          : async (options) => {
              await this.routeService.removeRuntimeRoute(options.routeId);
              return null;
            },
        getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
        waitForReady: (options) => this.waitForReady(options),
        startTimeoutMs: this.config.startTimeoutMs,
        touchKey: (studioKey) => this.touchKey(studioKey),
      },
      args,
    );
  }

  async listStudioMachines(): Promise<FlyStudioMachineSummary[]> {
    const compatibilityRoutesEnabled =
      await shouldCreateStudioCompatibilityRoutes(this.kind);
    return listStudioMachinesWorkflow({
      compatibilityRoutesEnabled,
      getDesiredImage: () => this.getDesiredImage(),
      listMachines: () => this.apiClient.listMachines(),
      getStudioIdentityFromMachine,
      getMachineExternalPort,
      getConfiguredStudioImage,
      getMachineMetadata,
      routeIdFor: (organizationId, projectSlug, version) =>
        this.config.routeIdFor(organizationId, projectSlug, version),
      getRoutePath: (routeId) => this.routeService.getRoutePath(routeId),
      getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
    });
  }

  async parkStudioMachine(machineId: string): Promise<StudioMachineParkResult> {
    const initialMachine = await this.getMachine(machineId);
    const identity = getStudioIdentityFromMachine(initialMachine);
    if (!identity) {
      throw new Error(`[FlyMachines] Refusing to park non-studio machine ${machineId}`);
    }
    const routeId = this.config.routeIdFor(
      identity.organizationId,
      identity.projectSlug,
      identity.version,
    );

    await this.cleanupRuntimeBeforePark(initialMachine);
    await this.routeService.removeRuntimeRoute(routeId);

    let parked = await this.suspendOrStopMachine(machineId);
    if (parked === "stopped" && isSuspendRetryEligible(initialMachine)) {
      const url = (() => {
        const port = getMachineExternalPort(initialMachine);
        return port ? this.config.getPublicUrlForPort(port) : null;
      })();
      console.warn(
        `[FlyMachines] Machine ${machineId} stopped instead of suspended despite suspend-compatible config; retrying park once after restart.`,
      );
      try {
        await this.startMachineHandlingReplacement(machineId);
        if (url) {
          await this.waitForReady({
            machineId,
            url,
            timeoutMs: this.config.startTimeoutMs,
          });
        }
        const restartedMachine = await this.getMachine(machineId);
        await this.cleanupRuntimeBeforePark(restartedMachine);
        parked = await this.suspendOrStopMachine(machineId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[FlyMachines] Retry park failed for ${machineId}: ${message}`);
      }
    }
    this.lastActivityByStudioKey.delete(
      this.config.key(identity.organizationId, identity.projectSlug, identity.version),
    );
    return parked;
  }

  async resolveRuntimeAuth(
    studioId: string,
    accessToken: string,
  ): Promise<StudioRuntimeAuthIdentity | null> {
    const normalizedStudioId = studioId.trim();
    const normalizedToken = accessToken.trim();
    if (!normalizedStudioId || !normalizedToken) return null;

    const machines = await this.apiClient.listMachines();
    for (const machine of machines) {
      const machineStudioId = resolveStudioIdFromMachine(machine, null);
      if (machineStudioId !== normalizedStudioId) continue;

      const machineToken = getStudioAccessTokenFromMachine(machine);
      if (machineToken !== normalizedToken) continue;

      const identity = getStudioIdentityFromMachine(machine);
      if (!identity) continue;

      return {
        studioId: normalizedStudioId,
        organizationId: identity.organizationId,
        projectSlug: identity.projectSlug,
        version: identity.version,
      };
    }

    return null;
  }

  async destroyStudioMachine(machineId: string): Promise<void> {
    return destroyStudioMachineWorkflow(
      {
        getMachine: (id) => this.getMachine(id),
        getStudioIdentityFromMachine,
        routeIdFor: (organizationId, projectSlug, version) =>
          this.config.routeIdFor(organizationId, projectSlug, version),
        stopMachine: (id) => this.apiClient.stopMachine(id),
        waitForState: (options) => this.waitForState(options),
        removeRuntimeRoute: (routeId) => this.routeService.removeRuntimeRoute(routeId),
        destroyMachine: (id) => this.apiClient.destroyMachine(id),
        key: (organizationId, projectSlug, version) =>
          this.config.key(organizationId, projectSlug, version),
        deleteLastActivity: (studioKey) => {
          this.lastActivityByStudioKey.delete(studioKey);
        },
      },
      machineId,
    );
  }

  async reconcileStudioMachine(
    machineId: string,
    options?: { forceRefreshDesiredImage?: boolean },
  ): Promise<{ desiredImage: string }> {
    return warmReconcileStudioMachineWorkflow(
      {
        getDesiredImage: () =>
          this.getDesiredImage({
            forceRefresh: options?.forceRefreshDesiredImage === true,
          }),
        getMachine: (id) => this.getMachine(id),
        getStudioIdentityFromMachine,
        buildReconciledEnv: (options) => this.buildReconciledEnv(options),
        resolveMachineReconcileState: (options) => this.resolveMachineReconcileState(options),
        hasMachineDrift,
        shouldStopSuspendedBeforeReconcile,
        stopMachine: (id) => this.apiClient.stopMachine(id),
        waitForState: (options) => this.waitForState(options),
        getMachineExternalPort,
        resolveStudioIdFromMachine,
        buildReconciledMetadata,
        buildReconciledMachineConfig: (options) => this.buildReconciledMachineConfig(options),
        updateMachineConfig: (options) => this.apiClient.updateMachineConfig(options),
        getMachineDriftLabels,
        trimToken,
        getMachineMetadataValue,
        startMachineHandlingReplacement: (id, timeoutMs) =>
          this.startMachineHandlingReplacement(id, timeoutMs),
        requestRuntimeCleanup: (url, accessToken) =>
          this.requestRuntimeCleanup(url, accessToken),
        getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
        waitForReady: (options) => this.waitForReady(options),
        startTimeoutMs: this.config.startTimeoutMs,
        suspendOrStopMachine: (id) => this.suspendOrStopMachine(id),
      },
      machineId,
    );
  }

  async warmReconcileStudioMachine(
    machineId: string,
    options?: { forceRefreshDesiredImage?: boolean },
  ): Promise<{ desiredImage: string }> {
    return this.reconcileStudioMachine(machineId, options);
  }

  async reconcileStudioMachines(options?: {
    forceRefreshDesiredImage?: boolean;
  }): Promise<FlyStudioMachineReconcileResult> {
    const existing = this.reconcileInFlight;
    if (existing) return existing;

    const promise = this.reconcileStudioMachinesInner({
      forceRefreshDesiredImage: options?.forceRefreshDesiredImage === true,
    }).finally(() => {
      if (this.reconcileInFlight === promise) this.reconcileInFlight = null;
    });
    this.reconcileInFlight = promise;
    return promise;
  }

  private async reconcileStudioMachinesInner(options: {
    forceRefreshDesiredImage: boolean;
  }): Promise<FlyStudioMachineReconcileResult> {
    const desiredImage = await this.getDesiredImage({
      forceRefresh: options.forceRefreshDesiredImage,
    });

    return reconcileStudioMachinesInnerWorkflow({
      getDesiredImage: async () => desiredImage,
      listMachines: () => this.apiClient.listMachines(),
      maxMachineInactivityMs: this.config.maxMachineInactivityMs,
      reconcilerDryRun: this.config.reconcilerDryRun,
      getStudioIdentityFromMachine,
      getStudioKeyForIdentity: (identity) =>
        this.config.key(identity.organizationId, identity.projectSlug, identity.version),
      listStudioVisitMsByIdentity: (identities) =>
        listStudioVisitMsByIdentity(identities),
      getMachineCreatedAtMs,
      reconcilerConcurrency: this.config.reconcilerConcurrency,
      getMachine: (machineId) => this.getMachine(machineId),
      buildReconciledEnv: (options) => this.buildReconciledEnv(options),
      stopMachine: (machineId) => this.apiClient.stopMachine(machineId),
      waitForState: (options) => this.waitForState(options),
      destroyMachine: (machineId) => this.apiClient.destroyMachine(machineId),
      resolveMachineReconcileState: (options) => this.resolveMachineReconcileState(options),
      hasMachineDrift,
      getMachineDriftLabels,
      warmOutdatedImages: this.config.warmOutdatedImages,
      shouldStopSuspendedBeforeReconcile,
      getMachineExternalPort,
      resolveStudioIdFromMachine,
      buildReconciledMetadata,
      buildReconciledMachineConfig: (options) => this.buildReconciledMachineConfig(options),
      updateMachineConfig: (options) => this.apiClient.updateMachineConfig(options),
      trimToken,
      getMachineMetadataValue,
      startMachineHandlingReplacement: (machineId, timeoutMs) =>
        this.startMachineHandlingReplacement(machineId, timeoutMs),
      requestRuntimeCleanup: (url, accessToken) =>
        this.requestRuntimeCleanup(url, accessToken),
      getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
      waitForReady: (options) => this.waitForReady(options),
      startTimeoutMs: this.config.startTimeoutMs,
      suspendOrStopMachine: (machineId) => this.suspendOrStopMachine(machineId),
    });
  }

  touch(organizationId: string, projectSlug: string, version: number): void {
    this.touchKey(this.config.key(organizationId, projectSlug, version));
  }

  async stop(organizationId: string, projectSlug: string, version: number): Promise<void> {
    return stopStudioMachineWorkflow(
      {
        key: (orgId, slug, v) => this.config.key(orgId, slug, v),
        deleteLastActivity: (studioKey) => {
          this.lastActivityByStudioKey.delete(studioKey);
        },
        listMachines: () => this.apiClient.listMachines(),
        findMachineByName,
        findMachine,
        machineNameFor: (orgId, slug, v) => this.config.machineNameFor(orgId, slug, v),
        parkStudioMachine: (machineId) => this.parkStudioMachine(machineId),
      },
      organizationId,
      projectSlug,
      version,
    );
  }

  async getUrl(
    organizationId: string,
    projectSlug: string,
    version: number,
  ): Promise<StudioMachineUrlResult | null> {
    try {
        const compatibilityRoutesEnabled =
          await shouldCreateStudioCompatibilityRoutes(this.kind);
      return getStudioMachineUrlWorkflow(
        {
          listMachines: () => this.apiClient.listMachines(),
          findMachineByName,
          findMachine,
          machineNameFor: (orgId, slug, v) => this.config.machineNameFor(orgId, slug, v),
          getMachineExternalPort,
          routeIdFor: (orgId, slug, v) => this.config.routeIdFor(orgId, slug, v),
          upsertRuntimeRoute: compatibilityRoutesEnabled
            ? (options) => this.routeService.upsertRuntimeRoute(options)
            : async (options) => {
                await this.routeService.removeRuntimeRoute(options.routeId);
                return null;
              },
          getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
          getStudioAccessTokenFromMachine,
          resolveStudioIdFromMachine,
        },
        organizationId,
        projectSlug,
        version,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[FlyMachines] getUrl failed for ${organizationId}:${projectSlug}/v${version}: ${message}`,
      );
      return null;
    }
  }

  async isRunning(
    organizationId: string,
    projectSlug: string,
    version: number,
  ): Promise<boolean> {
    try {
      return isStudioMachineRunningWorkflow(
        {
          listMachines: () => this.apiClient.listMachines(),
          findMachineByName,
          findMachine,
          machineNameFor: (orgId, slug, v) => this.config.machineNameFor(orgId, slug, v),
        },
        organizationId,
        projectSlug,
        version,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[FlyMachines] isRunning failed for ${organizationId}:${projectSlug}/v${version}: ${message}`,
      );
      return false;
    }
  }
}
