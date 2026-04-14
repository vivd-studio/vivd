import crypto from "node:crypto";
import net from "node:net";
import type {
  StudioMachineRestartArgs,
  StudioMachineStartArgs,
  StudioMachineStartResult,
} from "../types";
import { sleep } from "../fly/utils";
import {
  STUDIO_ACCESS_TOKEN_ENV_KEY,
  trimToken,
} from "../fly/machineModel";
import {
  getDefinedStudioMachineEnv,
  parseStudioMachineEnvKeyList,
  withMissingStudioMachineEnvKeys,
} from "../env";
import {
  createContainerSpec,
  findContainer,
  getContainerAccessToken,
  getContainerExternalPort,
  getContainerIdentity,
  getContainerName,
  getContainerRouteId,
  getContainerStudioId,
  hasContainerDrift,
  isContainerNameConflictError,
  isContainerNetworkingSetupError,
  isContainerPortConflictError,
  isMissingImageError,
  isMissingNativeManifestError,
  isRunningContainer,
  isStoppedContainer,
  resolveContainerReconcileState,
  STUDIO_INTERNAL_PORT,
  type DockerResolvedImageState,
} from "./containerModel";
import type {
  DockerContainerCreateConfig,
  DockerContainerCreateResponse,
  DockerContainerInfo,
  DockerContainerSummary,
  DockerNetworkSummary,
} from "./types";

const DEFAULT_ENV_PASSTHROUGH =
  "GOOGLE_API_KEY,OPENROUTER_API_KEY,GOOGLE_CLOUD_PROJECT,VERTEX_LOCATION,GOOGLE_APPLICATION_CREDENTIALS,GOOGLE_APPLICATION_CREDENTIALS_JSON,VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH,OPENCODE_MODEL_STANDARD,OPENCODE_MODEL_STANDARD_VARIANT,OPENCODE_MODEL_ADVANCED,OPENCODE_MODEL_ADVANCED_VARIANT,OPENCODE_MODEL_PRO,OPENCODE_MODEL_PRO_VARIANT,R2_ENDPOINT,R2_BUCKET,R2_ACCESS_KEY,R2_SECRET_KEY,VIVD_BUCKET_MODE,VIVD_LOCAL_S3_BUCKET,VIVD_LOCAL_S3_ENDPOINT_URL,VIVD_LOCAL_S3_ACCESS_KEY,VIVD_LOCAL_S3_SECRET_KEY,VIVD_LOCAL_S3_REGION,VIVD_S3_BUCKET,VIVD_S3_ENDPOINT_URL,VIVD_S3_ACCESS_KEY_ID,VIVD_S3_SECRET_ACCESS_KEY,VIVD_S3_SESSION_TOKEN,VIVD_S3_REGION,VIVD_S3_PREFIX,VIVD_S3_SOURCE_URI,VIVD_S3_OPENCODE_PREFIX,VIVD_S3_OPENCODE_URI,VIVD_S3_OPENCODE_STORAGE_URI,VIVD_S3_SYNC_INTERVAL_SECONDS,VIVD_SYNC_TRIGGER_FILE,VIVD_SYNC_PAUSE_FILE,VIVD_SYNC_PAUSE_MAX_AGE_SECONDS,VIVD_SHUTDOWN_SYNC_BUDGET_SECONDS,VIVD_SHUTDOWN_CHILD_WAIT_SECONDS,AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,AWS_SESSION_TOKEN,AWS_DEFAULT_REGION,AWS_REGION,DEVSERVER_INSTALL_TIMEOUT_MS,VIVD_PACKAGE_CACHE_DIR,DEVSERVER_NODE_MODULES_CACHE,GITHUB_SYNC_ENABLED,GITHUB_SYNC_STRICT,GITHUB_ORG,GITHUB_TOKEN,GITHUB_REPO_PREFIX,GITHUB_REPO_VISIBILITY,GITHUB_API_URL,GITHUB_GIT_HOST,GITHUB_REMOTE_NAME";

