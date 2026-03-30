import crypto from "node:crypto";
import type {
  StudioMachineRestartArgs,
  StudioMachineStartArgs,
  StudioMachineStartResult,
} from "../types";
import {
  getDefinedStudioMachineEnv,
  parseStudioMachineEnvKeyList,
  withMissingStudioMachineEnvKeys,
} from "../env";
import {
  STUDIO_ACCESS_TOKEN_ENV_KEY,
  STUDIO_ACCESS_TOKEN_METADATA_KEY,
  type MachineReconcileNeeds,
} from "./machineModel";
import type { FlyMachine, FlyMachineConfig, FlyMachineState } from "./types";

type WaitForStateArgs = {
  machineId: string;
  state: FlyMachineState;
  timeoutMs: number;
};

type WaitForReadyArgs = {
  machineId: string;
  url: string;
  timeoutMs: number;
};

export type EnsureExistingMachineRunningDeps = {
  getMachineExternalPort: (machine: FlyMachine) => number | null;
  getDesiredImage: () => Promise<string>;
  trimToken: (value: string | null | undefined) => string | null;
  resolveMachineReconcileState: (options: {
    machine: FlyMachine;
    desiredImage: string;
    preferredAccessToken?: string | null;
    desiredEnvSubset?: Record<string, string>;
  }) => { accessToken: string; needs: MachineReconcileNeeds };
  stopMachine: (machineId: string) => Promise<void>;
  waitForState: (options: WaitForStateArgs) => Promise<void>;
  getMachine: (machineId: string) => Promise<FlyMachine>;
  hasMachineDrift: (needs: MachineReconcileNeeds) => boolean;
  shouldStopSuspendedBeforeReconcile: (
    state: string | undefined,
    needs: MachineReconcileNeeds,
  ) => boolean;
  resolveStudioIdFromMachine: (machine: FlyMachine, fallback?: string | null) => string;
  buildStudioEnv: (
    args: StudioMachineStartArgs & { studioId: string; accessToken: string },
  ) => Record<string, string>;
  buildReconciledMetadata: (options: {
    machine: FlyMachine;
    organizationId: string;
    projectSlug: string;
    version: number;
    port: number;
    studioId: string;
    desiredImage: string;
    accessToken: string;
    extra?: Record<string, string>;
  }) => Record<string, string>;
  buildReconciledMachineConfig: (options: {
    machine: FlyMachine;
    port: number;
    desiredImage: string;
    accessToken: string;
    needs: MachineReconcileNeeds;
    metadata: Record<string, string>;
    fullEnv?: Record<string, string>;
  }) => FlyMachineConfig;
  updateMachineConfig: (options: {
    machineId: string;
    config: FlyMachineConfig;
    skipLaunch?: boolean;
  }) => Promise<FlyMachine>;
  startMachineHandlingReplacement: (machineId: string) => Promise<void>;
  getPublicUrlForPort: (port: number) => string;
  waitForReady: (options: WaitForReadyArgs) => Promise<void>;
  startTimeoutMs: number;
  touchKey: (studioKey: string) => void;
};

