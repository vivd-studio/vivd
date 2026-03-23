import type {
  StudioMachineProvider,
  StudioMachineRestartArgs,
  StudioMachineStartArgs,
  StudioMachineStartResult,
} from "../types";
import { listStudioVisitMsByIdentity } from "../visitStore";
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
  waitForReconcileDriftToClear,
  waitForState,
} from "./lifecycle";
import { FlyProviderConfig } from "./providerConfig";

export class FlyStudioMachineProvider implements StudioMachineProvider {
  kind = "fly" as const;

  private readonly config = new FlyProviderConfig();
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

  private async startMachineHandlingReplacement(machineId: string): Promise<void> {
    await startMachineHandlingReplacement({
      machineId,
      getMachine: (id) => this.getMachine(id),
      startMachine: (id) => this.apiClient.startMachine(id),
    });
  }

  private async suspendOrStopMachine(machineId: string): Promise<"suspended" | "stopped"> {
    return suspendOrStopMachine({
      machineId,
      getMachine: (id) => this.getMachine(id),
      suspendMachine: (id) => this.apiClient.suspendMachine(id),
      stopMachine: (id) => this.apiClient.stopMachine(id),
      waitForState: (options) => this.waitForState(options),
    });
  }

  private async waitForReconcileDriftToClear(options: {
    machineId: string;
    desiredImage: string;
    timeoutMs: number;
  }): Promise<MachineReconcileNeeds | null> {
    return waitForReconcileDriftToClear({
      ...options,
      getMachine: (id) => this.getMachine(id),
      resolveMachineReconcileState: (input) => this.resolveMachineReconcileState(input),
      hasMachineDrift,
    });
  }

  private buildStudioEnv(
    args: StudioMachineStartArgs & { studioId: string; accessToken: string },
  ): Record<string, string> {
    return buildStudioEnvWorkflow(
      { desiredKillTimeoutSeconds: this.config.desiredKillTimeoutSeconds },
      args,
    );
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
    return ensureExistingMachineRunningWorkflow(
      {
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
        startMachineHandlingReplacement: (machineId) =>
          this.startMachineHandlingReplacement(machineId),
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
    return restartInnerWorkflow(
      {
        key: (organizationId, projectSlug, version) =>
          this.config.key(organizationId, projectSlug, version),
        machineNameFor: (organizationId, projectSlug, version) =>
          this.config.machineNameFor(organizationId, projectSlug, version),
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
        startMachineHandlingReplacement: (machineId) =>
          this.startMachineHandlingReplacement(machineId),
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
    return ensureRunningInnerWorkflow(
      {
        key: (organizationId, projectSlug, version) =>
          this.config.key(organizationId, projectSlug, version),
        machineNameFor: (organizationId, projectSlug, version) =>
          this.config.machineNameFor(organizationId, projectSlug, version),
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
        getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
        waitForReady: (options) => this.waitForReady(options),
        startTimeoutMs: this.config.startTimeoutMs,
        touchKey: (studioKey) => this.touchKey(studioKey),
      },
      args,
    );
  }

  async listStudioMachines(): Promise<FlyStudioMachineSummary[]> {
    return listStudioMachinesWorkflow({
      getDesiredImage: () => this.getDesiredImage(),
      listMachines: () => this.apiClient.listMachines(),
      getStudioIdentityFromMachine,
      getMachineExternalPort,
      getConfiguredStudioImage,
      getMachineMetadata,
      getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
    });
  }

  async destroyStudioMachine(machineId: string): Promise<void> {
    return destroyStudioMachineWorkflow(
      {
        getMachine: (id) => this.getMachine(id),
        getStudioIdentityFromMachine,
        stopMachine: (id) => this.apiClient.stopMachine(id),
        waitForState: (options) => this.waitForState(options),
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

  async warmReconcileStudioMachine(machineId: string): Promise<{ desiredImage: string }> {
    return warmReconcileStudioMachineWorkflow(
      {
        getDesiredImage: () => this.getDesiredImage(),
        getMachine: (id) => this.getMachine(id),
        getStudioIdentityFromMachine,
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
        waitForReconcileDriftToClear: (options) =>
          this.waitForReconcileDriftToClear(options),
        getMachineDriftLabels,
        trimToken,
        getMachineMetadataValue,
        startMachineHandlingReplacement: (id) => this.startMachineHandlingReplacement(id),
        getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
        waitForReady: (options) => this.waitForReady(options),
        startTimeoutMs: this.config.startTimeoutMs,
        suspendOrStopMachine: (id) => this.suspendOrStopMachine(id),
      },
      machineId,
    );
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
      waitForReconcileDriftToClear: (options) =>
        this.waitForReconcileDriftToClear(options),
      trimToken,
      getMachineMetadataValue,
      startMachineHandlingReplacement: (machineId) =>
        this.startMachineHandlingReplacement(machineId),
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
        suspendOrStopMachine: (machineId) => this.suspendOrStopMachine(machineId),
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
  ): Promise<{ url: string; accessToken?: string } | null> {
    try {
      return getStudioMachineUrlWorkflow(
        {
          listMachines: () => this.apiClient.listMachines(),
          findMachineByName,
          findMachine,
          machineNameFor: (orgId, slug, v) => this.config.machineNameFor(orgId, slug, v),
          getMachineExternalPort,
          getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
          getStudioAccessTokenFromMachine,
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