function getConfiguredDockerStudioEnvPassthroughKeys(): string[] {
  return parseStudioMachineEnvKeyList(
    process.env.DOCKER_STUDIO_ENV_PASSTHROUGH || DEFAULT_ENV_PASSTHROUGH,
  );
}

function isPortAvailable(port: number, hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.on("error", () => resolve(false));
    server.listen({ port, host: hostname }, () => {
      server.close(() => resolve(true));
    });
  });
}

export function resolveManagedMainBackendUrl(
  raw: string | null | undefined,
  internalMainBackendUrl: string,
): string | null {
  return trimToken(raw) ? internalMainBackendUrl : null;
}

export function buildStudioEnvWorkflow(
  deps: {
    desiredKillTimeoutSeconds: number;
    internalMainBackendUrl: string;
  },
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

  const definedEnv = getDefinedStudioMachineEnv(args.env);
  const explicitEnvKeys = new Set(Object.keys(args.env));
  for (const [key, value] of Object.entries(definedEnv)) {
    env[key] = value;
  }

  if (
    !env.VIVD_OPENCODE_DATA_HOME &&
    process.env.DOCKER_STUDIO_OPENCODE_DATA_HOME
  ) {
    env.VIVD_OPENCODE_DATA_HOME = process.env.DOCKER_STUDIO_OPENCODE_DATA_HOME;
  }

  if (env.MAIN_BACKEND_URL) {
    env.MAIN_BACKEND_URL =
      resolveManagedMainBackendUrl(
        env.MAIN_BACKEND_URL,
        deps.internalMainBackendUrl,
      ) || env.MAIN_BACKEND_URL;
  } else {
    env.MAIN_BACKEND_URL = deps.internalMainBackendUrl;
  }

  const passthrough = getConfiguredDockerStudioEnvPassthroughKeys();

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
      Math.max(5, deps.desiredKillTimeoutSeconds - 5),
    );
  }

  return env;
}

export function buildStudioEnvDriftSubsetFromDesiredEnv(
  desiredEnv: Record<string, string>,
  explicitEnvKeys: Iterable<string>,
): Record<string, string> {
  const subset = { ...desiredEnv };
  delete subset[STUDIO_ACCESS_TOKEN_ENV_KEY];

  const managedMissingKeys = new Set<string>();
  const explicitKeys = new Set(explicitEnvKeys);

  for (const key of getConfiguredDockerStudioEnvPassthroughKeys()) {
    if (!explicitKeys.has(key)) {
      managedMissingKeys.add(key);
    }
  }

  if (!explicitKeys.has("VIVD_OPENCODE_DATA_HOME")) {
    managedMissingKeys.add("VIVD_OPENCODE_DATA_HOME");
  }

  managedMissingKeys.add(STUDIO_ACCESS_TOKEN_ENV_KEY);

  return withMissingStudioMachineEnvKeys(subset, managedMissingKeys);
}

export function resolveNetworkNameFromList(
  configuredNetwork: string,
  networks: DockerNetworkSummary[],
  warn: (message: string) => void,
  preferredNetworkName?: string | null,
): string {
  const normalizedConfigured = configuredNetwork.trim();
  if (!normalizedConfigured) return configuredNetwork;

  const exactMatch = networks.find(
    (network) => network.Name?.trim() === normalizedConfigured,
  );
  if (exactMatch?.Name) return exactMatch.Name;

  const suffixMatches = networks.filter((network) => {
    const name = network.Name?.trim();
    return !!name && name.endsWith(`_${normalizedConfigured}`);
  });
  if (suffixMatches.length === 1 && suffixMatches[0]?.Name) {
    const resolved = suffixMatches[0].Name;
    warn(
      `[DockerMachines] Resolved configured network ${normalizedConfigured} to existing Docker network ${resolved}`,
    );
    return resolved;
  }

  const normalizedPreferred = preferredNetworkName?.trim() || "";
  if (suffixMatches.length > 1 && normalizedPreferred) {
    const preferredMatch = suffixMatches.find(
      (network) => network.Name?.trim() === normalizedPreferred,
    );
    if (preferredMatch?.Name) {
      warn(
        `[DockerMachines] Resolved configured network ${normalizedConfigured} to preferred Docker network ${preferredMatch.Name}`,
      );
      return preferredMatch.Name;
    }
  }

  return configuredNetwork;
}

