import os from "node:os";
import { listStudioVisitMsByIdentity } from "../visitStore";
import type {
  ManagedStudioMachineProvider,
  StudioMachineParkResult,
  StudioMachineReconcileResult,
  StudioMachineRestartArgs,
  StudioMachineStartArgs,
  StudioMachineStartResult,
  StudioMachineSummary,
  StudioRuntimeAuthIdentity,
  StudioMachineUrlResult,
} from "../types";
import { trimToken } from "../fly/machineModel";
import { DockerApiClient } from "./apiClient";
import { DockerProviderConfig } from "./providerConfig";
import { DockerStudioImageResolver } from "./imageResolver";
import { DockerRuntimeRouteService } from "./runtimeRouteService";
import type {
  DockerContainerInfo,
  DockerContainerSummary,
  DockerImageInfo,
} from "./types";
import {
  buildResolvedImageState,
  findContainer,
  getContainerAccessToken,
  getContainerExternalPort,
  getContainerIdentity,
  getContainerLabels,
  getContainerRouteId,
  getContainerStudioId,
  isLikelyRemoteImageReference,
  isRunningContainer,
  type DockerResolvedImageState,
} from "./containerModel";
import {
  destroyStudioMachineWorkflow,
  listStudioMachinesWorkflow,
  parkStudioMachineWorkflow,
} from "./managementWorkflow";
import {
  reconcileStudioMachinesInnerWorkflow,
  warmReconcileContainerWorkflow,
  type WarmReconcileContainerOptions,
} from "./reconcileWorkflow";
import {
  allocatePublicPortWorkflow,
  buildStudioEnvDriftSubsetFromDesiredEnv,
  buildStudioEnvWorkflow,
  createFreshContainerWorkflow,
  ensureContainerRunningWorkflow,
  ensureImageAvailableForCreateWorkflow,
  ensureRunningInnerWorkflow,
  getDirectContainerBaseUrl,
  recreateContainerWorkflow,
  resolveContainerNetworkNameWorkflow,
  resolveManagedMainBackendUrl,
  restartInnerWorkflow,
  type CreateFreshContainerOptions,
  type RecreateContainerOptions,
  type WaitForReadyOptions,
  waitForReadyWorkflow,
} from "./runtimeWorkflow";
import { shouldCreateStudioCompatibilityRoutes } from "../compatibilityRoutePolicy";

export class DockerStudioMachineProvider implements ManagedStudioMachineProvider {
  kind = "docker" as const;

  private readonly config = new DockerProviderConfig();
  private readonly apiClient = new DockerApiClient({
    getSocketPath: () => this.config.socketPath,
    getBaseUrl: () => this.config.apiBaseUrl,
    getApiVersion: () => this.config.apiVersion,
  });
  private readonly imageResolver = new DockerStudioImageResolver({
    getStudioImageRepository: () => this.config.studioImageRepository,
  });
  private readonly routeService = new DockerRuntimeRouteService({
    getRoutesDir: () => this.config.runtimeRoutesDir,
    getRoutePath: (routeId) => this.config.routePathFor(routeId),
    getForwardedProto: () => this.config.publicProtocol,
    getForwardedPort: () => this.config.publicPort,
  });

  private inflight = new Map<string, Promise<StudioMachineStartResult>>();
  private nextPublicPort = this.config.publicPortStart;
  private reconcilerInterval: NodeJS.Timeout | null = null;
  private reconcileInFlight: Promise<StudioMachineReconcileResult> | null = null;
  private idleCleanupInterval: NodeJS.Timeout | null = null;
  private lastActivityByStudioKey = new Map<string, number>();
  private idleStopInFlight = new Set<string>();
  private desiredImageStateCache:
    | { requestedRef: string; state: DockerResolvedImageState; fetchedAt: number }
    | null = null;
  private desiredImageStateInflight: Promise<DockerResolvedImageState> | null = null;
  private desiredImageStateInflightRef: string | null = null;

  constructor() {
    if (this.config.idleTimeoutMs > 0) {
      this.idleCleanupInterval = setInterval(() => {
        void this.stopIdleContainers();
      }, this.config.idleCheckIntervalMs);
      this.idleCleanupInterval.unref?.();
      void this.stopIdleContainers();
    }
  }

