import crypto from "node:crypto";
import type { StudioMachineStartArgs } from "../types";
import {
  STUDIO_ACCESS_TOKEN_ENV_KEY,
  trimToken,
} from "../fly/machineModel";
import type {
  DockerContainerCreateConfig,
  DockerContainerInfo,
  DockerContainerStateStatus,
  DockerContainerSummary,
  DockerImageInfo,
} from "./types";

export type StudioIdentity = {
  organizationId: string;
  projectSlug: string;
  version: number;
};

export type DockerResolvedImageState = {
  requestedRef: string;
  imageId: string | null;
  repoDigest: string | null;
  versionLabel: string | null;
  revisionLabel: string | null;
  source: "local" | "pulled" | "cached" | "unknown";
  checkedAt: string;
};

type ContainerImageComparison = {
  drift: boolean;
  comparable: boolean;
};

export type ContainerReconcileNeeds = {
  image: boolean;
  resources: boolean;
  accessToken: boolean;
  network: boolean;
  mainBackendUrl: boolean;
  env: boolean;
};

export const STUDIO_INTERNAL_PORT = 3100;
export const STUDIO_IMAGE_REF_LABEL = "vivd_image";
export const STUDIO_IMAGE_ID_LABEL = "vivd_image_id";
export const STUDIO_IMAGE_DIGEST_LABEL = "vivd_image_digest";
export const STUDIO_IMAGE_VERSION_LABEL = "vivd_image_version";
export const STUDIO_IMAGE_REVISION_LABEL = "vivd_image_revision";
export const OCI_IMAGE_VERSION_LABEL = "org.opencontainers.image.version";
export const OCI_IMAGE_REVISION_LABEL = "org.opencontainers.image.revision";

function parseEnvList(values: string[] | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const value of values || []) {
    const idx = value.indexOf("=");
    if (idx <= 0) continue;
    env[value.slice(0, idx)] = value.slice(idx + 1);
  }
  return env;
}

export function isContainerInfo(
  container: DockerContainerSummary | DockerContainerInfo,
): container is DockerContainerInfo {
  return "Config" in container || "Name" in container;
}

export function getContainerLabels(
  container: DockerContainerSummary | DockerContainerInfo,
): Record<string, string> {
  if (isContainerInfo(container)) {
    return container.Config?.Labels ?? {};
  }
  return container.Labels ?? {};
}

export function getContainerEnv(
  container: DockerContainerInfo,
): Record<string, string> {
  return parseEnvList(container.Config?.Env);
}

export function getContainerName(
  container: DockerContainerSummary | DockerContainerInfo,
): string | null {
  if (
    isContainerInfo(container) &&
    typeof container.Name === "string" &&
    container.Name.trim()
  ) {
    return container.Name.replace(/^\/+/, "");
  }
  if (
    "Names" in container &&
    Array.isArray(container.Names) &&
    container.Names.length > 0
  ) {
    const first = container.Names[0];
    if (typeof first === "string" && first.trim()) {
      return first.replace(/^\/+/, "");
    }
  }
  return null;
}

export function getContainerConfiguredImage(
  container: DockerContainerSummary | DockerContainerInfo,
  desiredImage?: string,
): string | null {
  const labels = getContainerLabels(container);
  const fromLabel = trimToken(labels[STUDIO_IMAGE_REF_LABEL]);
  if (fromLabel) return fromLabel;

  const raw =
    (isContainerInfo(container)
      ? trimToken(container.Config?.Image)
      : trimToken(container.Image)) || null;
  if (!raw) return null;

  const digestIndex = !desiredImage?.includes("@") ? raw.indexOf("@") : -1;
  return digestIndex === -1 ? raw : trimToken(raw.slice(0, digestIndex));
}

function getImageLabels(image: DockerImageInfo): Record<string, string> {
  return image.Config?.Labels ?? {};
}

export function getImageLabel(
  image: DockerImageInfo,
  key: string,
): string | null {
  return trimToken(getImageLabels(image)[key]);
}

function imageReferenceBase(imageRef: string): string {
  const withoutDigest = imageRef.split("@", 1)[0] || imageRef;
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  return lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
}

function digestValue(value: string | null | undefined): string | null {
  const trimmed = trimToken(value);
  if (!trimmed) return null;
  if (trimmed.startsWith("sha256:")) return trimmed;
  const atIndex = trimmed.indexOf("@");
  if (atIndex >= 0) return trimToken(trimmed.slice(atIndex + 1));
  return null;
}

export function selectRepoDigestForRef(
  repoDigests: string[] | undefined,
  requestedRef: string,
): string | null {
  const desiredBase = imageReferenceBase(requestedRef);
  for (const entry of repoDigests || []) {
    const trimmed = trimToken(entry);
    if (!trimmed) continue;
    const base = trimmed.split("@", 1)[0] || trimmed;
    if (base === desiredBase) return trimmed;
  }
  return trimToken(repoDigests?.find((entry) => trimToken(entry)));
}

