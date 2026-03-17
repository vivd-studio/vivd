import { listStudioVisitMsByIdentity } from "../visitStore";
import type {
  ManagedStudioMachineProvider,
  StudioMachineReconcileResult,
  StudioMachineRestartArgs,
  StudioMachineStartArgs,
  StudioMachineStartResult,
  StudioMachineSummary,
  StudioMachineUrlResult,
} from "../types";
import {
  STUDIO_ACCESS_TOKEN_ENV_KEY,
  trimToken,
} from "../fly/machineModel";
import { DockerApiClient } from "./apiClient";
import { DockerProviderConfig } from "./providerConfig";
import { DockerStudioImageResolver } from "./imageResolver";
import { DockerRuntimeRouteService } from "./runtimeRouteService";
import type {
  DockerContainerCreateConfig,
  DockerContainerInfo,
  DockerContainerStateStatus,
  DockerContainerSummary,
} from "./types";
import { sleep } from "../fly/utils";

type StudioIdentity = {
  organizationId: string;
  projectSlug: string;
  version: number;
};

type ContainerReconcileNeeds = {
  image: boolean;
  resources: boolean;
  accessToken: boolean;
};

const STUDIO_INTERNAL_PORT = 3100;
const DEFAULT_ENV_PASSTHROUGH =
  "GOOGLE_API_KEY,OPENROUTER_API_KEY,GOOGLE_CLOUD_PROJECT,VERTEX_LOCATION,GOOGLE_APPLICATION_CREDENTIALS,GOOGLE_APPLICATION_CREDENTIALS_JSON,VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH,OPENCODE_MODEL,OPENCODE_MODELS,R2_ENDPOINT,R2_BUCKET,R2_ACCESS_KEY,R2_SECRET_KEY,VIVD_S3_BUCKET,VIVD_S3_ENDPOINT_URL,VIVD_S3_PREFIX,VIVD_S3_SOURCE_URI,VIVD_S3_OPENCODE_PREFIX,VIVD_S3_OPENCODE_URI,VIVD_S3_OPENCODE_STORAGE_URI,VIVD_S3_SYNC_INTERVAL_SECONDS,VIVD_SYNC_TRIGGER_FILE,VIVD_SYNC_PAUSE_FILE,VIVD_SYNC_PAUSE_MAX_AGE_SECONDS,VIVD_SHUTDOWN_SYNC_BUDGET_SECONDS,VIVD_SHUTDOWN_CHILD_WAIT_SECONDS,AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,AWS_SESSION_TOKEN,AWS_DEFAULT_REGION,AWS_REGION,DEVSERVER_INSTALL_TIMEOUT_MS,VIVD_PACKAGE_CACHE_DIR,DEVSERVER_NODE_MODULES_CACHE,GITHUB_SYNC_ENABLED,GITHUB_SYNC_STRICT,GITHUB_ORG,GITHUB_TOKEN,GITHUB_REPO_PREFIX,GITHUB_REPO_VISIBILITY,GITHUB_API_URL,GITHUB_GIT_HOST,GITHUB_REMOTE_NAME";

function parseEnvList(values: string[] | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const value of values || []) {
    const idx = value.indexOf("=");
    if (idx <= 0) continue;
    env[value.slice(0, idx)] = value.slice(idx + 1);
  }
  return env;
}

function isContainerInfo(
  container: DockerContainerSummary | DockerContainerInfo,
): container is DockerContainerInfo {
  return "Config" in container || "HostConfig" in container || "Name" in container;
}

function getContainerLabels(
  container: DockerContainerSummary | DockerContainerInfo,
): Record<string, string> {
  return (isContainerInfo(container) ? container.Config?.Labels : container.Labels) || {};
}

function getContainerEnv(
  container: DockerContainerInfo,
): Record<string, string> {
  return parseEnvList(container.Config?.Env);
}

function getContainerName(
  container: DockerContainerSummary | DockerContainerInfo,
): string | null {
  if (isContainerInfo(container) && typeof container.Name === "string" && container.Name.trim()) {
    return container.Name.replace(/^\/+/, "");
  }
  if ("Names" in container && Array.isArray(container.Names) && container.Names.length > 0) {
    const first = container.Names[0];
    if (typeof first === "string" && first.trim()) {
      return first.replace(/^\/+/, "");
    }
  }
  return null;
}