export async function ensureExistingMachineRunningWorkflow(
  deps: EnsureExistingMachineRunningDeps,
  existing: FlyMachine,
  args: StudioMachineStartArgs,
  studioKey: string,
): Promise<StudioMachineStartResult> {
  const port = deps.getMachineExternalPort(existing);
  if (!port) {
    throw new Error(
      `[FlyMachines] Found machine ${existing.id} for ${args.projectSlug}/v${args.version} but could not determine its external port. Destroy it or recreate it.`,
    );
  }

  const desiredImage = await deps.getDesiredImage();
  const studioId = deps.resolveStudioIdFromMachine(existing, args.env.STUDIO_ID);
  const preferredAccessToken = deps.trimToken(
    args.env[STUDIO_ACCESS_TOKEN_ENV_KEY],
  );
  const envForDrift = deps.buildStudioEnv({
    ...args,
    studioId,
    accessToken:
      preferredAccessToken ||
      existing.config?.env?.[STUDIO_ACCESS_TOKEN_ENV_KEY] ||
      "",
  });
  const desiredEnvSubset = buildStudioEnvDriftSubsetFromDesiredEnv(
    envForDrift,
    Object.keys(args.env),
  );
  let reconcileState = deps.resolveMachineReconcileState({
    machine: existing,
    desiredImage,
    preferredAccessToken,
    desiredEnvSubset,
  });
  let accessToken = reconcileState.accessToken;

  if (
    existing.state === "started" &&
    (reconcileState.needs.accessToken || reconcileState.needs.env)
  ) {
    // Critical runtime env drift (auth/tool policy/backend callbacks) requires a
    // fresh boot so the running Studio uses the latest backend-facing config.
    await deps.stopMachine(existing.id);
    await deps.waitForState({
      machineId: existing.id,
      state: "stopped",
      timeoutMs: 60_000,
    });
    existing = await deps.getMachine(existing.id);
    reconcileState = deps.resolveMachineReconcileState({
      machine: existing,
      desiredImage,
      preferredAccessToken,
      desiredEnvSubset,
    });
    accessToken = reconcileState.accessToken;
  }

  // Only reconcile machine config when it's not running, to avoid disrupting an
  // active studio session. This also ensures the next boot uses the latest image.
  if (
    existing.state !== "started" &&
    deps.hasMachineDrift(reconcileState.needs)
  ) {
    // A suspended machine would resume a snapshot; stop it first to boot fresh.
    if (deps.shouldStopSuspendedBeforeReconcile(existing.state, reconcileState.needs)) {
      await deps.stopMachine(existing.id);
      await deps.waitForState({
        machineId: existing.id,
        state: "stopped",
        timeoutMs: 60_000,
      });
    }

    const current = await deps.getMachine(existing.id);
    reconcileState = deps.resolveMachineReconcileState({
      machine: current,
      desiredImage,
      preferredAccessToken,
      desiredEnvSubset,
    });
    accessToken = reconcileState.accessToken;

    if (deps.hasMachineDrift(reconcileState.needs)) {
      const env = deps.buildStudioEnv({ ...args, studioId, accessToken });
      const metadata = deps.buildReconciledMetadata({
        machine: current,
        organizationId: args.organizationId,
        projectSlug: args.projectSlug,
        version: args.version,
        port,
        studioId,
        desiredImage,
        accessToken,
      });
      const config = deps.buildReconciledMachineConfig({
        machine: current,
        port,
        desiredImage,
        accessToken,
        needs: reconcileState.needs,
        metadata,
        fullEnv: env,
      });

      await deps.updateMachineConfig({
        machineId: existing.id,
        config,
        skipLaunch: true,
      });

      existing = await deps.getMachine(existing.id);
    }
  }

  if (existing.state !== "started") {
    await deps.startMachineHandlingReplacement(existing.id);
  }

  const url = deps.getPublicUrlForPort(port);
  await deps.waitForReady({
    machineId: existing.id,
    url,
    timeoutMs: deps.startTimeoutMs,
  });

  const finalStudioId = deps.resolveStudioIdFromMachine(existing, args.env.STUDIO_ID);

  deps.touchKey(studioKey);
  return {
    studioId: finalStudioId,
    url,
    runtimeUrl: url,
    compatibilityUrl: null,
    port,
    accessToken,
  };
}

export type RecoverCreateNameConflictDeps = {
  getMachine: (machineId: string) => Promise<FlyMachine>;
  clearMachinesCache: () => void;
  listMachines: () => Promise<FlyMachine[]>;
  findMachineByName: (machines: FlyMachine[], machineName: string) => FlyMachine | null;
};

export async function recoverCreateNameConflictWorkflow(
  deps: RecoverCreateNameConflictDeps,
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
      return await deps.getMachine(machineId);
    } catch {
      // Fall through to list-based lookup.
    }
  }

  deps.clearMachinesCache();
  const machines = await deps.listMachines();
  return deps.findMachineByName(machines, machineName);
}

export type AllocatePortDeps = {
  getMachineExternalPort: (machine: FlyMachine) => number | null;
  portStart: number;
};

export function allocatePortWorkflow(
  deps: AllocatePortDeps,
  machines: FlyMachine[],
): number {
  const used = new Set<number>();
  for (const machine of machines) {
    const port = deps.getMachineExternalPort(machine);
    if (port) used.add(port);
  }

  for (let i = 0; i < 500; i++) {
    const candidate = deps.portStart + i;
    if (candidate > 65535) break;
    if (!used.has(candidate)) return candidate;
  }

  throw new Error(
    `[FlyMachines] No available ports (start=${deps.portStart}). Set FLY_STUDIO_PORT_START to a different range.`,
  );
}