  startReconciler(): void {
    if (!this.config.reconcilerEnabled) return;
    if (this.reconcilerInterval) return;
    if (this.config.reconcilerIntervalMs <= 0) return;

    this.reconcilerInterval = setInterval(() => {
      void this.reconcileStudioMachines({ forceRefreshDesiredImage: true }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[DockerMachines] Reconciler failed: ${message}`);
      });
    }, this.config.reconcilerIntervalMs);
    this.reconcilerInterval.unref?.();

    void this.reconcileStudioMachines({ forceRefreshDesiredImage: true }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[DockerMachines] Reconciler failed: ${message}`);
    });
  }

  invalidateDesiredImageCache(): void {
    this.imageResolver.invalidateDesiredImageCache();
    this.desiredImageStateCache = null;
    this.desiredImageStateInflight = null;
    this.desiredImageStateInflightRef = null;
  }

  async getDesiredImage(options?: { forceRefresh?: boolean }): Promise<string> {
    return await this.imageResolver.getDesiredImage(options);
  }

  private async inspectImageSafe(imageRefOrId: string): Promise<DockerImageInfo | null> {
    try {
      return await this.apiClient.inspectImage(imageRefOrId);
    } catch {
      return null;
    }
  }

  private buildResolvedImageState(options: {
    requestedRef: string;
    image: DockerImageInfo;
    source: Exclude<DockerResolvedImageState["source"], "cached" | "unknown">;
  }): DockerResolvedImageState {
    return buildResolvedImageState(options);
  }

