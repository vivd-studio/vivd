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
  compareContainerImageState,
  containerStateStatus,
  findContainer,
  getContainerAccessToken,
  getContainerConfiguredImage,
  getContainerCreatedAt,
  getContainerEnv,
  getContainerExternalPort,
  getContainerIdentity,
  getContainerLabels,
  getContainerName,
  getContainerRouteId,
  getContainerRuntimeImageId,
  getContainerStudioId,
  getContainerUpdatedAt,
  getImageLabel,
  hasContainerDrift,
  isLikelyRemoteImageReference,
  isRunningContainer,
  isStoppedContainer,
  mapContainerState,
  OCI_IMAGE_REVISION_LABEL,
  OCI_IMAGE_VERSION_LABEL,
  resolveContainerReconcileState,
  selectRepoDigestForRef,
  STUDIO_IMAGE_DIGEST_LABEL,
  STUDIO_IMAGE_REVISION_LABEL,
  STUDIO_IMAGE_VERSION_LABEL,
  type DockerResolvedImageState,
  type StudioIdentity,
} from "./containerModel";
import {
  allocatePublicPortWorkflow,
  buildStudioEnvDriftSubsetFromDesiredEnv,
  buildStudioEnvWorkflow,
  createFreshContainerWorkflow,
  ensureContainerRunningWorkflow,
  ensureImageAvailableForCreateWorkflow,
  ensureRunningInnerWorkflow,
  recreateContainerWorkflow,
  resolveContainerNetworkNameWorkflow,
  resolveManagedMainBackendUrl,
  restartInnerWorkflow,
  type CreateFreshContainerOptions,
  type RecreateContainerOptions,
  type WaitForReadyOptions,
  waitForReadyWorkflow,
} from "./runtimeWorkflow";

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
      warn: (message) => console.warn(message),
    });
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
    return await ensureContainerRunningWorkflow(
      {
        key: (organizationId, projectSlug, version) =>
          this.config.key(organizationId, projectSlug, version),
        routeIdFor: (organizationId, projectSlug, version) =>
          this.config.routeIdFor(organizationId, projectSlug, version),
        containerNameFor: (organizationId, projectSlug, version) =>
          this.config.containerNameFor(organizationId, projectSlug, version),
        upsertRuntimeRoute: (routeOptions) =>
          this.routeService.upsertRuntimeRoute(routeOptions),
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
    const routePath = this.routeService.getRoutePath(routeId);
    const externalPort = getContainerExternalPort(inspected);
    const runtimeUrl = externalPort
      ? this.config.getPublicUrlForPort(externalPort)
      : null;
    const compatibilityUrl = this.config.getPublicUrlForRoutePath(routePath);
    const backendUrl = this.config.getInternalProxyUrlForRoutePath(routePath);
    return {
      studioId: getContainerStudioId(inspected, null),
      url: runtimeUrl ?? compatibilityUrl,
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

  private async getRuntimeImageMetadata(options: {
    container: DockerContainerInfo;
    runtimeImageCache: Map<string, Promise<DockerImageInfo | null>>;
  }): Promise<{
    imageId: string | null;
    imageDigest: string | null;
    imageVersion: string | null;
    imageRevision: string | null;
  }> {
    const labels = getContainerLabels(options.container);
    const imageId = getContainerRuntimeImageId(options.container);
    let imageDigest = trimToken(labels[STUDIO_IMAGE_DIGEST_LABEL]);
    let imageVersion = trimToken(labels[STUDIO_IMAGE_VERSION_LABEL]);
    let imageRevision = trimToken(labels[STUDIO_IMAGE_REVISION_LABEL]);

    if ((!imageDigest || !imageVersion || !imageRevision) && imageId) {
      let inspectPromise = options.runtimeImageCache.get(imageId);
      if (!inspectPromise) {
        inspectPromise = this.inspectImageSafe(imageId);
        options.runtimeImageCache.set(imageId, inspectPromise);
      }

      const inspected = await inspectPromise;
      if (inspected) {
        if (!imageDigest) {
          imageDigest = selectRepoDigestForRef(
            inspected.RepoDigests,
            getContainerConfiguredImage(options.container) || imageId,
          );
        }
        if (!imageVersion) {
          imageVersion = getImageLabel(inspected, OCI_IMAGE_VERSION_LABEL);
        }
        if (!imageRevision) {
          imageRevision = getImageLabel(inspected, OCI_IMAGE_REVISION_LABEL);
        }
      }
    }

    return {
      imageId,
      imageDigest,
      imageVersion,
      imageRevision,
    };
  }

  private async buildContainerSummary(options: {
    container: DockerContainerInfo;
    desiredImageState: DockerResolvedImageState;
    routePath: string | null;
    url: string | null;
    runtimeUrl: string | null;
    compatibilityUrl: string | null;
    cpuKind: string;
    runtimeImageCache: Map<string, Promise<DockerImageInfo | null>>;
  }): Promise<StudioMachineSummary> {
    const identity = getContainerIdentity(options.container);
    if (!identity) {
      throw new Error(
        `[DockerMachines] Refusing to summarize non-studio container ${options.container.Id}`,
      );
    }

    const configuredImage = getContainerConfiguredImage(
      options.container,
      options.desiredImageState.requestedRef,
    );
    const imageComparison = compareContainerImageState({
      container: options.container,
      desiredImage: options.desiredImageState.requestedRef,
      desiredImageState: options.desiredImageState,
    });
    const runtimeImage = await this.getRuntimeImageMetadata({
      container: options.container,
      runtimeImageCache: options.runtimeImageCache,
    });
    const nanoCpus = options.container.HostConfig?.NanoCpus || 0;
    const memoryBytes = options.container.HostConfig?.Memory || 0;

    return {
      id: options.container.Id,
      name: getContainerName(options.container),
      state: mapContainerState(options.container),
      region: null,
      cpuKind: nanoCpus > 0 || memoryBytes > 0 ? options.cpuKind : null,
      cpus: nanoCpus > 0 ? nanoCpus / 1_000_000_000 : null,
      memoryMb: memoryBytes > 0 ? Math.round(memoryBytes / (1024 * 1024)) : null,
      organizationId: identity.organizationId,
      projectSlug: identity.projectSlug,
      version: identity.version,
      externalPort: getContainerExternalPort(options.container),
      routePath: options.routePath,
      url: options.url,
      runtimeUrl: options.runtimeUrl,
      compatibilityUrl: options.compatibilityUrl,
      image: configuredImage,
      desiredImage: options.desiredImageState.requestedRef,
      imageOutdated: imageComparison.drift,
      imageStatus: imageComparison.drift
        ? "outdated"
        : imageComparison.comparable
          ? "ok"
          : "unknown",
      imageId: runtimeImage.imageId,
      imageDigest: runtimeImage.imageDigest,
      imageVersion: runtimeImage.imageVersion,
      imageRevision: runtimeImage.imageRevision,
      desiredImageId: options.desiredImageState.imageId,
      desiredImageDigest: options.desiredImageState.repoDigest,
      desiredImageVersion: options.desiredImageState.versionLabel,
      desiredImageRevision: options.desiredImageState.revisionLabel,
      createdAt: getContainerCreatedAt(options.container),
      updatedAt: getContainerUpdatedAt(options.container),
    };
  }

  async listStudioMachines(): Promise<StudioMachineSummary[]> {
    const desiredImage = await this.getDesiredImage();
    const desiredImageState = await this.getDesiredImageStateForRef(desiredImage);
    const containers = await this.apiClient.listContainers();
    const summaries: StudioMachineSummary[] = [];
    const runtimeImageCache = new Map<string, Promise<DockerImageInfo | null>>();

    for (const container of containers) {
      const identity = getContainerIdentity(container);
      if (!identity) continue;

      const inspected = await this.inspectContainer(container.Id);
      const routeId =
        getContainerRouteId(inspected) ||
        this.config.routeIdFor(
          identity.organizationId,
          identity.projectSlug,
          identity.version,
      );
      const routePath = this.routeService.getRoutePath(routeId);
      const running = isRunningContainer(inspected);
      const externalPort = getContainerExternalPort(inspected);
      summaries.push(
        await this.buildContainerSummary({
          container: inspected,
          desiredImageState,
          routePath,
          url: running
            ? externalPort
              ? this.config.getPublicUrlForPort(externalPort)
              : this.config.getPublicUrlForRoutePath(routePath)
            : null,
          runtimeUrl: running && externalPort ? this.config.getPublicUrlForPort(externalPort) : null,
          compatibilityUrl: this.config.getPublicUrlForRoutePath(routePath),
          cpuKind: this.config.cpuKindLabel,
          runtimeImageCache,
        }),
      );
    }

    summaries.sort((left, right) =>
      (right.createdAt || "").localeCompare(left.createdAt || ""),
    );
    return summaries;
  }

  async parkStudioMachine(machineId: string): Promise<StudioMachineParkResult> {
    const container = await this.inspectContainer(machineId);
    const identity = getContainerIdentity(container);
    if (!identity) {
      throw new Error(
        `[DockerMachines] Refusing to park non-studio container ${machineId}`,
      );
    }

    const routeId =
      getContainerRouteId(container) ||
      this.config.routeIdFor(
        identity.organizationId,
        identity.projectSlug,
        identity.version,
      );
    await this.stopContainerIfRunning(container);
    await this.routeService.removeRuntimeRoute(routeId);
    this.lastActivityByStudioKey.delete(
      this.config.key(identity.organizationId, identity.projectSlug, identity.version),
    );
    return "stopped";
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
    const container = await this.inspectContainer(machineId);
    const identity = getContainerIdentity(container);
    if (!identity) {
      throw new Error(
        `[DockerMachines] Refusing to destroy non-studio container ${machineId}`,
      );
    }

    const routeId =
      getContainerRouteId(container) ||
      this.config.routeIdFor(
        identity.organizationId,
        identity.projectSlug,
        identity.version,
      );
    await this.stopContainerIfRunning(container);
    await this.routeService.removeRuntimeRoute(routeId);
    await this.apiClient.removeContainer(container.Id);
    this.lastActivityByStudioKey.delete(
      this.config.key(identity.organizationId, identity.projectSlug, identity.version),
    );
  }

  private async warmReconcileContainer(options: {
    container: DockerContainerInfo;
    identity: StudioIdentity;
    desiredImage: string;
    desiredImageState: DockerResolvedImageState;
    desiredNetworkName: string;
  }): Promise<void> {
    const state = containerStateStatus(options.container);
    if (state === "dead" || state === "removing") return;

    const desiredMainBackendUrl = this.resolveManagedMainBackendUrl(
      getContainerEnv(options.container).MAIN_BACKEND_URL,
    );
    let reconcileState = resolveContainerReconcileState({
      container: options.container,
      desiredImage: options.desiredImage,
      desiredImageState: options.desiredImageState,
      desiredNanoCpus: this.config.nanoCpus,
      desiredMemoryBytes: this.config.memoryBytes,
      desiredNetworkName: options.desiredNetworkName,
      desiredMainBackendUrl,
      generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
    });
    const desiredEnvSubset = this.buildStudioEnvDriftSubset(
      this.buildStudioEnv({
        organizationId: options.identity.organizationId,
        projectSlug: options.identity.projectSlug,
        version: options.identity.version,
        env: {},
        studioId: getContainerStudioId(options.container),
        accessToken: reconcileState.accessToken,
      }),
      [],
    );
    reconcileState = resolveContainerReconcileState({
      container: options.container,
      desiredImage: options.desiredImage,
      desiredImageState: options.desiredImageState,
      desiredAccessToken: reconcileState.accessToken,
      desiredNanoCpus: this.config.nanoCpus,
      desiredMemoryBytes: this.config.memoryBytes,
      desiredNetworkName: options.desiredNetworkName,
      desiredMainBackendUrl,
      desiredEnvSubset,
      generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
    });

    if (!hasContainerDrift(reconcileState.needs)) return;
    if (isRunningContainer(options.container)) {
      throw new Error(
        `[DockerMachines] Refusing to warm reconcile running container ${options.container.Id} (state=${state})`,
      );
    }
    if (!isStoppedContainer(options.container)) {
      throw new Error(
        `[DockerMachines] Cannot warm reconcile container ${options.container.Id}; expected stopped state but got state=${state}`,
      );
    }

    const recreated = await this.recreateContainer({
      existing: options.container,
      args: {
        organizationId: options.identity.organizationId,
        projectSlug: options.identity.projectSlug,
        version: options.identity.version,
        env: {},
      },
      desiredImage: options.desiredImage,
      desiredImageState: options.desiredImageState,
      preferredAccessToken: reconcileState.accessToken,
    });
    const accessToken = getContainerAccessToken(recreated);
    if (!accessToken) {
      throw new Error(
        `[DockerMachines] Missing access token after warm reconcile for ${options.container.Id}`,
      );
    }

    await this.ensureContainerRunning(
      {
        organizationId: options.identity.organizationId,
        projectSlug: options.identity.projectSlug,
        version: options.identity.version,
        env: {},
      },
      recreated,
      accessToken,
      options.desiredImage,
    );
    await this.stop(
      options.identity.organizationId,
      options.identity.projectSlug,
      options.identity.version,
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
    const desiredImage = await this.getDesiredImage({
      forceRefresh: options.forceRefreshDesiredImage,
    });
    const desiredImageState = await this.getDesiredImageStateForRef(desiredImage, {
      forceRefresh: options.forceRefreshDesiredImage,
      preferPull: options.forceRefreshDesiredImage,
    });
    const containers = await this.apiClient.listContainers();
    const desiredNetworkName = await this.resolveContainerNetworkName();
    const now = Date.now();
    const dryRun = this.config.reconcilerDryRun;

    const result: StudioMachineReconcileResult = {
      desiredImage,
      scanned: 0,
      warmedOutdatedImages: 0,
      destroyedOldMachines: 0,
      skippedRunningMachines: 0,
      dryRun,
      errors: [],
    };

    const studioContainers = containers.flatMap((container) => {
      const identity = getContainerIdentity(container);
      return identity ? [{ container, identity }] : [];
    });
    result.scanned = studioContainers.length;

    const lastVisitedAtMsByStudioKey = await listStudioVisitMsByIdentity(
      studioContainers.map(({ identity }) => identity),
    );

    await mapLimit(
      studioContainers,
      this.config.reconcilerConcurrency,
      async ({ container, identity }) => {
        const studioKey = this.config.key(
          identity.organizationId,
          identity.projectSlug,
          identity.version,
        );
        const lastVisitedAtMs = lastVisitedAtMsByStudioKey.get(studioKey) ?? null;
        const inspected = await this.inspectContainer(container.Id);
        const createdAtMs = getContainerCreatedAt(inspected)
          ? Date.parse(getContainerCreatedAt(inspected)!)
          : Number.NaN;
        const inactivityMs = lastVisitedAtMs !== null ? now - lastVisitedAtMs : null;
        const createdAgeMs = Number.isFinite(createdAtMs) ? now - createdAtMs : null;
        const shouldGc =
          (inactivityMs !== null && inactivityMs >= this.config.maxMachineInactivityMs) ||
          (lastVisitedAtMs === null &&
            createdAgeMs !== null &&
            createdAgeMs >= this.config.maxMachineInactivityMs);

        if (shouldGc) {
          if (dryRun) return;
          try {
            await this.destroyStudioMachine(container.Id);
            result.destroyedOldMachines++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push({
              machineId: container.Id,
              action: "gc",
              message,
            });
          }
          return;
        }

        const desiredMainBackendUrl = this.resolveManagedMainBackendUrl(
          getContainerEnv(inspected).MAIN_BACKEND_URL,
        );
        const reconcileState = resolveContainerReconcileState({
          container: inspected,
          desiredImage,
          desiredImageState,
          desiredNanoCpus: this.config.nanoCpus,
          desiredMemoryBytes: this.config.memoryBytes,
          desiredNetworkName,
          desiredMainBackendUrl,
          generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
        });
        if (!hasContainerDrift(reconcileState.needs)) return;

        if (isRunningContainer(inspected)) {
          result.skippedRunningMachines++;
          return;
        }

        if (!this.config.warmOutdatedImages) return;
        if (dryRun) return;

        try {
          await this.warmReconcileContainer({
            container: inspected,
            identity,
            desiredImage,
            desiredImageState,
            desiredNetworkName,
          });
          result.warmedOutdatedImages++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push({
            machineId: container.Id,
            action: "warm_reconciled_machine",
            message,
          });
        }
      },
    );

    return result;
  }
}