function getContainerConfiguredImage(
  container: DockerContainerSummary | DockerContainerInfo,
  desiredImage?: string,
): string | null {
  const labels = getContainerLabels(container);
  const fromLabel = trimToken(labels["vivd_image"]);
  if (fromLabel) return fromLabel;

  const raw =
    (isContainerInfo(container)
      ? trimToken(container.Config?.Image)
      : trimToken(container.Image)) || null;
  if (!raw) return null;

  const digestIndex = !desiredImage?.includes("@") ? raw.indexOf("@") : -1;
  return digestIndex === -1 ? raw : trimToken(raw.slice(0, digestIndex));
}

function getContainerAccessToken(container: DockerContainerInfo): string | null {
  return trimToken(getContainerEnv(container)[STUDIO_ACCESS_TOKEN_ENV_KEY]);
}

function getContainerIdentity(
  container: DockerContainerSummary | DockerContainerInfo,
): StudioIdentity | null {
  const labels = getContainerLabels(container);
  const env = isContainerInfo(container) ? getContainerEnv(container) : {};

  const organizationId =
    trimToken(labels["vivd_organization_id"]) ||
    trimToken(env.VIVD_TENANT_ID) ||
    "default";
  const projectSlug =
    trimToken(labels["vivd_project_slug"]) ||
    trimToken(env.VIVD_PROJECT_SLUG);
  const versionRaw =
    trimToken(labels["vivd_project_version"]) ||
    trimToken(env.VIVD_PROJECT_VERSION);
  const version = versionRaw ? Number.parseInt(versionRaw, 10) : Number.NaN;

  if (!projectSlug || !Number.isFinite(version) || version <= 0) return null;
  return { organizationId, projectSlug, version };
}

function getContainerStudioId(
  container: DockerContainerInfo,
  fallback?: string | null,
): string {
  const labels = getContainerLabels(container);
  const env = getContainerEnv(container);
  return (
    trimToken(labels["vivd_studio_id"]) ||
    trimToken(env.STUDIO_ID) ||
    trimToken(fallback) ||
    crypto.randomUUID()
  );
}

function getContainerRouteId(
  container: DockerContainerSummary | DockerContainerInfo,
): string | null {
  return trimToken(getContainerLabels(container)["vivd_route_id"]);
}

function containerStateStatus(
  container: DockerContainerSummary | DockerContainerInfo,
): DockerContainerStateStatus {
  const raw =
    ("State" in container && typeof container.State === "object"
      ? container.State?.Status
      : undefined) ||
    ("State" in container && typeof container.State === "string"
      ? container.State
      : undefined) ||
    "unknown";
  return raw;
}

function mapContainerState(
  container: DockerContainerSummary | DockerContainerInfo,
): string | null {
  const raw = containerStateStatus(container);
  if (raw === "running") return "started";
  if (raw === "restarting") return "starting";
  if (raw === "removing") return "destroying";
  if (raw === "exited") return "stopped";
  if (raw === "dead") return "destroyed";
  return raw || null;
}

function isRunningContainer(
  container: DockerContainerSummary | DockerContainerInfo,
): boolean {
  return containerStateStatus(container) === "running";
}

function isStoppedContainer(
  container: DockerContainerSummary | DockerContainerInfo,
): boolean {
  const state = containerStateStatus(container);
  return state === "created" || state === "exited";
}

function resolveContainerReconcileState(options: {
  container: DockerContainerInfo;
  desiredImage: string;
  desiredAccessToken?: string | null;
  desiredNanoCpus: number;
  desiredMemoryBytes: number;
  generateStudioAccessToken: () => string;
}): { accessToken: string; needs: ContainerReconcileNeeds } {
  const currentToken = getContainerAccessToken(options.container);
  const desiredToken = trimToken(options.desiredAccessToken);
  const accessToken =
    currentToken || desiredToken || options.generateStudioAccessToken();

  const currentImage = getContainerConfiguredImage(options.container, options.desiredImage);
  const currentNanoCpus = options.container.HostConfig?.NanoCpus || 0;
  const currentMemory = options.container.HostConfig?.Memory || 0;

  return {
    accessToken,
    needs: {
      image: currentImage !== options.desiredImage,
      resources:
        currentNanoCpus !== options.desiredNanoCpus ||
        currentMemory !== options.desiredMemoryBytes,
      accessToken: currentToken !== accessToken,
    },
  };
}