  private async tryRefreshDesiredImage(imageRef: string): Promise<boolean> {
    if (!isLikelyRemoteImageReference(imageRef)) return false;
    try {
      await this.ensureImageAvailableForCreate(imageRef);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[DockerMachines] Failed to refresh desired image ${imageRef}: ${message}`,
      );
      return false;
    }
  }

  private async getDesiredImageStateForRef(
    imageRef: string,
    options: { forceRefresh?: boolean; preferPull?: boolean } = {},
  ): Promise<DockerResolvedImageState> {
    const forceRefresh = options.forceRefresh === true;
    const preferPull = options.preferPull === true;
    const now = Date.now();
    const refreshMs = 300_000;

    if (
      !forceRefresh &&
      this.desiredImageStateCache?.requestedRef === imageRef &&
      now - this.desiredImageStateCache.fetchedAt < refreshMs
    ) {
      return {
        ...this.desiredImageStateCache.state,
        source: "cached",
      };
    }

    if (
      this.desiredImageStateInflight &&
      this.desiredImageStateInflightRef === imageRef
    ) {
      return await this.desiredImageStateInflight;
    }

    const promise = (async () => {
      const pulled = preferPull
        ? await this.tryRefreshDesiredImage(imageRef)
        : false;
      const inspected = await this.inspectImageSafe(imageRef);

      if (inspected) {
        const state = this.buildResolvedImageState({
          requestedRef: imageRef,
          image: inspected,
          source: pulled ? "pulled" : "local",
        });
        this.desiredImageStateCache = {
          requestedRef: imageRef,
          state,
          fetchedAt: Date.now(),
        };
        return state;
      }

      const unknownState: DockerResolvedImageState = {
        requestedRef: imageRef,
        imageId: null,
        repoDigest: null,
        versionLabel: null,
        revisionLabel: null,
        source: "unknown",
        checkedAt: new Date().toISOString(),
      };
      this.desiredImageStateCache = {
        requestedRef: imageRef,
        state: unknownState,
        fetchedAt: Date.now(),
      };
      return unknownState;
    })().finally(() => {
      if (this.desiredImageStateInflightRef === imageRef) {
        this.desiredImageStateInflight = null;
        this.desiredImageStateInflightRef = null;
      }
    });

    this.desiredImageStateInflight = promise;
    this.desiredImageStateInflightRef = imageRef;
    return await promise;
  }

  private touchKey(studioKey: string): void {
    this.lastActivityByStudioKey.set(studioKey, Date.now());
  }

  private async allocatePublicPort(): Promise<number> {
    return await allocatePublicPortWorkflow({
      listContainers: () => this.apiClient.listContainers(),
      nextPortCandidate: () => this.nextPublicPort++,
      warn: (message) => console.warn(message),
      hostIp: this.config.hostIp,
    });
  }

  private resolveManagedMainBackendUrl(raw: string | null | undefined): string | null {
    return resolveManagedMainBackendUrl(raw, this.config.internalMainBackendUrl);
  }

  private buildStudioEnv(
    args: StudioMachineStartArgs & { studioId: string; accessToken: string },
  ): Record<string, string> {
    return buildStudioEnvWorkflow(
      {
        desiredKillTimeoutSeconds: this.config.desiredKillTimeoutSeconds,
        internalMainBackendUrl: this.config.internalMainBackendUrl,
      },
      args,
    );
  }

  private buildStudioEnvDriftSubset(
    desiredEnv: Record<string, string>,
    explicitEnvKeys: Iterable<string>,
  ): Record<string, string> {
    return buildStudioEnvDriftSubsetFromDesiredEnv(
      desiredEnv,
      explicitEnvKeys,
    );
  }

  private async inspectContainer(
    containerId: string,
  ): Promise<DockerContainerInfo> {
    return await this.apiClient.inspectContainer(containerId);
  }

  private async waitForReady(options: WaitForReadyOptions): Promise<void> {
    return await waitForReadyWorkflow(
      {
        inspectContainer: (containerId) => this.inspectContainer(containerId),
        getInternalProxyUrlForRoutePath: (routePath) =>
          this.config.getInternalProxyUrlForRoutePath(routePath),
      },
      options,
    );
  }

  private async stopContainerIfRunning(container: DockerContainerInfo): Promise<void> {
    if (!isRunningContainer(container)) return;
    await this.apiClient.stopContainer(
      container.Id,
      this.config.desiredKillTimeoutSeconds,
    );
  }

  private async resolveContainerNetworkName(): Promise<string> {
    return await resolveContainerNetworkNameWorkflow({
      configuredNetwork: this.config.network,
      listNetworks: () => this.apiClient.listNetworks(),
      getPreferredNetworkName: () => this.resolveCurrentContainerNetworkName(),
      warn: (message) => console.warn(message),
    });
  }

  private async resolveCurrentContainerNetworkName(): Promise<string | null> {
    try {
      const hostname = trimToken(os.hostname());
      if (!hostname) return null;
      const container = await this.inspectContainer(hostname);
      const hostConfigNetwork = trimToken(container.HostConfig?.NetworkMode);
      if (hostConfigNetwork) return hostConfigNetwork;
      const attachedNetworks = Object.keys(container.NetworkSettings?.Networks || {});
      return trimToken(attachedNetworks[0]);
    } catch {
      return null;
    }
  }

  private async ensureImageAvailableForCreate(
    desiredImage: string,
  ): Promise<string | null> {
    return await ensureImageAvailableForCreateWorkflow({
      desiredImage,
      fallbackPlatform: this.config.fallbackPlatform,
      pullImage: (image, options) =>
        options
          ? this.apiClient.pullImage(image, options)
          : this.apiClient.pullImage(image),
      warn: (message) => console.warn(message),
    });
  }

  private async createFreshContainer(
    options: CreateFreshContainerOptions,
  ): Promise<DockerContainerInfo> {
    return await createFreshContainerWorkflow(
      {
        routeIdFor: (organizationId, projectSlug, version) =>
          this.config.routeIdFor(organizationId, projectSlug, version),
        containerNameFor: (organizationId, projectSlug, version) =>
          this.config.containerNameFor(organizationId, projectSlug, version),
        resolveContainerNetworkName: () => this.resolveContainerNetworkName(),
        buildStudioEnv: (args) => this.buildStudioEnv(args),
        getDesiredImageStateForRef: (imageRef) => this.getDesiredImageStateForRef(imageRef),
        createContainer: (createOptions) =>
          this.apiClient.createContainer(createOptions),
        inspectContainer: (containerIdOrName) =>
          this.inspectContainer(containerIdOrName),
        listContainers: () => this.apiClient.listContainers(),
        allocatePublicPort: () => this.allocatePublicPort(),
        ensureImageAvailableForCreate: (imageRef) =>
          this.ensureImageAvailableForCreate(imageRef),
        desiredKillTimeoutSeconds: this.config.desiredKillTimeoutSeconds,
        nanoCpus: this.config.nanoCpus,
        memoryBytes: this.config.memoryBytes,
        generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
        hostIp: this.config.hostIp,
      },
      options,
    );
  }

  private async recreateContainer(
    options: RecreateContainerOptions,
  ): Promise<DockerContainerInfo> {
    return await recreateContainerWorkflow(
      {
        stopContainer: (containerId, timeoutSeconds) =>
          this.apiClient.stopContainer(containerId, timeoutSeconds),
        desiredKillTimeoutSeconds: this.config.desiredKillTimeoutSeconds,
        removeContainer: (containerId) => this.apiClient.removeContainer(containerId),
        createFreshContainer: (createOptions) => this.createFreshContainer(createOptions),
      },
      options,
    );
  }

  private async ensureContainerRunning(
    args: StudioMachineStartArgs,
    container: DockerContainerInfo,
    accessToken: string,
    desiredImage: string,
    allowNetworkRecovery = true,
  ): Promise<StudioMachineStartResult> {
    const compatibilityRoutesEnabled =
      await shouldCreateStudioCompatibilityRoutes(this.kind);
    return await ensureContainerRunningWorkflow(
      {
        key: (organizationId, projectSlug, version) =>
          this.config.key(organizationId, projectSlug, version),
        routeIdFor: (organizationId, projectSlug, version) =>
          this.config.routeIdFor(organizationId, projectSlug, version),
        containerNameFor: (organizationId, projectSlug, version) =>
          this.config.containerNameFor(organizationId, projectSlug, version),
        upsertRuntimeRoute: compatibilityRoutesEnabled
          ? (routeOptions) => this.routeService.upsertRuntimeRoute(routeOptions)
          : async (routeOptions) => {
              await this.routeService.removeRuntimeRoute(routeOptions.routeId);
              return null;
            },
        startContainer: (containerId) => this.apiClient.startContainer(containerId),
        recreateContainer: (recreateOptions) =>
          this.recreateContainer(recreateOptions),
        getDesiredImageStateForRef: (imageRef) => this.getDesiredImageStateForRef(imageRef),
        getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
        getPublicUrlForRoutePath: (routePath) =>
          this.config.getPublicUrlForRoutePath(routePath),
        getInternalProxyUrlForRoutePath: (routePath) =>
          this.config.getInternalProxyUrlForRoutePath(routePath),
        startTimeoutMs: this.config.startTimeoutMs,
        touchKey: (studioKey) => this.touchKey(studioKey),
        waitForReady: (options) => this.waitForReady(options),
      },
      args,
      container,
      accessToken,
      desiredImage,
      allowNetworkRecovery,
    );
  }

  private async stopIdleContainers(): Promise<void> {
    if (this.config.idleTimeoutMs <= 0) return;

    const now = Date.now();
    let containers: DockerContainerSummary[];
    try {
      containers = await this.apiClient.listContainers();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[DockerMachines] Idle cleanup failed: ${message}`);
      return;
    }