export async function resolveContainerNetworkNameWorkflow(deps: {
  configuredNetwork: string;
  listNetworks: () => Promise<DockerNetworkSummary[]>;
  warn: (message: string) => void;
  getPreferredNetworkName?: () => Promise<string | null>;
}): Promise<string> {
  try {
    const networks = await deps.listNetworks();
    const suffixMatches = networks.filter((network) => {
      const name = network.Name?.trim();
      const normalizedConfigured = deps.configuredNetwork.trim();
      return !!name && !!normalizedConfigured && name.endsWith(`_${normalizedConfigured}`);
    });
    const preferredNetworkName =
      suffixMatches.length > 1 && deps.getPreferredNetworkName
        ? await deps.getPreferredNetworkName()
        : null;
    return resolveNetworkNameFromList(
      deps.configuredNetwork,
      networks,
      deps.warn,
      preferredNetworkName,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.warn(
      `[DockerMachines] Failed to resolve Docker network ${deps.configuredNetwork}: ${message}`,
    );
    return deps.configuredNetwork;
  }
}

export async function ensureImageAvailableForCreateWorkflow(deps: {
  desiredImage: string;
  fallbackPlatform: string | null;
  pullImage: (
    image: string,
    options?: { platform?: string },
  ) => Promise<void>;
  warn: (message: string) => void;
}): Promise<string | null> {
  try {
    await deps.pullImage(deps.desiredImage);
    return null;
  } catch (error) {
    if (!isMissingNativeManifestError(error)) throw error;

    const fallbackPlatform = deps.fallbackPlatform;
    if (!fallbackPlatform) throw error;

    deps.warn(
      `[DockerMachines] Native manifest unavailable for ${deps.desiredImage}; retrying pull with fallback platform ${fallbackPlatform}`,
    );
    await deps.pullImage(deps.desiredImage, {
      platform: fallbackPlatform,
    });
    return fallbackPlatform;
  }
}

export async function allocatePublicPortWorkflow(deps: {
  listContainers: () => Promise<DockerContainerSummary[]>;
  nextPortCandidate: () => number;
  warn: (message: string) => void;
  hostIp: string;
}): Promise<number> {
  const reservedPorts = new Set<number>();

  try {
    const containers = await deps.listContainers();
    for (const container of containers) {
      if (!getContainerIdentity(container)) continue;
      const port = getContainerExternalPort(container);
      if (port) reservedPorts.add(port);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.warn(
      `[DockerMachines] Failed to read reserved public ports from Docker; falling back to bind checks only: ${message}`,
    );
  }

  for (let attempt = 0; attempt < 200; attempt++) {
    const port = deps.nextPortCandidate();
    if (reservedPorts.has(port)) continue;
    if (await isPortAvailable(port, deps.hostIp)) {
      return port;
    }
  }

  throw new Error("[DockerMachines] Could not allocate a public port for studio runtime");
}

export type WaitForReadyOptions = {
  containerId: string;
  routePath: string | null;
  timeoutMs: number;
};

function summarizeRecentLogs(logs: string | null | undefined): string | null {
  const normalized = (logs || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  const lines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const maxLines = 40;
  const maxChars = 4_000;
  let summary = lines.slice(-maxLines).join("\n");
  if (summary.length > maxChars) {
    summary = summary.slice(summary.length - maxChars);
  }
  if (summary !== normalized) {
    summary = `...\n${summary}`;
  }
  return summary;
}

async function buildReadinessFailureMessage(deps: {
  getContainerLogs: (containerId: string, tail?: number) => Promise<string | null>;
}, options: {
  containerId: string;
  container: DockerContainerInfo | null;
  reason: "stopped" | "timeout";
}): Promise<string> {
  const state = options.container?.State?.Status || "unknown";
  const exitCode = options.container?.State?.ExitCode;
  const image =
    options.container?.Config?.Image || options.container?.Image || "unknown";
  const name = options.container
    ? getContainerName(options.container) || options.containerId
    : options.containerId;

  let message =
    options.reason === "stopped"
      ? `[DockerMachines] Container ${options.containerId} (${name}) stopped while waiting for readiness`
      : `[DockerMachines] Timed out waiting for studio to become ready (${options.containerId}, name=${name}, state=${state}, image=${image})`;

  if (typeof exitCode === "number") {
    message += ` (exitCode=${exitCode})`;
  }

  try {
    const logs = summarizeRecentLogs(
      await deps.getContainerLogs(options.containerId, 120),
    );
    if (logs) {
      message += `\nRecent container logs:\n${logs}`;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    message += `\nRecent container logs unavailable: ${detail}`;
  }

  return message;
}

export function getDirectContainerBaseUrl(
  container: DockerContainerInfo | DockerContainerSummary,
): string | null {
  const containerName = getContainerName(container);
  if (!containerName) return null;
  return `http://${containerName}:${STUDIO_INTERNAL_PORT}`;
}

type StudioHealthPayload = {
  status?: string;
  initialized?: boolean;
};

async function isStudioHealthReadyResponse(response: Response): Promise<boolean> {
  if (!response.ok) return false;

  const body =
    typeof response.json === "function"
      ? ((await response.json().catch(() => null)) as StudioHealthPayload | null)
      : null;

  return body?.status === "ok" || body?.initialized === true;
}

export async function waitForReadyWorkflow(deps: {
  inspectContainer: (containerId: string) => Promise<DockerContainerInfo>;
  getInternalProxyUrlForRoutePath: (routePath: string) => string;
  getContainerLogs: (containerId: string, tail?: number) => Promise<string | null>;
}, options: WaitForReadyOptions): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  let lastContainer: DockerContainerInfo | null = null;

  while (Date.now() < deadline) {
    const container = await deps.inspectContainer(options.containerId).catch(() => null);
    lastContainer = container;
    const state = container ? container.State?.Status || "unknown" : "unknown";
    if (state === "exited" || state === "dead") {
      throw new Error(
        await buildReadinessFailureMessage(deps, {
          containerId: options.containerId,
          container,
          reason: "stopped",
        }),
      );
    }

    const healthUrls = [
      container
        ? new URL("health", `${getDirectContainerBaseUrl(container)}/`).toString()
        : null,
      options.routePath
        ? new URL(
            "health",
            `${deps.getInternalProxyUrlForRoutePath(options.routePath)}/`,
          ).toString()
        : null,
    ].filter((value, index, list): value is string => {
      return typeof value === "string" && value.length > 0 && list.indexOf(value) === index;
    });

    for (const healthUrl of healthUrls) {
      try {
        const response = await fetch(healthUrl, {
          method: "GET",
          cache: "no-store",
          redirect: "manual",
        });
        if (await isStudioHealthReadyResponse(response)) return;
      } catch {
        // Retry until timeout.
      }
    }

    await sleep(1_000);
  }

  throw new Error(
    await buildReadinessFailureMessage(deps, {
      containerId: options.containerId,
      container: lastContainer,
      reason: "timeout",
    }),
  );
}

async function stopContainerIfRunningWorkflow(deps: {
  container: DockerContainerInfo;
  stopContainer: (containerId: string, timeoutSeconds: number) => Promise<void>;
  desiredKillTimeoutSeconds: number;
}): Promise<void> {
  if (!isRunningContainer(deps.container)) return;
  await deps.stopContainer(
    deps.container.Id,
    deps.desiredKillTimeoutSeconds,
  );
}

export type CreateFreshContainerOptions = {
  args: StudioMachineStartArgs;
  desiredImage: string;
  desiredImageState?: DockerResolvedImageState | null;
  preferredAccessToken?: string | null;
  preserveStudioIdFrom?: DockerContainerInfo | null;
  preserveExternalPortFrom?: DockerContainerInfo | null;
};

export async function createFreshContainerWorkflow(
  deps: {
    routeIdFor: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => string;
    containerNameFor: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => string;
    resolveContainerNetworkName: () => Promise<string>;
    buildStudioEnv: (
      args: StudioMachineStartArgs & { studioId: string; accessToken: string },
    ) => Record<string, string>;
    getDesiredImageStateForRef: (
      imageRef: string,
    ) => Promise<DockerResolvedImageState>;
    createContainer: (options: {
      name: string;
      config: DockerContainerCreateConfig;
      platform?: string;
    }) => Promise<DockerContainerCreateResponse>;
    inspectContainer: (containerIdOrName: string) => Promise<DockerContainerInfo>;
    listContainers: () => Promise<DockerContainerSummary[]>;
    allocatePublicPort: () => Promise<number>;
    ensureImageAvailableForCreate: (desiredImage: string) => Promise<string | null>;
    desiredKillTimeoutSeconds: number;
    nanoCpus: number;
    memoryBytes: number;
    generateStudioAccessToken: () => string;
    hostIp: string;
  },
  options: CreateFreshContainerOptions,
): Promise<DockerContainerInfo> {
  const studioId =
    options.preserveStudioIdFrom
      ? getContainerStudioId(options.preserveStudioIdFrom)
      : options.args.env.STUDIO_ID || crypto.randomUUID();
  const accessToken =
    trimToken(options.preferredAccessToken) ||
    (options.preserveStudioIdFrom
      ? getContainerAccessToken(options.preserveStudioIdFrom)
      : null) ||
    deps.generateStudioAccessToken();
  const externalPort =
    (options.preserveExternalPortFrom
      ? getContainerExternalPort(options.preserveExternalPortFrom)
      : null) || (await deps.allocatePublicPort());
  const routeId = deps.routeIdFor(
    options.args.organizationId,
    options.args.projectSlug,
    options.args.version,
  );
  const networkName = await deps.resolveContainerNetworkName();
  const env = deps.buildStudioEnv({
    ...options.args,
    studioId,
    accessToken,
  });
  const desiredImageState =
    options.desiredImageState ||
    (await deps.getDesiredImageStateForRef(options.desiredImage));
  const spec = createContainerSpec({
    args: options.args,
    studioId,
    accessToken,
    desiredImage: options.desiredImage,
    desiredImageState,
    routeId,
    externalPort,
    env,
    desiredKillTimeoutSeconds: deps.desiredKillTimeoutSeconds,
    nanoCpus: deps.nanoCpus,
    memoryBytes: deps.memoryBytes,
    networkName,
    hostIp: deps.hostIp,
  });
  const containerName = deps.containerNameFor(
    options.args.organizationId,
    options.args.projectSlug,
    options.args.version,
  );

  try {
    let platform: string | undefined;
    let created;
    try {
      created = await deps.createContainer({
        name: containerName,
        config: spec,
        platform,
      });
    } catch (error) {
      if (!isMissingImageError(error)) throw error;
      platform =
        (await deps.ensureImageAvailableForCreate(options.desiredImage)) || undefined;
      created = await deps.createContainer({
        name: containerName,
        config: spec,
        platform,
      });
    }
    return await deps.inspectContainer(created.Id);
  } catch (error) {
    if (!isContainerNameConflictError(error)) {
      throw error;
    }

    try {
      return await deps.inspectContainer(containerName);
    } catch {
      // Fall through to identity-based lookup.
    }

    const existing = findContainer(
      await deps.listContainers(),
      options.args.organizationId,
      options.args.projectSlug,
      options.args.version,
    );
    if (!existing) throw error;
    return await deps.inspectContainer(existing.Id);
  }
}

export type RecreateContainerOptions = {
  existing: DockerContainerInfo;
  args: StudioMachineStartArgs;
  desiredImage: string;
  desiredImageState?: DockerResolvedImageState | null;
  preferredAccessToken?: string | null;
  preserveExternalPort?: boolean;
};

export async function recreateContainerWorkflow(
  deps: {
    stopContainer: (containerId: string, timeoutSeconds: number) => Promise<void>;
    desiredKillTimeoutSeconds: number;
    removeContainer: (containerId: string) => Promise<void>;
    createFreshContainer: (
      options: CreateFreshContainerOptions,
    ) => Promise<DockerContainerInfo>;
  },
  options: RecreateContainerOptions,
): Promise<DockerContainerInfo> {
  await stopContainerIfRunningWorkflow({
    container: options.existing,
    stopContainer: deps.stopContainer,
    desiredKillTimeoutSeconds: deps.desiredKillTimeoutSeconds,
  });
  await deps.removeContainer(options.existing.Id);
  return await deps.createFreshContainer({
    args: options.args,
    desiredImage: options.desiredImage,
    desiredImageState: options.desiredImageState,
    preferredAccessToken: options.preferredAccessToken,
    preserveStudioIdFrom: options.existing,
    preserveExternalPortFrom:
      options.preserveExternalPort === false ? null : options.existing,
  });
}

export async function ensureContainerRunningWorkflow(
  deps: {
    key: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => string;
    routeIdFor: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => string;
    containerNameFor: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => string;
    upsertRuntimeRoute: (options: {
      routeId: string;
      containerName: string;
      targetPort: number;
    }) => Promise<string | null>;
    startContainer: (containerId: string) => Promise<void>;
    recreateContainer: (
      options: RecreateContainerOptions,
    ) => Promise<DockerContainerInfo>;
    getDesiredImageStateForRef: (
      imageRef: string,
    ) => Promise<DockerResolvedImageState>;
    getPublicUrlForPort: (port: number) => string;
    getPublicUrlForRoutePath: (routePath: string) => string;
    getInternalProxyUrlForRoutePath: (routePath: string) => string;
    startTimeoutMs: number;
    touchKey: (studioKey: string) => void;
    waitForReady: (options: WaitForReadyOptions) => Promise<void>;
  },
  args: StudioMachineStartArgs,
  container: DockerContainerInfo,
  accessToken: string,
  desiredImage: string,
  allowNetworkRecovery = true,
): Promise<StudioMachineStartResult> {
  const studioKey = deps.key(
    args.organizationId,
    args.projectSlug,
    args.version,
  );
  const routeId =
    getContainerRouteId(container) ||
    deps.routeIdFor(args.organizationId, args.projectSlug, args.version);
  const routePath = await deps.upsertRuntimeRoute({
    routeId,
    containerName:
      getContainerName(container) ||
      deps.containerNameFor(args.organizationId, args.projectSlug, args.version),
    targetPort: STUDIO_INTERNAL_PORT,
  });

  if (!isRunningContainer(container)) {
    try {
      await deps.startContainer(container.Id);
    } catch (error) {
      if (!allowNetworkRecovery || !isContainerNetworkingSetupError(error)) {
        throw error;
      }

      const recreated = await deps.recreateContainer({
        existing: container,
        args,
        desiredImage,
        desiredImageState: await deps.getDesiredImageStateForRef(desiredImage),
        preferredAccessToken: accessToken,
        preserveExternalPort: !isContainerPortConflictError(error),
      });
      return await ensureContainerRunningWorkflow(
        deps,
        args,
        recreated,
        accessToken,
        desiredImage,
        false,
      );
    }
  }

  const externalPort = getContainerExternalPort(container);
  const runtimeUrl = externalPort ? deps.getPublicUrlForPort(externalPort) : null;
  const compatibilityUrl = routePath ? deps.getPublicUrlForRoutePath(routePath) : null;
  const backendUrl =
    getDirectContainerBaseUrl(container) ??
    (routePath ? deps.getInternalProxyUrlForRoutePath(routePath) : null);

  deps.touchKey(studioKey);
  await deps.waitForReady({
    containerId: container.Id,
    routePath,
    timeoutMs: deps.startTimeoutMs,
  });

  deps.touchKey(studioKey);
  return {
    studioId: getContainerStudioId(container, args.env.STUDIO_ID),
    url:
      runtimeUrl ??
      compatibilityUrl ??
      (() => {
        throw new Error(
          `[DockerMachines] Missing browser URL for ${args.projectSlug}/v${args.version}`,
        );
      })(),
    backendUrl,
    runtimeUrl,
    compatibilityUrl,
    accessToken,
  };
}

export async function ensureRunningInnerWorkflow(
  deps: {
    listContainers: () => Promise<DockerContainerSummary[]>;
    getDesiredImage: () => Promise<string>;
    getDesiredImageStateForRef: (
      imageRef: string,
    ) => Promise<DockerResolvedImageState>;
    createFreshContainer: (
      options: CreateFreshContainerOptions,
    ) => Promise<DockerContainerInfo>;
    inspectContainer: (containerId: string) => Promise<DockerContainerInfo>;
    resolveContainerNetworkName: () => Promise<string>;
    resolveManagedMainBackendUrl: (
      raw: string | null | undefined,
    ) => string | null;
    buildStudioEnv: (
      args: StudioMachineStartArgs & { studioId: string; accessToken: string },
    ) => Record<string, string>;
    buildStudioEnvDriftSubset: (
      desiredEnv: Record<string, string>,
      explicitEnvKeys: Iterable<string>,
    ) => Record<string, string>;
    nanoCpus: number;
    memoryBytes: number;
    generateStudioAccessToken: () => string;
    recreateContainer: (
      options: RecreateContainerOptions,
    ) => Promise<DockerContainerInfo>;
    ensureContainerRunning: (
      args: StudioMachineStartArgs,
      container: DockerContainerInfo,
      accessToken: string,
      desiredImage: string,
    ) => Promise<StudioMachineStartResult>;
  },
  args: StudioMachineStartArgs,
): Promise<StudioMachineStartResult> {
  const containers = await deps.listContainers();
  const existing = findContainer(
    containers,
    args.organizationId,
    args.projectSlug,
    args.version,
  );
  const desiredImage = await deps.getDesiredImage();
  const desiredImageState = await deps.getDesiredImageStateForRef(desiredImage);

  if (!existing) {
    const created = await deps.createFreshContainer({
      args,
      desiredImage,
      desiredImageState,
    });
    const accessToken = getContainerAccessToken(created);
    if (!accessToken) {
      throw new Error(
        `[DockerMachines] Missing studio access token after creating container ${created.Id}`,
      );
    }
    return await deps.ensureContainerRunning(
      args,
      created,
      accessToken,
      desiredImage,
    );
  }

  let inspected = await deps.inspectContainer(existing.Id);
  const desiredNetworkName = await deps.resolveContainerNetworkName();
  const desiredMainBackendUrl = deps.resolveManagedMainBackendUrl(
    args.env.MAIN_BACKEND_URL,
  );
  const desiredEnvSubset = deps.buildStudioEnvDriftSubset(
    deps.buildStudioEnv({
      ...args,
      studioId: getContainerStudioId(inspected, args.env.STUDIO_ID),
      accessToken: getContainerAccessToken(inspected) || "",
    }),
    Object.keys(args.env),
  );
  let reconcileState = resolveContainerReconcileState({
    container: inspected,
    desiredImage,
    desiredImageState,
    desiredNanoCpus: deps.nanoCpus,
    desiredMemoryBytes: deps.memoryBytes,
    desiredNetworkName,
    desiredMainBackendUrl,
    desiredEnvSubset,
    generateStudioAccessToken: deps.generateStudioAccessToken,
  });

  if (isRunningContainer(inspected)) {
    if (
      reconcileState.needs.accessToken ||
      reconcileState.needs.mainBackendUrl ||
      reconcileState.needs.env
    ) {
      inspected = await deps.recreateContainer({
        existing: inspected,
        args,
        desiredImage,
        desiredImageState,
        preferredAccessToken: reconcileState.accessToken,
      });
      reconcileState = resolveContainerReconcileState({
        container: inspected,
        desiredImage,
        desiredImageState,
        desiredNanoCpus: deps.nanoCpus,
        desiredMemoryBytes: deps.memoryBytes,
        desiredNetworkName,
        desiredMainBackendUrl,
        desiredEnvSubset,
        desiredAccessToken: reconcileState.accessToken,
        generateStudioAccessToken: deps.generateStudioAccessToken,
      });
    }

    return await deps.ensureContainerRunning(
      args,
      inspected,
      reconcileState.accessToken,
      desiredImage,
    );
  }

  if (!isStoppedContainer(inspected) || hasContainerDrift(reconcileState.needs)) {
    inspected = await deps.recreateContainer({
      existing: inspected,
      args,
      desiredImage,
      desiredImageState,
      preferredAccessToken: reconcileState.accessToken,
    });
    reconcileState = resolveContainerReconcileState({
      container: inspected,
      desiredImage,
      desiredImageState,
      desiredNanoCpus: deps.nanoCpus,
      desiredMemoryBytes: deps.memoryBytes,
      desiredNetworkName,
      desiredMainBackendUrl,
      desiredEnvSubset,
      desiredAccessToken: reconcileState.accessToken,
      generateStudioAccessToken: deps.generateStudioAccessToken,
    });
  }

  return await deps.ensureContainerRunning(
    args,
    inspected,
    reconcileState.accessToken,
    desiredImage,
  );
}

export async function restartInnerWorkflow(
  deps: {
    listContainers: () => Promise<DockerContainerSummary[]>;
    inspectContainer: (containerId: string) => Promise<DockerContainerInfo>;
    getDesiredImage: () => Promise<string>;
    getDesiredImageStateForRef: (
      imageRef: string,
    ) => Promise<DockerResolvedImageState>;
    recreateContainer: (
      options: RecreateContainerOptions,
    ) => Promise<DockerContainerInfo>;
    createFreshContainer: (
      options: CreateFreshContainerOptions,
    ) => Promise<DockerContainerInfo>;
    ensureContainerRunning: (
      args: StudioMachineRestartArgs,
      container: DockerContainerInfo,
      accessToken: string,
      desiredImage: string,
    ) => Promise<StudioMachineStartResult>;
  },
  args: StudioMachineRestartArgs,
): Promise<StudioMachineStartResult> {
  const existing = findContainer(
    await deps.listContainers(),
    args.organizationId,
    args.projectSlug,
    args.version,
  );
  const desiredImage = await deps.getDesiredImage();
  const desiredImageState = await deps.getDesiredImageStateForRef(desiredImage);

  let container: DockerContainerInfo;
  if (existing) {
    container = await deps.recreateContainer({
      existing: await deps.inspectContainer(existing.Id),
      args,
      desiredImage,
      desiredImageState,
    });
  } else {
    container = await deps.createFreshContainer({
      args,
      desiredImage,
      desiredImageState,
    });
  }

  const accessToken = getContainerAccessToken(container);
  if (!accessToken) {
    throw new Error(
      `[DockerMachines] Missing studio access token after restarting container ${container.Id}`,
    );
  }
  return await deps.ensureContainerRunning(
    args,
    container,
    accessToken,
    desiredImage,
  );
}