const DEFAULT_ENV_PASSTHROUGH =
  "GOOGLE_API_KEY,OPENROUTER_API_KEY,GOOGLE_CLOUD_PROJECT,VERTEX_LOCATION,GOOGLE_APPLICATION_CREDENTIALS,GOOGLE_APPLICATION_CREDENTIALS_JSON,VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH,OPENCODE_MODEL_STANDARD,OPENCODE_MODEL_ADVANCED,OPENCODE_MODEL_PRO,R2_ENDPOINT,R2_BUCKET,R2_ACCESS_KEY,R2_SECRET_KEY,VIVD_BUCKET_MODE,VIVD_LOCAL_S3_BUCKET,VIVD_LOCAL_S3_ENDPOINT_URL,VIVD_LOCAL_S3_ACCESS_KEY,VIVD_LOCAL_S3_SECRET_KEY,VIVD_LOCAL_S3_REGION,VIVD_S3_BUCKET,VIVD_S3_ENDPOINT_URL,VIVD_S3_ACCESS_KEY_ID,VIVD_S3_SECRET_ACCESS_KEY,VIVD_S3_SESSION_TOKEN,VIVD_S3_REGION,VIVD_S3_PREFIX,VIVD_S3_SOURCE_URI,VIVD_S3_OPENCODE_PREFIX,VIVD_S3_OPENCODE_URI,VIVD_S3_OPENCODE_STORAGE_URI,VIVD_S3_SYNC_INTERVAL_SECONDS,VIVD_SYNC_TRIGGER_FILE,VIVD_SYNC_PAUSE_FILE,VIVD_SYNC_PAUSE_MAX_AGE_SECONDS,VIVD_SHUTDOWN_SYNC_BUDGET_SECONDS,VIVD_SHUTDOWN_CHILD_WAIT_SECONDS,AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,AWS_SESSION_TOKEN,AWS_DEFAULT_REGION,AWS_REGION,DEVSERVER_INSTALL_TIMEOUT_MS,VIVD_PACKAGE_CACHE_DIR,DEVSERVER_NODE_MODULES_CACHE,VIVD_ARTIFACT_BUILDER_ENABLED,GITHUB_SYNC_ENABLED,GITHUB_SYNC_STRICT,GITHUB_ORG,GITHUB_TOKEN,GITHUB_REPO_PREFIX,GITHUB_REPO_VISIBILITY,GITHUB_API_URL,GITHUB_GIT_HOST,GITHUB_REMOTE_NAME";

function getConfiguredFlyStudioEnvPassthroughKeys(): string[] {
  return parseStudioMachineEnvKeyList(
    process.env.FLY_STUDIO_ENV_PASSTHROUGH || DEFAULT_ENV_PASSTHROUGH,
  );
}

export type BuildStudioEnvDeps = {
  desiredKillTimeoutSeconds: number;
};

export function buildStudioEnvWorkflow(
  deps: BuildStudioEnvDeps,
  args: StudioMachineStartArgs & { studioId: string; accessToken: string },
): Record<string, string> {
  const workspaceDir =
    process.env.FLY_STUDIO_WORKSPACE_DIR || "/home/studio/project";

  const env: Record<string, string> = {
    PORT: "3100",
    STUDIO_ID: args.studioId,
    [STUDIO_ACCESS_TOKEN_ENV_KEY]: args.accessToken,
    VIVD_TENANT_ID: args.organizationId,
    VIVD_PROJECT_SLUG: args.projectSlug,
    VIVD_PROJECT_VERSION: String(args.version),
    VIVD_WORKSPACE_DIR: workspaceDir,
    // Fly machines are isolated; fixed internal ports are fine.
    DEV_SERVER_PORT_START: "5100",
    OPENCODE_PORT_START: "4096",
    // Keep OpenCode server warm for the lifetime of the studio machine.
    OPENCODE_IDLE_TIMEOUT_MS: "0",
  };

  const definedEnv = getDefinedStudioMachineEnv(args.env);
  const explicitEnvKeys = new Set(Object.keys(args.env));
  for (const [key, value] of Object.entries(definedEnv)) {
    env[key] = value;
  }

  if (!env.VIVD_OPENCODE_DATA_HOME && process.env.FLY_STUDIO_OPENCODE_DATA_HOME) {
    env.VIVD_OPENCODE_DATA_HOME = process.env.FLY_STUDIO_OPENCODE_DATA_HOME;
  }

  // Optional passthrough for local-first testing (keeps config explicit).
  const passthrough = getConfiguredFlyStudioEnvPassthroughKeys();

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

  for (const key of getConfiguredFlyStudioEnvPassthroughKeys()) {
    if (!explicitKeys.has(key)) {
      managedMissingKeys.add(key);
    }
  }

  if (!explicitKeys.has("VIVD_OPENCODE_DATA_HOME")) {
    managedMissingKeys.add("VIVD_OPENCODE_DATA_HOME");
  }

  managedMissingKeys.add("SESSION_TOKEN");

  return withMissingStudioMachineEnvKeys(subset, managedMissingKeys);
}