    for (const container of containers) {
      const identity = getContainerIdentity(container);
      if (!identity || !isRunningContainer(container)) continue;

      const studioKey = this.config.key(
        identity.organizationId,
        identity.projectSlug,
        identity.version,
      );
      const lastActivity = this.lastActivityByStudioKey.get(studioKey);
      if (!lastActivity) {
        this.lastActivityByStudioKey.set(studioKey, now);
        continue;
      }

      if (now - lastActivity < this.config.idleTimeoutMs) continue;
      if (this.idleStopInFlight.has(studioKey)) continue;

      this.idleStopInFlight.add(studioKey);
      try {
        const inspected = await this.inspectContainer(container.Id);
        await this.stopContainerIfRunning(inspected);
        const routeId =
          getContainerRouteId(inspected) ||
          this.config.routeIdFor(
            identity.organizationId,
            identity.projectSlug,
            identity.version,
          );
        await this.routeService.removeRuntimeRoute(routeId);
        this.lastActivityByStudioKey.delete(studioKey);
        const idleSeconds = Math.max(1, Math.round((now - lastActivity) / 1000));
        console.log(
          `[DockerMachines] Stopped idle container ${container.Id} for ${studioKey} after ${idleSeconds}s without keepalive`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[DockerMachines] Failed to stop idle container ${container.Id} for ${studioKey}: ${message}`,
        );
      } finally {
        this.idleStopInFlight.delete(studioKey);
      }
    }
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

  private async ensureRunningInner(
    args: StudioMachineStartArgs,
  ): Promise<StudioMachineStartResult> {
    return await ensureRunningInnerWorkflow(
      {
        listContainers: () => this.apiClient.listContainers(),
        getDesiredImage: () => this.getDesiredImage(),
        getDesiredImageStateForRef: (imageRef) => this.getDesiredImageStateForRef(imageRef),
        createFreshContainer: (createOptions) => this.createFreshContainer(createOptions),
        inspectContainer: (containerId) => this.inspectContainer(containerId),
        resolveContainerNetworkName: () => this.resolveContainerNetworkName(),
        resolveManagedMainBackendUrl: (raw) => this.resolveManagedMainBackendUrl(raw),
        buildStudioEnv: (envArgs) => this.buildStudioEnv(envArgs),
        buildStudioEnvDriftSubset: (desiredEnv, explicitEnvKeys) =>
          this.buildStudioEnvDriftSubset(desiredEnv, explicitEnvKeys),
        nanoCpus: this.config.nanoCpus,
        memoryBytes: this.config.memoryBytes,
        generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
        recreateContainer: (recreateOptions) =>
          this.recreateContainer(recreateOptions),
        ensureContainerRunning: (startArgs, container, accessToken, desiredImage) =>
          this.ensureContainerRunning(startArgs, container, accessToken, desiredImage),
      },
      args,
    );
  }

  async restart(args: StudioMachineRestartArgs): Promise<StudioMachineStartResult> {
    if (args.mode !== "hard") {
      return await this.ensureRunning(args);
    }

    const key = this.config.key(args.organizationId, args.projectSlug, args.version);
    const existingInflight = this.inflight.get(key);
    if (existingInflight) {
      try {
        await existingInflight;
      } catch {
        // Restart proceeds regardless of the previous startup result.
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

  private async restartInner(
    args: StudioMachineRestartArgs,
  ): Promise<StudioMachineStartResult> {
    return await restartInnerWorkflow(
      {
        listContainers: () => this.apiClient.listContainers(),
        inspectContainer: (containerId) => this.inspectContainer(containerId),
        getDesiredImage: () => this.getDesiredImage(),
        getDesiredImageStateForRef: (imageRef) => this.getDesiredImageStateForRef(imageRef),
        recreateContainer: (recreateOptions) =>
          this.recreateContainer(recreateOptions),
        createFreshContainer: (createOptions) => this.createFreshContainer(createOptions),
        ensureContainerRunning: (restartArgs, container, accessToken, desiredImage) =>
          this.ensureContainerRunning(restartArgs, container, accessToken, desiredImage),
      },
      args,
    );
  }

  touch(organizationId: string, projectSlug: string, version: number): void {
    this.touchKey(this.config.key(organizationId, projectSlug, version));
  }

  async stop(
    organizationId: string,
    projectSlug: string,
    version: number,
  ): Promise<void> {
    const studioKey = this.config.key(organizationId, projectSlug, version);
    this.lastActivityByStudioKey.delete(studioKey);

    const existing = findContainer(
      await this.apiClient.listContainers(),
      organizationId,
      projectSlug,
      version,
    );
    if (!existing) return;

    const inspected = await this.inspectContainer(existing.Id);
    const routeId =
      getContainerRouteId(inspected) ||
      this.config.routeIdFor(organizationId, projectSlug, version);
    await this.stopContainerIfRunning(inspected);
    await this.routeService.removeRuntimeRoute(routeId);
  }

  async getUrl(
    organizationId: string,
    projectSlug: string,
    version: number,
  ): Promise<StudioMachineUrlResult | null> {
    const existing = findContainer(
      await this.apiClient.listContainers(),
      organizationId,
      projectSlug,
      version,
    );
    if (!existing || !isRunningContainer(existing)) return null;

    const inspected = await this.inspectContainer(existing.Id);
    const accessToken = getContainerAccessToken(inspected);
    if (!accessToken) return null;

    const routeId =
      getContainerRouteId(inspected) ||
      this.config.routeIdFor(organizationId, projectSlug, version);
    const compatibilityRoutesEnabled =
      await shouldCreateStudioCompatibilityRoutes(this.kind);
    if (!compatibilityRoutesEnabled) {
      await this.routeService.removeRuntimeRoute(routeId);
    }
    const routePath = compatibilityRoutesEnabled
      ? this.routeService.getRoutePath(routeId)
      : null;
    const externalPort = getContainerExternalPort(inspected);
    const runtimeUrl = externalPort
      ? this.config.getPublicUrlForPort(externalPort)
      : null;
    const compatibilityUrl = routePath
      ? this.config.getPublicUrlForRoutePath(routePath)
      : null;
    const backendUrl =
      getDirectContainerBaseUrl(inspected) ??
      (routePath ? this.config.getInternalProxyUrlForRoutePath(routePath) : null);
    return {
      studioId: getContainerStudioId(inspected, null),
      url:
        runtimeUrl ??
        compatibilityUrl ??
        (() => {
          throw new Error(
            `[DockerMachines] Missing browser URL for ${organizationId}:${projectSlug}/v${version}`,
          );
        })(),
      backendUrl,
      runtimeUrl,
      compatibilityUrl,
      accessToken,
    };
  }

  async isRunning(
    organizationId: string,
    projectSlug: string,
    version: number,
  ): Promise<boolean> {
    const existing = findContainer(
      await this.apiClient.listContainers(),
      organizationId,
      projectSlug,
      version,
    );
    return !!existing && isRunningContainer(existing);
  }

  async resolveRuntimeAuth(
    studioId: string,
    accessToken: string,
  ): Promise<StudioRuntimeAuthIdentity | null> {
    const normalizedStudioId = studioId.trim();
    const normalizedToken = accessToken.trim();
    if (!normalizedStudioId || !normalizedToken) return null;

    const containers = await this.apiClient.listContainers();
    const candidates = containers.filter((container) => {
      const labels = getContainerLabels(container);
      return trimToken(labels["vivd_studio_id"]) === normalizedStudioId;
    });

    for (const container of candidates) {
      const inspected = await this.inspectContainer(container.Id);
      const candidateStudioId = getContainerStudioId(inspected, null);
      if (candidateStudioId !== normalizedStudioId) continue;

      const candidateAccessToken = getContainerAccessToken(inspected);
      if (candidateAccessToken !== normalizedToken) continue;

      const identity = getContainerIdentity(inspected);
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

  async listStudioMachines(): Promise<StudioMachineSummary[]> {
    const compatibilityRoutesEnabled =
      await shouldCreateStudioCompatibilityRoutes(this.kind);
    return await listStudioMachinesWorkflow({
      compatibilityRoutesEnabled,
      getDesiredImage: () => this.getDesiredImage(),
      getDesiredImageStateForRef: (imageRef) => this.getDesiredImageStateForRef(imageRef),
      listContainers: () => this.apiClient.listContainers(),
      inspectContainer: (containerId) => this.inspectContainer(containerId),
      routeIdFor: (organizationId, projectSlug, version) =>
        this.config.routeIdFor(organizationId, projectSlug, version),
      getRoutePath: (routeId) => this.routeService.getRoutePath(routeId),
      getPublicUrlForPort: (port) => this.config.getPublicUrlForPort(port),
      getPublicUrlForRoutePath: (routePath) =>
        this.config.getPublicUrlForRoutePath(routePath),
      cpuKind: this.config.cpuKindLabel,
      inspectImageSafe: (imageRefOrId) => this.inspectImageSafe(imageRefOrId),
    });
  }

  async parkStudioMachine(machineId: string): Promise<StudioMachineParkResult> {
    return await parkStudioMachineWorkflow(
      {
        inspectContainer: (containerId) => this.inspectContainer(containerId),
        routeIdFor: (organizationId, projectSlug, version) =>
          this.config.routeIdFor(organizationId, projectSlug, version),
        stopContainerIfRunning: (container) => this.stopContainerIfRunning(container),
        removeRuntimeRoute: (routeId) => this.routeService.removeRuntimeRoute(routeId),
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
    const container = await this.inspectContainer(machineId);
    const identity = getContainerIdentity(container);
    if (!identity) {
      throw new Error(
        `[DockerMachines] Refusing to reconcile non-studio container ${machineId}`,
      );
    }

    const desiredImage = await this.getDesiredImage({
      forceRefresh: options?.forceRefreshDesiredImage === true,
    });
    const desiredImageState = await this.getDesiredImageStateForRef(desiredImage, {
      forceRefresh: options?.forceRefreshDesiredImage === true,
      preferPull: options?.forceRefreshDesiredImage === true,
    });
    const desiredNetworkName = await this.resolveContainerNetworkName();
    await this.warmReconcileContainer({
      container,
      identity,
      desiredImage,
      desiredImageState,
      desiredNetworkName,
    });
    return { desiredImage };
  }

  async destroyStudioMachine(machineId: string): Promise<void> {
    return await destroyStudioMachineWorkflow(
      {
        inspectContainer: (containerId) => this.inspectContainer(containerId),
        routeIdFor: (organizationId, projectSlug, version) =>
          this.config.routeIdFor(organizationId, projectSlug, version),
        stopContainerIfRunning: (container) => this.stopContainerIfRunning(container),
        removeRuntimeRoute: (routeId) => this.routeService.removeRuntimeRoute(routeId),
        removeContainer: (containerId) => this.apiClient.removeContainer(containerId),
        key: (organizationId, projectSlug, version) =>
          this.config.key(organizationId, projectSlug, version),
        deleteLastActivity: (studioKey) => {
          this.lastActivityByStudioKey.delete(studioKey);
        },
      },
      machineId,
    );
  }

  private async warmReconcileContainer(
    options: WarmReconcileContainerOptions,
  ): Promise<void> {
    return await warmReconcileContainerWorkflow(
      {
        resolveManagedMainBackendUrl: (raw) => this.resolveManagedMainBackendUrl(raw),
        buildStudioEnv: (envArgs) => this.buildStudioEnv(envArgs),
        buildStudioEnvDriftSubset: (desiredEnv, explicitEnvKeys) =>
          this.buildStudioEnvDriftSubset(desiredEnv, explicitEnvKeys),
        nanoCpus: this.config.nanoCpus,
        memoryBytes: this.config.memoryBytes,
        generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
        recreateContainer: (recreateOptions) =>
          this.recreateContainer(recreateOptions),
        ensureContainerRunning: (startArgs, container, accessToken, desiredImage) =>
          this.ensureContainerRunning(startArgs, container, accessToken, desiredImage),
        stop: (organizationId, projectSlug, version) =>
          this.stop(organizationId, projectSlug, version),
      },
      options,
    );
  }

  async reconcileStudioMachines(options?: {
    forceRefreshDesiredImage?: boolean;
  }): Promise<StudioMachineReconcileResult> {
    const existing = this.reconcileInFlight;
    if (existing) return existing;

    const promise = this.reconcileStudioMachinesInner({
      forceRefreshDesiredImage: options?.forceRefreshDesiredImage === true,
    }).finally(() => {
      if (this.reconcileInFlight === promise) {
        this.reconcileInFlight = null;
      }
    });
    this.reconcileInFlight = promise;
    return promise;
  }

  private async reconcileStudioMachinesInner(options: {
    forceRefreshDesiredImage: boolean;
  }): Promise<StudioMachineReconcileResult> {
    return await reconcileStudioMachinesInnerWorkflow(
      {
        getDesiredImage: (imageOptions) => this.getDesiredImage(imageOptions),
        getDesiredImageStateForRef: (imageRef, imageOptions) =>
          this.getDesiredImageStateForRef(imageRef, imageOptions),
        listContainers: () => this.apiClient.listContainers(),
        resolveContainerNetworkName: () => this.resolveContainerNetworkName(),
        reconcilerDryRun: this.config.reconcilerDryRun,
        maxMachineInactivityMs: this.config.maxMachineInactivityMs,
        key: (organizationId, projectSlug, version) =>
          this.config.key(organizationId, projectSlug, version),
        listStudioVisitMsByIdentity: (identities) =>
          listStudioVisitMsByIdentity(identities),
        reconcilerConcurrency: this.config.reconcilerConcurrency,
        inspectContainer: (containerId) => this.inspectContainer(containerId),
        resolveManagedMainBackendUrl: (raw) => this.resolveManagedMainBackendUrl(raw),
        nanoCpus: this.config.nanoCpus,
        memoryBytes: this.config.memoryBytes,
        generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
        warmOutdatedImages: this.config.warmOutdatedImages,
        warmReconcileContainer: (warmOptions) =>
          this.warmReconcileContainer(warmOptions),
        destroyStudioMachine: (machineId) => this.destroyStudioMachine(machineId),
      },
      options,
    );
  }
}