function hasContainerDrift(needs: ContainerReconcileNeeds): boolean {
  return needs.image || needs.resources || needs.accessToken;
}

function getContainerCreatedAt(container: DockerContainerInfo): string | null {
  const raw = trimToken(container.Created);
  return raw || null;
}

function getContainerUpdatedAt(container: DockerContainerInfo): string | null {
  const startedAt = trimToken(container.State?.StartedAt);
  if (startedAt && startedAt !== "0001-01-01T00:00:00Z") return startedAt;
  const finishedAt = trimToken(container.State?.FinishedAt);
  if (finishedAt && finishedAt !== "0001-01-01T00:00:00Z") return finishedAt;
  return getContainerCreatedAt(container);
}

function summaryFromContainer(options: {
  container: DockerContainerInfo;
  desiredImage: string;
  routePath: string | null;
  url: string | null;
  cpuKind: string;
}): StudioMachineSummary {
  const identity = getContainerIdentity(options.container);
  if (!identity) {
    throw new Error(
      `[DockerMachines] Refusing to summarize non-studio container ${options.container.Id}`,
    );
  }

  const configuredImage = getContainerConfiguredImage(
    options.container,
    options.desiredImage,
  );
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
    externalPort: null,
    routePath: options.routePath,
    url: options.url,
    image: configuredImage,
    desiredImage: options.desiredImage,
    imageOutdated: !!configuredImage && configuredImage !== options.desiredImage,
    createdAt: getContainerCreatedAt(options.container),
    updatedAt: getContainerUpdatedAt(options.container),
  };
}

function findContainer(
  containers: DockerContainerSummary[],
  organizationId: string,
  projectSlug: string,
  version: number,
): DockerContainerSummary | null {
  return (
    containers.find((container) => {
      const identity = getContainerIdentity(container);
      return (
        identity?.organizationId === organizationId &&
        identity.projectSlug === projectSlug &&
        identity.version === version
      );
    }) || null
  );
}

function createContainerSpec(options: {
  args: StudioMachineStartArgs;
  studioId: string;
  accessToken: string;
  desiredImage: string;
  routeId: string;
  env: Record<string, string>;
  config: DockerProviderConfig;
}): DockerContainerCreateConfig {
  const labels: Record<string, string> = {
    vivd_managed: "true",
    vivd_provider: "docker",
    vivd_organization_id: options.args.organizationId,
    vivd_project_slug: options.args.projectSlug,
    vivd_project_version: String(options.args.version),
    vivd_studio_id: options.studioId,
    vivd_image: options.desiredImage,
    vivd_route_id: options.routeId,
    vivd_created_at: new Date().toISOString(),
  };

  return {
    Image: options.desiredImage,
    Env: Object.entries(options.env).map(([key, value]) => `${key}=${value}`),
    Labels: labels,
    StopTimeout: options.config.desiredKillTimeoutSeconds,
    ExposedPorts: {
      [`${STUDIO_INTERNAL_PORT}/tcp`]: {},
    },
    HostConfig: {
      NetworkMode: options.config.network,
      NanoCpus: options.config.nanoCpus,
      Memory: options.config.memoryBytes,
    },
  };
}