export function buildResolvedImageState(options: {
  requestedRef: string;
  image: DockerImageInfo;
  source: Exclude<DockerResolvedImageState["source"], "cached" | "unknown">;
}): DockerResolvedImageState {
  return {
    requestedRef: options.requestedRef,
    imageId: trimToken(options.image.Id),
    repoDigest: selectRepoDigestForRef(
      options.image.RepoDigests,
      options.requestedRef,
    ),
    versionLabel: getImageLabel(options.image, OCI_IMAGE_VERSION_LABEL),
    revisionLabel: getImageLabel(options.image, OCI_IMAGE_REVISION_LABEL),
    source: options.source,
    checkedAt: new Date().toISOString(),
  };
}

export function isLikelyRemoteImageReference(imageRef: string): boolean {
  const firstSegment = imageReferenceBase(imageRef).split("/", 1)[0] || "";
  return (
    firstSegment.includes(".") ||
    firstSegment.includes(":") ||
    firstSegment === "localhost"
  );
}

export function getContainerRuntimeImageId(
  container: DockerContainerSummary | DockerContainerInfo,
): string | null {
  if (isContainerInfo(container)) {
    const fromInspect = trimToken(container.Image);
    if (fromInspect) return fromInspect;
  }
  return trimToken(getContainerLabels(container)[STUDIO_IMAGE_ID_LABEL]);
}

function getContainerRecordedImageDigest(
  container: DockerContainerSummary | DockerContainerInfo,
): string | null {
  return trimToken(getContainerLabels(container)[STUDIO_IMAGE_DIGEST_LABEL]);
}

export function compareContainerImageState(options: {
  container: DockerContainerInfo;
  desiredImage: string;
  desiredImageState?: DockerResolvedImageState | null;
}): ContainerImageComparison {
  const currentImageId = getContainerRuntimeImageId(options.container);
  const desiredImageId = trimToken(options.desiredImageState?.imageId);
  if (currentImageId && desiredImageId) {
    return {
      drift: currentImageId !== desiredImageId,
      comparable: true,
    };
  }

  const currentDigest = digestValue(getContainerRecordedImageDigest(options.container));
  const desiredDigest = digestValue(options.desiredImageState?.repoDigest);
  if (currentDigest && desiredDigest) {
    return {
      drift: currentDigest !== desiredDigest,
      comparable: true,
    };
  }

  const currentImage = getContainerConfiguredImage(
    options.container,
    options.desiredImage,
  );
  if (!currentImage) {
    return { drift: false, comparable: false };
  }

  return {
    drift: currentImage !== options.desiredImage,
    comparable: currentImage !== options.desiredImage,
  };
}

export function getContainerAccessToken(
  container: DockerContainerInfo,
): string | null {
  return trimToken(getContainerEnv(container)[STUDIO_ACCESS_TOKEN_ENV_KEY]);
}

export function getContainerIdentity(
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

export function getContainerStudioId(
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

export function getContainerRouteId(
  container: DockerContainerSummary | DockerContainerInfo,
): string | null {
  return trimToken(getContainerLabels(container)["vivd_route_id"]);
}

export function getContainerExternalPort(
  container: DockerContainerSummary | DockerContainerInfo,
): number | null {
  const fromLabel = trimToken(getContainerLabels(container)["vivd_external_port"]);
  if (fromLabel) {
    const parsed = Number.parseInt(fromLabel, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const bindings = container.HostConfig?.PortBindings?.[`${STUDIO_INTERNAL_PORT}/tcp`];
  const fromBinding = bindings?.find((binding) => {
    const hostPort = trimToken(binding.HostPort);
    if (!hostPort) return false;
    const parsed = Number.parseInt(hostPort, 10);
    return Number.isFinite(parsed) && parsed > 0;
  });
  if (fromBinding?.HostPort) {
    const parsed = Number.parseInt(fromBinding.HostPort, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return null;
}

export function containerStateStatus(
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

export function mapContainerState(
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

export function isRunningContainer(
  container: DockerContainerSummary | DockerContainerInfo,
): boolean {
  return containerStateStatus(container) === "running";
}

export function isStoppedContainer(
  container: DockerContainerSummary | DockerContainerInfo,
): boolean {
  const state = containerStateStatus(container);
  return state === "created" || state === "exited";
}

export function resolveContainerReconcileState(options: {
  container: DockerContainerInfo;
  desiredImage: string;
  desiredImageState?: DockerResolvedImageState | null;
  desiredAccessToken?: string | null;
  desiredNanoCpus: number;
  desiredMemoryBytes: number;
  desiredNetworkName: string;
  desiredMainBackendUrl?: string | null;
  desiredEnvSubset?: Record<string, string>;
  generateStudioAccessToken: () => string;
}): { accessToken: string; needs: ContainerReconcileNeeds } {
  const currentToken = getContainerAccessToken(options.container);
  const desiredToken = trimToken(options.desiredAccessToken);
  const accessToken =
    currentToken || desiredToken || options.generateStudioAccessToken();

  const imageComparison = compareContainerImageState({
    container: options.container,
    desiredImage: options.desiredImage,
    desiredImageState: options.desiredImageState,
  });
  const currentEnv = getContainerEnv(options.container);
  const currentNanoCpus = options.container.HostConfig?.NanoCpus || 0;
  const currentMemory = options.container.HostConfig?.Memory || 0;
  const currentNetworkMode = trimToken(options.container.HostConfig?.NetworkMode) || "";
  const currentNetworks = options.container.NetworkSettings?.Networks;
  const currentNetworkAttached = currentNetworks
    ? Boolean(currentNetworks[options.desiredNetworkName])
    : true;
  const currentMainBackendUrl = trimToken(currentEnv.MAIN_BACKEND_URL) || null;

  return {
    accessToken,
    needs: {
      image: imageComparison.drift,
      resources:
        currentNanoCpus !== options.desiredNanoCpus ||
        currentMemory !== options.desiredMemoryBytes,
      accessToken: currentToken !== accessToken,
      network:
        currentNetworkMode !== options.desiredNetworkName ||
        !currentNetworkAttached,
      mainBackendUrl:
        !!options.desiredMainBackendUrl &&
        currentMainBackendUrl !== options.desiredMainBackendUrl,
      env: Object.entries(options.desiredEnvSubset || {}).some(([key, value]) => {
        if (typeof value !== "string") return false;
        return trimToken(currentEnv[key]) !== trimToken(value);
      }),
    },
  };
}

export function hasContainerDrift(needs: ContainerReconcileNeeds): boolean {
  return (
    needs.image ||
    needs.resources ||
    needs.accessToken ||
    needs.network ||
    needs.mainBackendUrl ||
    needs.env
  );
}

export function isMissingImageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no such image");
}

export function isMissingNativeManifestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no matching manifest");
}

export function isContainerNameConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("container name") ||
    (normalized.includes("conflict") && normalized.includes("already in use"))
  );
}

export function isContainerNetworkingSetupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to set up container networking") ||
    (normalized.includes("network") && normalized.includes("not found"))
  );
}

export function isContainerPortConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("port is already allocated") ||
    normalized.includes("bind for 0.0.0.0:") ||
    normalized.includes("address already in use")
  );
}