export type RestartInnerDeps = {
  key: (organizationId: string, projectSlug: string, version: number) => string;
  machineNameFor: (organizationId: string, projectSlug: string, version: number) => string;
  listMachines: () => Promise<FlyMachine[]>;
  findMachineByName: (machines: FlyMachine[], machineName: string) => FlyMachine | null;
  findMachine: (
    machines: FlyMachine[],
    organizationId: string,
    projectSlug: string,
    version: number,
  ) => FlyMachine | null;
  ensureRunningInner: (args: StudioMachineStartArgs) => Promise<StudioMachineStartResult>;
  getMachineExternalPort: (machine: FlyMachine) => number | null;
  getMachine: (machineId: string) => Promise<FlyMachine>;
  clearMachinesCache: () => void;
  stopMachine: (machineId: string) => Promise<void>;
  waitForState: (options: WaitForStateArgs) => Promise<void>;
  getDesiredImage: () => Promise<string>;
  getMachineMetadata: (machine: FlyMachine) => Record<string, string> | null;
  getStudioAccessTokenFromMachine: (machine: FlyMachine) => string | null;
  generateStudioAccessToken: () => string;
  buildStudioEnv: (
    args: StudioMachineStartArgs & { studioId: string; accessToken: string },
  ) => Record<string, string>;
  desiredGuest: {
    cpu_kind: "shared" | "performance";
    cpus: number;
    memory_mb: number;
  };
  desiredKillTimeoutSeconds: number;
  normalizeServicesForVivd: (
    services: FlyMachineConfig["services"] | undefined,
    externalPort: number,
  ) => FlyMachineConfig["services"];
  updateMachineConfig: (options: {
    machineId: string;
    config: FlyMachineConfig;
    skipLaunch?: boolean;
  }) => Promise<FlyMachine>;
  startMachineHandlingReplacement: (machineId: string) => Promise<void>;
  getPublicUrlForPort: (port: number) => string;
  waitForReady: (options: WaitForReadyArgs) => Promise<void>;
  startTimeoutMs: number;
  touchKey: (studioKey: string) => void;
};

export async function restartInnerWorkflow(
  deps: RestartInnerDeps,
  args: StudioMachineRestartArgs,
): Promise<StudioMachineStartResult> {
  const studioKey = deps.key(args.organizationId, args.projectSlug, args.version);
  const machineName = deps.machineNameFor(
    args.organizationId,
    args.projectSlug,
    args.version,
  );

  const machines = await deps.listMachines();
  const existing =
    deps.findMachineByName(machines, machineName) ||
    deps.findMachine(machines, args.organizationId, args.projectSlug, args.version);

  // No machine exists yet; start normally.
  if (!existing) {
    return deps.ensureRunningInner(args);
  }

  const port = deps.getMachineExternalPort(existing);
  if (!port) {
    throw new Error(
      `[FlyMachines] Found machine ${existing.id} for ${args.projectSlug}/v${args.version} but could not determine its external port. Destroy it or recreate it.`,
    );
  }

  const current = await deps.getMachine(existing.id);
  const state = current.state || "unknown";
  if (state === "destroyed" || state === "destroying") {
    // Machine is gone; start normally.
    deps.clearMachinesCache();
    return deps.ensureRunningInner(args);
  }

  // Force a fresh boot so the studio entrypoint rehydrates from S3.
  if (state !== "stopped") {
    await deps.stopMachine(existing.id);
    await deps.waitForState({
      machineId: existing.id,
      state: "stopped",
      timeoutMs: 60_000,
    });
  }

  const desiredImage = await deps.getDesiredImage();
  const studioId =
    deps.getMachineMetadata(current)?.vivd_studio_id ||
    current.config?.env?.STUDIO_ID ||
    args.env.STUDIO_ID ||
    crypto.randomUUID();

  const accessToken =
    deps.getStudioAccessTokenFromMachine(current) ||
    (typeof args.env[STUDIO_ACCESS_TOKEN_ENV_KEY] === "string"
      ? args.env[STUDIO_ACCESS_TOKEN_ENV_KEY]?.trim()
      : null) ||
    deps.generateStudioAccessToken();

  const env = deps.buildStudioEnv({ ...args, studioId, accessToken });

  const metadata: Record<string, string> = {
    ...(deps.getMachineMetadata(current) || {}),
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
    guest: deps.desiredGuest,
    kill_timeout: deps.desiredKillTimeoutSeconds,
    env,
    services: deps.normalizeServicesForVivd(current.config?.services, port),
    metadata,
  };

  await deps.updateMachineConfig({
    machineId: existing.id,
    config,
    skipLaunch: true,
  });

  await deps.startMachineHandlingReplacement(existing.id);

  const url = deps.getPublicUrlForPort(port);
  await deps.waitForReady({
    machineId: existing.id,
    url,
    timeoutMs: deps.startTimeoutMs,
  });

  deps.touchKey(studioKey);
  return {
    studioId,
    url,
    runtimeUrl: url,
    compatibilityUrl: null,
    port,
    accessToken,
  };
}

