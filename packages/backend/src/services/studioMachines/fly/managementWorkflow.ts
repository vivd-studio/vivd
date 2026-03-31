import type {
  FlyMachine,
  FlyStudioMachineSummary,
  FlyStudioMachineUrlResult,
} from "./types";

type StudioIdentity = {
  organizationId: string;
  projectSlug: string;
  version: number;
};

export async function listStudioMachinesWorkflow(deps: {
  getDesiredImage: () => Promise<string>;
  listMachines: () => Promise<FlyMachine[]>;
  getStudioIdentityFromMachine: (machine: FlyMachine) => StudioIdentity | null;
  getMachineExternalPort: (machine: FlyMachine) => number | null;
  getConfiguredStudioImage: (machine: FlyMachine, desiredImage?: string) => string | null;
  getMachineMetadata: (machine: FlyMachine) => Record<string, string> | null;
  routeIdFor: (
    organizationId: string,
    projectSlug: string,
    version: number,
  ) => string;
  getRoutePath: (routeId: string) => string;
  getPublicUrlForPort: (port: number) => string;
}): Promise<FlyStudioMachineSummary[]> {
  const desiredImage = await deps.getDesiredImage();
  const machines = await deps.listMachines();

  const summaries: FlyStudioMachineSummary[] = [];
  for (const machine of machines) {
    const identity = deps.getStudioIdentityFromMachine(machine);
    if (!identity) continue;

    const port = deps.getMachineExternalPort(machine);
    const image = deps.getConfiguredStudioImage(machine, desiredImage);
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
      machine.created_at || deps.getMachineMetadata(machine)?.vivd_created_at || null;
    const updatedAt = machine.updated_at || null;
    const routeId = deps.routeIdFor(
      identity.organizationId,
      identity.projectSlug,
      identity.version,
    );
    const routePath = deps.getRoutePath(routeId);

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
      routePath,
      url: port ? deps.getPublicUrlForPort(port) : null,
      runtimeUrl: port ? deps.getPublicUrlForPort(port) : null,
      compatibilityUrl: routePath,
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

export async function destroyStudioMachineWorkflow(
  deps: {
    getMachine: (machineId: string) => Promise<FlyMachine>;
    getStudioIdentityFromMachine: (machine: FlyMachine) => StudioIdentity | null;
    routeIdFor: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => string;
    stopMachine: (machineId: string) => Promise<void>;
    waitForState: (options: { machineId: string; state: "stopped"; timeoutMs: number }) => Promise<void>;
    removeRuntimeRoute: (routeId: string) => Promise<void>;
    destroyMachine: (machineId: string) => Promise<void>;
    key: (organizationId: string, projectSlug: string, version: number) => string;
    deleteLastActivity: (studioKey: string) => void;
  },
  machineId: string,
): Promise<void> {
  const machine = await deps.getMachine(machineId);
  const identity = deps.getStudioIdentityFromMachine(machine);
  if (!identity) {
    throw new Error(`[FlyMachines] Refusing to destroy non-studio machine ${machineId}`);
  }

  const state = machine.state || "unknown";
  if (state !== "stopped" && state !== "destroyed" && state !== "destroying") {
    await deps.stopMachine(machineId);
    await deps.waitForState({
      machineId,
      state: "stopped",
      timeoutMs: 60_000,
    });
  }
  await deps.removeRuntimeRoute(
    deps.routeIdFor(identity.organizationId, identity.projectSlug, identity.version),
  );

  if (state !== "destroyed" && state !== "destroying") {
    await deps.destroyMachine(machineId);
  }

  const studioKey = deps.key(
    identity.organizationId,
    identity.projectSlug,
    identity.version,
  );
  deps.deleteLastActivity(studioKey);
}

function findExistingStudioMachine(
  deps: {
    listMachines: () => Promise<FlyMachine[]>;
    findMachineByName: (machines: FlyMachine[], machineName: string) => FlyMachine | null;
    findMachine: (
      machines: FlyMachine[],
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => FlyMachine | null;
    machineNameFor: (organizationId: string, projectSlug: string, version: number) => string;
  },
  organizationId: string,
  projectSlug: string,
  version: number,
): Promise<FlyMachine | null> {
  return deps.listMachines().then((machines) => {
    return (
      deps.findMachineByName(
        machines,
        deps.machineNameFor(organizationId, projectSlug, version),
      ) || deps.findMachine(machines, organizationId, projectSlug, version)
    );
  });
}

export async function stopStudioMachineWorkflow(
  deps: {
    key: (organizationId: string, projectSlug: string, version: number) => string;
    deleteLastActivity: (studioKey: string) => void;
    routeIdFor: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => string;
    listMachines: () => Promise<FlyMachine[]>;
    findMachineByName: (machines: FlyMachine[], machineName: string) => FlyMachine | null;
    findMachine: (
      machines: FlyMachine[],
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => FlyMachine | null;
    machineNameFor: (organizationId: string, projectSlug: string, version: number) => string;
    suspendOrStopMachine: (machineId: string) => Promise<"suspended" | "stopped">;
    removeRuntimeRoute: (routeId: string) => Promise<void>;
  },
  organizationId: string,
  projectSlug: string,
  version: number,
): Promise<void> {
  const studioKey = deps.key(organizationId, projectSlug, version);
  deps.deleteLastActivity(studioKey);

  const existing = await findExistingStudioMachine(
    deps,
    organizationId,
    projectSlug,
    version,
  );
  if (!existing) return;
  if (existing.state === "started") {
    await deps.suspendOrStopMachine(existing.id);
  }
  await deps.removeRuntimeRoute(
    deps.routeIdFor(organizationId, projectSlug, version),
  );
}

export async function getStudioMachineUrlWorkflow(
  deps: {
    listMachines: () => Promise<FlyMachine[]>;
    findMachineByName: (machines: FlyMachine[], machineName: string) => FlyMachine | null;
    findMachine: (
      machines: FlyMachine[],
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => FlyMachine | null;
    machineNameFor: (organizationId: string, projectSlug: string, version: number) => string;
    getMachineExternalPort: (machine: FlyMachine) => number | null;
    routeIdFor: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => string;
    upsertRuntimeRoute: (options: {
      routeId: string;
      targetBaseUrl: string;
    }) => Promise<string>;
    getPublicUrlForPort: (port: number) => string;
    getStudioAccessTokenFromMachine: (machine: FlyMachine) => string | null;
    resolveStudioIdFromMachine: (machine: FlyMachine, fallback?: string | null) => string;
  },
  organizationId: string,
  projectSlug: string,
  version: number,
): Promise<FlyStudioMachineUrlResult | null> {
  const existing = await findExistingStudioMachine(
    deps,
    organizationId,
    projectSlug,
    version,
  );
  if (!existing) return null;
  if (existing.state !== "started") return null;
  const port = deps.getMachineExternalPort(existing);
  if (!port) return null;
  const url = deps.getPublicUrlForPort(port);
  const compatibilityUrl = await deps.upsertRuntimeRoute({
    routeId: deps.routeIdFor(organizationId, projectSlug, version),
    targetBaseUrl: url,
  });
  const accessToken = deps.getStudioAccessTokenFromMachine(existing);
  if (!accessToken) return null;
  return {
    studioId: deps.resolveStudioIdFromMachine(existing, null),
    url,
    backendUrl: url,
    runtimeUrl: url,
    compatibilityUrl,
    accessToken,
  };
}

export async function isStudioMachineRunningWorkflow(
  deps: {
    listMachines: () => Promise<FlyMachine[]>;
    findMachineByName: (machines: FlyMachine[], machineName: string) => FlyMachine | null;
    findMachine: (
      machines: FlyMachine[],
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => FlyMachine | null;
    machineNameFor: (organizationId: string, projectSlug: string, version: number) => string;
  },
  organizationId: string,
  projectSlug: string,
  version: number,
): Promise<boolean> {
  const existing = await findExistingStudioMachine(
    deps,
    organizationId,
    projectSlug,
    version,
  );
  return !!existing && existing.state === "started";
}
