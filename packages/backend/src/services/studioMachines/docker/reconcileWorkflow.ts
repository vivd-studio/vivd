import { type StudioMachineReconcileResult, type StudioMachineStartArgs, type StudioMachineStartResult } from "../types";
import {
  containerStateStatus,
  getContainerAccessToken,
  getContainerCreatedAt,
  getContainerEnv,
  getContainerIdentity,
  getContainerStudioId,
  hasContainerDrift,
  isRunningContainer,
  isStoppedContainer,
  resolveContainerReconcileState,
  type DockerResolvedImageState,
  type StudioIdentity,
} from "./containerModel";
import type { DockerContainerInfo, DockerContainerSummary } from "./types";

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

export type WarmReconcileContainerOptions = {
  container: DockerContainerInfo;
  identity: StudioIdentity;
  desiredImage: string;
  desiredImageState: DockerResolvedImageState;
  desiredNetworkName: string;
};

export async function warmReconcileContainerWorkflow(
  deps: {
    resolveManagedMainBackendUrl: (raw: string | null | undefined) => string | null;
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
    recreateContainer: (options: {
      existing: DockerContainerInfo;
      args: StudioMachineStartArgs;
      desiredImage: string;
      desiredImageState?: DockerResolvedImageState | null;
      preferredAccessToken?: string | null;
      preserveExternalPort?: boolean;
    }) => Promise<DockerContainerInfo>;
    ensureContainerRunning: (
      args: StudioMachineStartArgs,
      container: DockerContainerInfo,
      accessToken: string,
      desiredImage: string,
    ) => Promise<StudioMachineStartResult>;
    stop: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => Promise<void>;
  },
  options: WarmReconcileContainerOptions,
): Promise<void> {
  const state = containerStateStatus(options.container);
  if (state === "dead" || state === "removing") return;

  const desiredMainBackendUrl = deps.resolveManagedMainBackendUrl(
    getContainerEnv(options.container).MAIN_BACKEND_URL,
  );
  let reconcileState = resolveContainerReconcileState({
    container: options.container,
    desiredImage: options.desiredImage,
    desiredImageState: options.desiredImageState,
    desiredNanoCpus: deps.nanoCpus,
    desiredMemoryBytes: deps.memoryBytes,
    desiredNetworkName: options.desiredNetworkName,
    desiredMainBackendUrl,
    generateStudioAccessToken: deps.generateStudioAccessToken,
  });
  const desiredEnvSubset = deps.buildStudioEnvDriftSubset(
    deps.buildStudioEnv({
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
    desiredNanoCpus: deps.nanoCpus,
    desiredMemoryBytes: deps.memoryBytes,
    desiredNetworkName: options.desiredNetworkName,
    desiredMainBackendUrl,
    desiredEnvSubset,
    generateStudioAccessToken: deps.generateStudioAccessToken,
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

  const recreated = await deps.recreateContainer({
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

  await deps.ensureContainerRunning(
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
  await deps.stop(
    options.identity.organizationId,
    options.identity.projectSlug,
    options.identity.version,
  );
}

export async function reconcileStudioMachinesInnerWorkflow(
  deps: {
    getDesiredImage: (options?: { forceRefresh?: boolean }) => Promise<string>;
    getDesiredImageStateForRef: (
      imageRef: string,
      options?: { forceRefresh?: boolean; preferPull?: boolean },
    ) => Promise<DockerResolvedImageState>;
    listContainers: () => Promise<DockerContainerSummary[]>;
    resolveContainerNetworkName: () => Promise<string>;
    reconcilerDryRun: boolean;
    maxMachineInactivityMs: number;
    key: (organizationId: string, projectSlug: string, version: number) => string;
    listStudioVisitMsByIdentity: (
      identities: StudioIdentity[],
    ) => Promise<Map<string, number>>;
    reconcilerConcurrency: number;
    inspectContainer: (containerId: string) => Promise<DockerContainerInfo>;
    resolveManagedMainBackendUrl: (raw: string | null | undefined) => string | null;
    nanoCpus: number;
    memoryBytes: number;
    generateStudioAccessToken: () => string;
    warmOutdatedImages: boolean;
    warmReconcileContainer: (
      options: WarmReconcileContainerOptions,
    ) => Promise<void>;
    destroyStudioMachine: (machineId: string) => Promise<void>;
  },
  options: {
    forceRefreshDesiredImage: boolean;
  },
): Promise<StudioMachineReconcileResult> {
  const desiredImage = await deps.getDesiredImage({
    forceRefresh: options.forceRefreshDesiredImage,
  });
  const desiredImageState = await deps.getDesiredImageStateForRef(desiredImage, {
    forceRefresh: options.forceRefreshDesiredImage,
    preferPull: options.forceRefreshDesiredImage,
  });
  const containers = await deps.listContainers();
  const desiredNetworkName = await deps.resolveContainerNetworkName();
  const now = Date.now();
  const dryRun = deps.reconcilerDryRun;

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

  const lastVisitedAtMsByStudioKey = await deps.listStudioVisitMsByIdentity(
    studioContainers.map(({ identity }) => identity),
  );

  await mapLimit(
    studioContainers,
    deps.reconcilerConcurrency,
    async ({ container, identity }) => {
      const studioKey = deps.key(
        identity.organizationId,
        identity.projectSlug,
        identity.version,
      );
      const lastVisitedAtMs = lastVisitedAtMsByStudioKey.get(studioKey) ?? null;
      const inspected = await deps.inspectContainer(container.Id);
      const createdAtMs = getContainerCreatedAt(inspected)
        ? Date.parse(getContainerCreatedAt(inspected)!)
        : Number.NaN;
      const inactivityMs = lastVisitedAtMs !== null ? now - lastVisitedAtMs : null;
      const createdAgeMs = Number.isFinite(createdAtMs) ? now - createdAtMs : null;
      const shouldGc =
        (inactivityMs !== null && inactivityMs >= deps.maxMachineInactivityMs) ||
        (lastVisitedAtMs === null &&
          createdAgeMs !== null &&
          createdAgeMs >= deps.maxMachineInactivityMs);

      if (shouldGc) {
        if (dryRun) return;
        try {
          await deps.destroyStudioMachine(container.Id);
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

      const desiredMainBackendUrl = deps.resolveManagedMainBackendUrl(
        getContainerEnv(inspected).MAIN_BACKEND_URL,
      );
      const reconcileState = resolveContainerReconcileState({
        container: inspected,
        desiredImage,
        desiredImageState,
        desiredNanoCpus: deps.nanoCpus,
        desiredMemoryBytes: deps.memoryBytes,
        desiredNetworkName,
        desiredMainBackendUrl,
        generateStudioAccessToken: deps.generateStudioAccessToken,
      });
      if (!hasContainerDrift(reconcileState.needs)) return;

      if (isRunningContainer(inspected)) {
        result.skippedRunningMachines++;
        return;
      }

      if (!deps.warmOutdatedImages) return;
      if (dryRun) return;

      try {
        await deps.warmReconcileContainer({
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
