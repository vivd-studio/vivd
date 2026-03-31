import type {
  StudioMachineParkResult,
  StudioMachineSummary,
} from "../types";
import {
  compareContainerImageState,
  getContainerConfiguredImage,
  getContainerCreatedAt,
  getContainerExternalPort,
  getContainerIdentity,
  getContainerName,
  getContainerRouteId,
  getContainerRuntimeImageId,
  getContainerUpdatedAt,
  getImageLabel,
  mapContainerState,
  OCI_IMAGE_REVISION_LABEL,
  OCI_IMAGE_VERSION_LABEL,
  selectRepoDigestForRef,
  STUDIO_IMAGE_DIGEST_LABEL,
  STUDIO_IMAGE_REVISION_LABEL,
  STUDIO_IMAGE_VERSION_LABEL,
  type DockerResolvedImageState,
  type StudioIdentity,
} from "./containerModel";
import type {
  DockerContainerInfo,
  DockerContainerSummary,
  DockerImageInfo,
} from "./types";
import { trimToken } from "../fly/machineModel";

async function getRuntimeImageMetadataWorkflow(deps: {
  container: DockerContainerInfo;
  runtimeImageCache: Map<string, Promise<DockerImageInfo | null>>;
  inspectImageSafe: (imageRefOrId: string) => Promise<DockerImageInfo | null>;
}): Promise<{
  imageId: string | null;
  imageDigest: string | null;
  imageVersion: string | null;
  imageRevision: string | null;
}> {
  const labels = deps.container.Config?.Labels ?? {};
  const imageId = getContainerRuntimeImageId(deps.container);
  let imageDigest = trimToken(labels[STUDIO_IMAGE_DIGEST_LABEL]);
  let imageVersion = trimToken(labels[STUDIO_IMAGE_VERSION_LABEL]);
  let imageRevision = trimToken(labels[STUDIO_IMAGE_REVISION_LABEL]);

  if ((!imageDigest || !imageVersion || !imageRevision) && imageId) {
    let inspectPromise = deps.runtimeImageCache.get(imageId);
    if (!inspectPromise) {
      inspectPromise = deps.inspectImageSafe(imageId);
      deps.runtimeImageCache.set(imageId, inspectPromise);
    }

    const inspected = await inspectPromise;
    if (inspected) {
      if (!imageDigest) {
        imageDigest = selectRepoDigestForRef(
          inspected.RepoDigests,
          getContainerConfiguredImage(deps.container) || imageId,
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

async function buildContainerSummaryWorkflow(deps: {
  container: DockerContainerInfo;
  desiredImageState: DockerResolvedImageState;
  routePath: string | null;
  url: string | null;
  runtimeUrl: string | null;
  compatibilityUrl: string | null;
  cpuKind: string;
  runtimeImageCache: Map<string, Promise<DockerImageInfo | null>>;
  inspectImageSafe: (imageRefOrId: string) => Promise<DockerImageInfo | null>;
}): Promise<StudioMachineSummary> {
  const identity = getContainerIdentity(deps.container);
  if (!identity) {
    throw new Error(
      `[DockerMachines] Refusing to summarize non-studio container ${deps.container.Id}`,
    );
  }

  const configuredImage = getContainerConfiguredImage(
    deps.container,
    deps.desiredImageState.requestedRef,
  );
  const imageComparison = compareContainerImageState({
    container: deps.container,
    desiredImage: deps.desiredImageState.requestedRef,
    desiredImageState: deps.desiredImageState,
  });
  const runtimeImage = await getRuntimeImageMetadataWorkflow({
    container: deps.container,
    runtimeImageCache: deps.runtimeImageCache,
    inspectImageSafe: deps.inspectImageSafe,
  });
  const nanoCpus = deps.container.HostConfig?.NanoCpus || 0;
  const memoryBytes = deps.container.HostConfig?.Memory || 0;

  return {
    id: deps.container.Id,
    name: getContainerName(deps.container),
    state: mapContainerState(deps.container),
    region: null,
    cpuKind: nanoCpus > 0 || memoryBytes > 0 ? deps.cpuKind : null,
    cpus: nanoCpus > 0 ? nanoCpus / 1_000_000_000 : null,
    memoryMb: memoryBytes > 0 ? Math.round(memoryBytes / (1024 * 1024)) : null,
    organizationId: identity.organizationId,
    projectSlug: identity.projectSlug,
    version: identity.version,
    externalPort: getContainerExternalPort(deps.container),
    routePath: deps.routePath,
    url: deps.url,
    runtimeUrl: deps.runtimeUrl,
    compatibilityUrl: deps.compatibilityUrl,
    image: configuredImage,
    desiredImage: deps.desiredImageState.requestedRef,
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
    desiredImageId: deps.desiredImageState.imageId,
    desiredImageDigest: deps.desiredImageState.repoDigest,
    desiredImageVersion: deps.desiredImageState.versionLabel,
    desiredImageRevision: deps.desiredImageState.revisionLabel,
    createdAt: getContainerCreatedAt(deps.container),
    updatedAt: getContainerUpdatedAt(deps.container),
  };
}

export async function listStudioMachinesWorkflow(deps: {
  getDesiredImage: () => Promise<string>;
  getDesiredImageStateForRef: (
    imageRef: string,
  ) => Promise<DockerResolvedImageState>;
  listContainers: () => Promise<DockerContainerSummary[]>;
  inspectContainer: (containerId: string) => Promise<DockerContainerInfo>;
  routeIdFor: (
    organizationId: string,
    projectSlug: string,
    version: number,
  ) => string;
  getRoutePath: (routeId: string) => string;
  getPublicUrlForPort: (port: number) => string;
  getPublicUrlForRoutePath: (routePath: string) => string;
  cpuKind: string;
  inspectImageSafe: (imageRefOrId: string) => Promise<DockerImageInfo | null>;
}): Promise<StudioMachineSummary[]> {
  const desiredImage = await deps.getDesiredImage();
  const desiredImageState = await deps.getDesiredImageStateForRef(desiredImage);
  const containers = await deps.listContainers();
  const summaries: StudioMachineSummary[] = [];
  const runtimeImageCache = new Map<string, Promise<DockerImageInfo | null>>();

  for (const container of containers) {
    const identity = getContainerIdentity(container);
    if (!identity) continue;

    const inspected = await deps.inspectContainer(container.Id);
    const routeId =
      getContainerRouteId(inspected) ||
      deps.routeIdFor(
        identity.organizationId,
        identity.projectSlug,
        identity.version,
      );
    const routePath = deps.getRoutePath(routeId);
    const running = inspected.State?.Status === "running";
    const externalPort = getContainerExternalPort(inspected);
    summaries.push(
      await buildContainerSummaryWorkflow({
        container: inspected,
        desiredImageState,
        routePath,
        url: running
          ? externalPort
            ? deps.getPublicUrlForPort(externalPort)
            : deps.getPublicUrlForRoutePath(routePath)
          : null,
        runtimeUrl: running && externalPort ? deps.getPublicUrlForPort(externalPort) : null,
        compatibilityUrl: deps.getPublicUrlForRoutePath(routePath),
        cpuKind: deps.cpuKind,
        runtimeImageCache,
        inspectImageSafe: deps.inspectImageSafe,
      }),
    );
  }

  summaries.sort((left, right) =>
    (right.createdAt || "").localeCompare(left.createdAt || ""),
  );
  return summaries;
}

async function assertStudioContainer(deps: {
  inspectContainer: (containerId: string) => Promise<DockerContainerInfo>;
}, machineId: string, action: string): Promise<{
  container: DockerContainerInfo;
  identity: StudioIdentity;
}> {
  const container = await deps.inspectContainer(machineId);
  const identity = getContainerIdentity(container);
  if (!identity) {
    throw new Error(
      `[DockerMachines] Refusing to ${action} non-studio container ${machineId}`,
    );
  }
  return { container, identity };
}

export async function parkStudioMachineWorkflow(
  deps: {
    inspectContainer: (containerId: string) => Promise<DockerContainerInfo>;
    routeIdFor: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => string;
    stopContainerIfRunning: (container: DockerContainerInfo) => Promise<void>;
    removeRuntimeRoute: (routeId: string) => Promise<void>;
    key: (organizationId: string, projectSlug: string, version: number) => string;
    deleteLastActivity: (studioKey: string) => void;
  },
  machineId: string,
): Promise<StudioMachineParkResult> {
  const { container, identity } = await assertStudioContainer(deps, machineId, "park");
  const routeId =
    getContainerRouteId(container) ||
    deps.routeIdFor(
      identity.organizationId,
      identity.projectSlug,
      identity.version,
    );
  await deps.stopContainerIfRunning(container);
  await deps.removeRuntimeRoute(routeId);
  deps.deleteLastActivity(
    deps.key(identity.organizationId, identity.projectSlug, identity.version),
  );
  return "stopped";
}

export async function destroyStudioMachineWorkflow(
  deps: {
    inspectContainer: (containerId: string) => Promise<DockerContainerInfo>;
    routeIdFor: (
      organizationId: string,
      projectSlug: string,
      version: number,
    ) => string;
    stopContainerIfRunning: (container: DockerContainerInfo) => Promise<void>;
    removeRuntimeRoute: (routeId: string) => Promise<void>;
    removeContainer: (containerId: string) => Promise<void>;
    key: (organizationId: string, projectSlug: string, version: number) => string;
    deleteLastActivity: (studioKey: string) => void;
  },
  machineId: string,
): Promise<void> {
  const { container, identity } = await assertStudioContainer(deps, machineId, "destroy");
  const routeId =
    getContainerRouteId(container) ||
    deps.routeIdFor(
      identity.organizationId,
      identity.projectSlug,
      identity.version,
    );
  await deps.stopContainerIfRunning(container);
  await deps.removeRuntimeRoute(routeId);
  await deps.removeContainer(container.Id);
  deps.deleteLastActivity(
    deps.key(identity.organizationId, identity.projectSlug, identity.version),
  );
}