export function getContainerCreatedAt(container: DockerContainerInfo): string | null {
  const raw = trimToken(container.Created);
  return raw || null;
}

export function getContainerUpdatedAt(container: DockerContainerInfo): string | null {
  const startedAt = trimToken(container.State?.StartedAt);
  if (startedAt && startedAt !== "0001-01-01T00:00:00Z") return startedAt;
  const finishedAt = trimToken(container.State?.FinishedAt);
  if (finishedAt && finishedAt !== "0001-01-01T00:00:00Z") return finishedAt;
  return getContainerCreatedAt(container);
}

export function findContainer(
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

export function createContainerSpec(options: {
  args: StudioMachineStartArgs;
  studioId: string;
  accessToken: string;
  desiredImage: string;
  desiredImageState?: DockerResolvedImageState | null;
  routeId: string;
  externalPort: number;
  env: Record<string, string>;
  desiredKillTimeoutSeconds: number;
  nanoCpus: number;
  memoryBytes: number;
  networkName: string;
}): DockerContainerCreateConfig {
  const labels: Record<string, string> = {
    vivd_managed: "true",
    vivd_provider: "docker",
    vivd_organization_id: options.args.organizationId,
    vivd_project_slug: options.args.projectSlug,
    vivd_project_version: String(options.args.version),
    vivd_studio_id: options.studioId,
    vivd_external_port: String(options.externalPort),
    [STUDIO_IMAGE_REF_LABEL]:
      options.desiredImageState?.requestedRef || options.desiredImage,
    vivd_route_id: options.routeId,
    vivd_created_at: new Date().toISOString(),
    ...(options.desiredImageState?.imageId
      ? { [STUDIO_IMAGE_ID_LABEL]: options.desiredImageState.imageId }
      : {}),
    ...(options.desiredImageState?.repoDigest
      ? { [STUDIO_IMAGE_DIGEST_LABEL]: options.desiredImageState.repoDigest }
      : {}),
    ...(options.desiredImageState?.versionLabel
      ? { [STUDIO_IMAGE_VERSION_LABEL]: options.desiredImageState.versionLabel }
      : {}),
    ...(options.desiredImageState?.revisionLabel
      ? { [STUDIO_IMAGE_REVISION_LABEL]: options.desiredImageState.revisionLabel }
      : {}),
  };

  return {
    Image: options.desiredImage,
    Env: Object.entries(options.env).map(([key, value]) => `${key}=${value}`),
    Labels: labels,
    StopTimeout: options.desiredKillTimeoutSeconds,
    ExposedPorts: {
      [`${STUDIO_INTERNAL_PORT}/tcp`]: {},
    },
    HostConfig: {
      NetworkMode: options.networkName,
      NanoCpus: options.nanoCpus,
      Memory: options.memoryBytes,
      PortBindings: {
        [`${STUDIO_INTERNAL_PORT}/tcp`]: [{ HostPort: String(options.externalPort) }],
      },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [options.networkName]: {},
      },
    },
  };
}