import crypto from "node:crypto";

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
  private reconcilerInterval: NodeJS.Timeout | null = null;
  private reconcileInFlight: Promise<StudioMachineReconcileResult> | null = null;
  private idleCleanupInterval: NodeJS.Timeout | null = null;
  private lastActivityByStudioKey = new Map<string, number>();
  private idleStopInFlight = new Set<string>();

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
      void this.reconcileStudioMachines().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[DockerMachines] Reconciler failed: ${message}`);
      });
    }, this.config.reconcilerIntervalMs);
    this.reconcilerInterval.unref?.();

    void this.reconcileStudioMachines().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[DockerMachines] Reconciler failed: ${message}`);
    });
  }

  invalidateDesiredImageCache(): void {
    this.imageResolver.invalidateDesiredImageCache();
  }

  async getDesiredImage(options?: { forceRefresh?: boolean }): Promise<string> {
    return await this.imageResolver.getDesiredImage(options);
  }

  private touchKey(studioKey: string): void {
    this.lastActivityByStudioKey.set(studioKey, Date.now());
  }

  private buildStudioEnv(
    args: StudioMachineStartArgs & { studioId: string; accessToken: string },
  ): Record<string, string> {
    const workspaceDir =
      process.env.DOCKER_STUDIO_WORKSPACE_DIR || "/home/studio/project";

    const env: Record<string, string> = {
      PORT: String(STUDIO_INTERNAL_PORT),
      STUDIO_ID: args.studioId,
      [STUDIO_ACCESS_TOKEN_ENV_KEY]: args.accessToken,
      VIVD_TENANT_ID: args.organizationId,
      VIVD_PROJECT_SLUG: args.projectSlug,
      VIVD_PROJECT_VERSION: String(args.version),
      VIVD_WORKSPACE_DIR: workspaceDir,
      DEV_SERVER_PORT_START: "5100",
      OPENCODE_PORT_START: "4096",
      OPENCODE_IDLE_TIMEOUT_MS: "0",
    };

    const explicitEnvKeys = new Set(Object.keys(args.env));
    for (const [key, value] of Object.entries(args.env)) {
      if (typeof value === "string") env[key] = value;
    }

    if (
      !env.VIVD_OPENCODE_DATA_HOME &&
      process.env.DOCKER_STUDIO_OPENCODE_DATA_HOME
    ) {
      env.VIVD_OPENCODE_DATA_HOME = process.env.DOCKER_STUDIO_OPENCODE_DATA_HOME;
    }

    const passthrough = (
      process.env.DOCKER_STUDIO_ENV_PASSTHROUGH || DEFAULT_ENV_PASSTHROUGH
    )
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);

    for (const key of passthrough) {
      if (explicitEnvKeys.has(key)) continue;
      const value = process.env[key];
      if (value) env[key] = value;
    }

    if (env.GOOGLE_CLOUD_PROJECT && !env.VERTEX_LOCATION) {
      env.VERTEX_LOCATION = "global";
    }

    if (!env.VIVD_SHUTDOWN_SYNC_BUDGET_SECONDS) {
      env.VIVD_SHUTDOWN_SYNC_BUDGET_SECONDS = String(
        Math.max(5, this.config.desiredKillTimeoutSeconds - 5),
      );
    }

    return env;
  }

  private async inspectContainer(
    containerId: string,
  ): Promise<DockerContainerInfo> {
    return await this.apiClient.inspectContainer(containerId);
  }

  private async waitForReady(options: {
    containerId: string;
    routePath: string;
    timeoutMs: number;
  }): Promise<void> {
    const healthUrl = new URL(
      "health",
      `${this.config.getInternalProxyUrlForRoutePath(options.routePath)}/`,
    ).toString();
    const deadline = Date.now() + options.timeoutMs;

    while (Date.now() < deadline) {
      const container = await this.inspectContainer(options.containerId).catch(
        () => null,
      );
      const state = container ? containerStateStatus(container) : "unknown";
      if (state === "exited" || state === "dead") {
        throw new Error(
          `[DockerMachines] Container ${options.containerId} stopped while waiting for readiness`,
        );
      }

      try {
        const response = await fetch(healthUrl, {
          method: "GET",
          cache: "no-store",
        });
        if (response.ok) return;
      } catch {
        // Retry until timeout.
      }

      await sleep(1_000);
    }

    throw new Error(
      `[DockerMachines] Timed out waiting for studio to become ready (${options.containerId})`,
    );
  }

  private async stopContainerIfRunning(container: DockerContainerInfo): Promise<void> {
    if (!isRunningContainer(container)) return;
    await this.apiClient.stopContainer(
      container.Id,
      this.config.desiredKillTimeoutSeconds,
    );
  }

  private async createFreshContainer(options: {
    args: StudioMachineStartArgs;
    desiredImage: string;
    preferredAccessToken?: string | null;
    preserveStudioIdFrom?: DockerContainerInfo | null;
  }): Promise<DockerContainerInfo> {
    const studioId =
      options.preserveStudioIdFrom
        ? getContainerStudioId(options.preserveStudioIdFrom)
        : options.args.env.STUDIO_ID || crypto.randomUUID();
    const accessToken =
      trimToken(options.preferredAccessToken) ||
      getContainerAccessToken(options.preserveStudioIdFrom || ({} as DockerContainerInfo)) ||
      this.config.generateStudioAccessToken();
    const routeId = this.config.routeIdFor(
      options.args.organizationId,
      options.args.projectSlug,
      options.args.version,
    );
    const env = this.buildStudioEnv({
      ...options.args,
      studioId,
      accessToken,
    });
    const spec = createContainerSpec({
      args: options.args,
      studioId,
      accessToken,
      desiredImage: options.desiredImage,
      routeId,
      env,
      config: this.config,
    });

    try {
      const created = await this.apiClient.createContainer({
        name: this.config.containerNameFor(
          options.args.organizationId,
          options.args.projectSlug,
          options.args.version,
        ),
        config: spec,
      });
      return await this.inspectContainer(created.Id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("container name")) {
        throw error;
      }

      const existing = findContainer(
        await this.apiClient.listContainers(),
        options.args.organizationId,
        options.args.projectSlug,
        options.args.version,
      );
      if (!existing) throw error;
      return await this.inspectContainer(existing.Id);
    }
  }

  private async recreateContainer(options: {
    existing: DockerContainerInfo;
    args: StudioMachineStartArgs;
    desiredImage: string;
    preferredAccessToken?: string | null;
  }): Promise<DockerContainerInfo> {
    await this.stopContainerIfRunning(options.existing);
    await this.apiClient.removeContainer(options.existing.Id);
    return await this.createFreshContainer({
      args: options.args,
      desiredImage: options.desiredImage,
      preferredAccessToken: options.preferredAccessToken,
      preserveStudioIdFrom: options.existing,
    });
  }

  private async ensureContainerRunning(
    args: StudioMachineStartArgs,
    container: DockerContainerInfo,
    accessToken: string,
  ): Promise<StudioMachineStartResult> {
    const studioKey = this.config.key(
      args.organizationId,
      args.projectSlug,
      args.version,
    );
    const routeId =
      getContainerRouteId(container) ||
      this.config.routeIdFor(args.organizationId, args.projectSlug, args.version);
    const routePath = await this.routeService.upsertRuntimeRoute({
      routeId,
      containerName:
        getContainerName(container) ||
        this.config.containerNameFor(args.organizationId, args.projectSlug, args.version),
      targetPort: STUDIO_INTERNAL_PORT,
    });

    if (!isRunningContainer(container)) {
      await this.apiClient.startContainer(container.Id);
    }

    await this.waitForReady({
      containerId: container.Id,
      routePath,
      timeoutMs: this.config.startTimeoutMs,
    });

    const url = this.config.getPublicUrlForRoutePath(routePath);
    this.touchKey(studioKey);
    return {
      studioId: getContainerStudioId(container, args.env.STUDIO_ID),
      url,
      accessToken,
    };
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
    const containers = await this.apiClient.listContainers();
    const existing = findContainer(
      containers,
      args.organizationId,
      args.projectSlug,
      args.version,
    );
    const desiredImage = await this.getDesiredImage();

    if (!existing) {
      const created = await this.createFreshContainer({
        args,
        desiredImage,
      });
      const accessToken = getContainerAccessToken(created);
      if (!accessToken) {
        throw new Error(
          `[DockerMachines] Missing studio access token after creating container ${created.Id}`,
        );
      }
      return await this.ensureContainerRunning(args, created, accessToken);
    }

    let inspected = await this.inspectContainer(existing.Id);
    let reconcileState = resolveContainerReconcileState({
      container: inspected,
      desiredImage,
      desiredNanoCpus: this.config.nanoCpus,
      desiredMemoryBytes: this.config.memoryBytes,
      generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
    });

    if (isRunningContainer(inspected)) {
      if (reconcileState.needs.accessToken) {
        inspected = await this.recreateContainer({
          existing: inspected,
          args,
          desiredImage,
          preferredAccessToken: reconcileState.accessToken,
        });
        reconcileState = resolveContainerReconcileState({
          container: inspected,
          desiredImage,
          desiredNanoCpus: this.config.nanoCpus,
          desiredMemoryBytes: this.config.memoryBytes,
          desiredAccessToken: reconcileState.accessToken,
          generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
        });
      }

      return await this.ensureContainerRunning(args, inspected, reconcileState.accessToken);
    }

    if (!isStoppedContainer(inspected) || hasContainerDrift(reconcileState.needs)) {
      inspected = await this.recreateContainer({
        existing: inspected,
        args,
        desiredImage,
        preferredAccessToken: reconcileState.accessToken,
      });
      reconcileState = resolveContainerReconcileState({
        container: inspected,
        desiredImage,
        desiredNanoCpus: this.config.nanoCpus,
        desiredMemoryBytes: this.config.memoryBytes,
        desiredAccessToken: reconcileState.accessToken,
        generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
      });
    }

    return await this.ensureContainerRunning(args, inspected, reconcileState.accessToken);
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
    const existing = findContainer(
      await this.apiClient.listContainers(),
      args.organizationId,
      args.projectSlug,
      args.version,
    );
    const desiredImage = await this.getDesiredImage();

    let container: DockerContainerInfo;
    if (existing) {
      container = await this.recreateContainer({
        existing: await this.inspectContainer(existing.Id),
        args,
        desiredImage,
      });
    } else {
      container = await this.createFreshContainer({
        args,
        desiredImage,
      });
    }

    const accessToken = getContainerAccessToken(container);
    if (!accessToken) {
      throw new Error(
        `[DockerMachines] Missing studio access token after restarting container ${container.Id}`,
      );
    }
    return await this.ensureContainerRunning(args, container, accessToken);
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
    return {
      url: this.config.getPublicUrlForRoutePath(routePath),
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

  async listStudioMachines(): Promise<StudioMachineSummary[]> {
    const desiredImage = await this.getDesiredImage();
    const containers = await this.apiClient.listContainers();
    const summaries: StudioMachineSummary[] = [];

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
      summaries.push(
        summaryFromContainer({
          container: inspected,
          desiredImage,
          routePath,
          url: running ? this.config.getPublicUrlForRoutePath(routePath) : null,
          cpuKind: this.config.cpuKindLabel,
        }),
      );
    }

    summaries.sort((left, right) =>
      (right.createdAt || "").localeCompare(left.createdAt || ""),
    );
    return summaries;
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
    const containers = await this.apiClient.listContainers();
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

    for (const { container, identity } of studioContainers) {
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
        if (dryRun) continue;
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
        continue;
      }

      const reconcileState = resolveContainerReconcileState({
        container: inspected,
        desiredImage,
        desiredNanoCpus: this.config.nanoCpus,
        desiredMemoryBytes: this.config.memoryBytes,
        generateStudioAccessToken: () => this.config.generateStudioAccessToken(),
      });
      if (!hasContainerDrift(reconcileState.needs)) continue;

      if (isRunningContainer(inspected)) {
        result.skippedRunningMachines++;
        continue;
      }

      if (!this.config.warmOutdatedImages) continue;
      if (dryRun) continue;

      try {
        const recreated = await this.recreateContainer({
          existing: inspected,
          args: {
            organizationId: identity.organizationId,
            projectSlug: identity.projectSlug,
            version: identity.version,
            env: {},
          },
          desiredImage,
          preferredAccessToken: reconcileState.accessToken,
        });
        const accessToken = getContainerAccessToken(recreated);
        if (!accessToken) {
          throw new Error(
            `[DockerMachines] Missing access token after warm reconcile for ${container.Id}`,
          );
        }
        await this.ensureContainerRunning(
          {
            organizationId: identity.organizationId,
            projectSlug: identity.projectSlug,
            version: identity.version,
            env: {},
          },
          recreated,
          accessToken,
        );
        await this.stop(identity.organizationId, identity.projectSlug, identity.version);
        result.warmedOutdatedImages++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({
          machineId: container.Id,
          action: "warm_reconciled_machine",
          message,
        });
      }
    }

    return result;
  }
}