export type EnsureRunningInnerDeps = {
  key: (organizationId: string, projectSlug: string, version: number) => string;
  machineNameFor: (organizationId: string, projectSlug: string, version: number) => string;
  listMachines: () => Promise<FlyMachine[]>;
  findMachineByName: (machines: FlyMachine[], machineName: string) => FlyMachine | null;
  findMachine: (
    machines: FlyMachine[],
    organizationId: string,
    projectSlug: string,
    version: number,
  ) => FlyMachine | null;
  ensureExistingMachineRunning: (
    existing: FlyMachine,
    args: StudioMachineStartArgs,
    studioKey: string,
  ) => Promise<StudioMachineStartResult>;
  allocatePort: (machines: FlyMachine[]) => number;
  getDesiredImage: () => Promise<string>;
  generateStudioAccessToken: () => string;
  buildStudioEnv: (
    args: StudioMachineStartArgs & { studioId: string; accessToken: string },
  ) => Record<string, string>;
  createMachine: (options: { machineName: string; config: FlyMachineConfig }) => Promise<FlyMachine>;
  desiredGuest: {
    cpu_kind: "shared" | "performance";
    cpus: number;
    memory_mb: number;
  };
  desiredKillTimeoutSeconds: number;
  recoverCreateNameConflict: (
    error: unknown,
    machineName: string,
  ) => Promise<FlyMachine | null>;
  getPublicUrlForPort: (port: number) => string;
  waitForReady: (options: WaitForReadyArgs) => Promise<void>;
  startTimeoutMs: number;
  touchKey: (studioKey: string) => void;
};

export async function ensureRunningInnerWorkflow(
  deps: EnsureRunningInnerDeps,
  args: StudioMachineStartArgs,
): Promise<StudioMachineStartResult> {
  const studioKey = deps.key(args.organizationId, args.projectSlug, args.version);
  const machineName = deps.machineNameFor(
    args.organizationId,
    args.projectSlug,
    args.version,
  );
  const machines = await deps.listMachines();
  const existing =
    deps.findMachineByName(machines, machineName) ||
    deps.findMachine(machines, args.organizationId, args.projectSlug, args.version);

  if (existing) {
    return deps.ensureExistingMachineRunning(existing, args, studioKey);
  }

  const port = deps.allocatePort(machines);
  const studioId = args.env.STUDIO_ID || crypto.randomUUID();
  const desiredImage = await deps.getDesiredImage();

  const accessToken =
    (typeof args.env[STUDIO_ACCESS_TOKEN_ENV_KEY] === "string"
      ? args.env[STUDIO_ACCESS_TOKEN_ENV_KEY]?.trim()
      : null) || deps.generateStudioAccessToken();

  const env = deps.buildStudioEnv({ ...args, studioId, accessToken });

  let create: FlyMachine;
  try {
    create = await deps.createMachine({
      machineName,
      config: {
        image: desiredImage,
        guest: deps.desiredGuest,
        kill_timeout: deps.desiredKillTimeoutSeconds,
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
    });
  } catch (error) {
    const recovered = await deps.recoverCreateNameConflict(error, machineName);
    if (recovered) {
      return deps.ensureExistingMachineRunning(recovered, args, studioKey);
    }
    throw error;
  }

  const url = deps.getPublicUrlForPort(port);
  await deps.waitForReady({
    machineId: create.id,
    url,
    timeoutMs: deps.startTimeoutMs,
  });

  deps.touchKey(studioKey);
  return {
    studioId,
    url,
    runtimeUrl: url,
    compatibilityUrl: null,
    port,
    accessToken,
  };
}
