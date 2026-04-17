import os from "node:os";
import { soloSelfHostDefaults } from "@vivd/shared/config";
import type { InstallProfile } from "./InstallProfileService";
import { DockerApiClient } from "../studioMachines/docker/apiClient";
import { DockerProviderConfig } from "../studioMachines/docker/providerConfig";
import { listSemverImagesFromGhcr, normalizeGhcrRepository } from "../studioMachines/fly/ghcr";

type ReleaseStatus = "available" | "current" | "unknown";

type LatestReleaseInfo = {
  version: string;
  tag: string;
  image: string;
};

type CurrentRuntimeInfo = {
  currentVersion: string | null;
  currentRevision: string | null;
  currentImage: string | null;
  currentImageTag: string | null;
  composeProject: string | null;
  updateWorkdirContainerPath: string | null;
  updateWorkdirHostPath: string | null;
};

type ManagedUpdateState = {
  enabled: boolean;
  reason: string | null;
  helperImage: string | null;
  workdir: string | null;
};

type InstanceSoftwareServiceDeps = {
  env: NodeJS.ProcessEnv;
  now: () => number;
  getHostname: () => string;
  dockerApiClient: Pick<
    DockerApiClient,
    | "inspectContainer"
    | "listContainers"
    | "pullImage"
    | "createContainer"
    | "startContainer"
  >;
  listSemverImagesFromGhcr: typeof listSemverImagesFromGhcr;
};

export type InstanceSoftwareStatus = {
  currentVersion: string | null;
  currentRevision: string | null;
  currentImage: string | null;
  currentImageTag: string | null;
  latestVersion: string | null;
  latestTag: string | null;
  latestImage: string | null;
  releaseStatus: ReleaseStatus;
  releaseError?: string;
  managedUpdate: ManagedUpdateState;
};

export type ManagedInstanceSoftwareUpdateResult =
  | {
      started: true;
      helperContainerId: string;
      helperImage: string;
      targetTag: string;
    }
  | {
      started: false;
      error: string;
      targetTag: string | null;
    };

const RELEASE_TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const DEFAULT_UPDATE_HELPER_IMAGE = "docker:28-cli";
const DEFAULT_UPDATE_SERVICES = ["backend", "frontend", "scraper"];
const MANAGED_UPDATE_HELPER_LABEL = "selfhost_updater";

function trimToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseImageTag(imageRef: string | null): string | null {
  if (!imageRef) return null;
  const withoutDigest = imageRef.split("@")[0] || imageRef;
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  if (lastColon <= lastSlash) return null;
  return trimToken(withoutDigest.slice(lastColon + 1));
}

function stripImageRefTag(imageRef: string | null): string | null {
  if (!imageRef) return null;
  const withoutDigest = imageRef.split("@")[0] || imageRef;
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  if (lastColon <= lastSlash) return trimToken(withoutDigest);
  return trimToken(withoutDigest.slice(0, lastColon));
}

function normalizeSemver(value: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return `${Number.parseInt(match[1], 10)}.${Number.parseInt(match[2], 10)}.${Number.parseInt(
    match[3],
    10,
  )}`;
}

function compareNormalizedSemver(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function isLatestTrack(tag: string | null): boolean {
  return (tag || "").trim().toLowerCase() === "latest";
}

function parseServiceList(raw: string | null | undefined): string[] {
  const entries = (raw || "")
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : [...DEFAULT_UPDATE_SERVICES];
}

function buildTargetStudioImage(options: {
  configuredImage: string | null;
  configuredRepository: string | null;
  targetTag: string;
}): string {
  const explicitBase = stripImageRefTag(options.configuredImage);
  if (explicitBase) return `${explicitBase}:${options.targetTag}`;

  const configuredRepository = trimToken(options.configuredRepository);
  if (configuredRepository) {
    try {
      return `${normalizeGhcrRepository(configuredRepository).imageBase}:${options.targetTag}`;
    } catch {
      return `${configuredRepository}:${options.targetTag}`;
    }
  }

  return `${soloSelfHostDefaults.dockerStudioImageRepository}:${options.targetTag}`;
}

export function buildManagedSelfHostUpdateScript(): string {
  return [
    "set -eu",
    'if [ -z "${UPDATE_WORKDIR:-}" ]; then',
    '  echo "Missing UPDATE_WORKDIR for managed self-host update" >&2',
    "  exit 1",
    "fi",
    'cd "${UPDATE_WORKDIR}"',
    'if [ ! -f "${UPDATE_WORKDIR}/docker-compose.yml" ]; then',
    '  echo "Missing ${UPDATE_WORKDIR}/docker-compose.yml for managed self-host update" >&2',
    "  exit 1",
    "fi",
    'if [ ! -f ".env" ]; then',
    '  echo "Missing ${UPDATE_WORKDIR}/.env for managed self-host update" >&2',
    "  exit 1",
    "fi",
    "update_env_var() {",
    '  key="$1"',
    '  value="$2"',
    '  file=".env"',
    '  escaped_value=$(printf "%s" "$value" | sed \'s/[\\\\/&]/\\\\&/g\')',
    '  if grep -Eq "^${key}=" "$file"; then',
    '    sed -i "s/^${key}=.*/${key}=${escaped_value}/" "$file"',
    "  else",
    '    printf "\\n%s=%s\\n" "$key" "$value" >> "$file"',
    "  fi",
    "}",
    'if [ "${UPDATE_SELFHOST_IMAGE_TAG:-0}" = "1" ]; then',
    '  update_env_var "VIVD_SELFHOST_IMAGE_TAG" "${TARGET_TAG}"',
    "fi",
    'if [ "${UPDATE_STUDIO_IMAGE:-0}" = "1" ] && [ -n "${TARGET_STUDIO_IMAGE:-}" ]; then',
    '  update_env_var "DOCKER_STUDIO_IMAGE" "${TARGET_STUDIO_IMAGE}"',
    "fi",
    "run_compose() {",
    '  if [ -n "${UPDATE_COMPOSE_PROJECT:-}" ]; then',
    '    docker compose -f "${UPDATE_WORKDIR}/docker-compose.yml" --project-directory "${UPDATE_WORKDIR}" -p "${UPDATE_COMPOSE_PROJECT}" "$@"',
    "  else",
    '    docker compose -f "${UPDATE_WORKDIR}/docker-compose.yml" --project-directory "${UPDATE_WORKDIR}" "$@"',
    "  fi",
    "}",
    'run_compose pull ${UPDATE_SERVICES}',
    'run_compose up -d --force-recreate ${UPDATE_SERVICES}',
    'docker image prune -af >/dev/null 2>&1 || true',
  ].join("\n");
}

function isMissingImageError(error: unknown, imageRef: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const imageToken = imageRef.trim().toLowerCase();
  return (
    normalized.includes("no such image") ||
    (imageToken.length > 0 &&
      normalized.includes(imageToken) &&
      (normalized.includes("not found") || normalized.includes("pull access denied")))
  );
}

export class InstanceSoftwareService {
  private readonly deps: InstanceSoftwareServiceDeps;
  private latestReleaseCache:
    | { fetchedAt: number; value: LatestReleaseInfo | null; error?: string }
    | null = null;
  private latestReleaseInflight:
    | Promise<{ value: LatestReleaseInfo | null; error?: string }>
    | null = null;

  constructor(deps: InstanceSoftwareServiceDeps) {
    this.deps = deps;
  }

  async getStatus(installProfile: InstallProfile): Promise<InstanceSoftwareStatus> {
    const current = await this.resolveCurrentRuntime();
    const latestRelease = await this.getLatestRelease();
    const currentComparable = normalizeSemver(current.currentVersion || current.currentImageTag);
    const latestComparable = normalizeSemver(latestRelease.value?.version || null);

    let releaseStatus: ReleaseStatus = "unknown";
    if (currentComparable && latestComparable) {
      releaseStatus =
        compareNormalizedSemver(currentComparable, latestComparable) < 0 ? "available" : "current";
    }

    return {
      currentVersion: current.currentVersion,
      currentRevision: current.currentRevision,
      currentImage: current.currentImage,
      currentImageTag: current.currentImageTag,
      latestVersion: latestRelease.value?.version || null,
      latestTag: latestRelease.value?.tag || null,
      latestImage: latestRelease.value?.image || null,
      releaseStatus,
      ...(latestRelease.error ? { releaseError: latestRelease.error } : {}),
      managedUpdate: this.resolveManagedUpdateState(installProfile, current),
    };
  }

  async startManagedUpdate(options: {
    installProfile: InstallProfile;
    targetTag: string;
  }): Promise<ManagedInstanceSoftwareUpdateResult> {
    if (options.installProfile !== "solo") {
      return {
        started: false,
        error: "Managed updates are not available for this installation.",
        targetTag: null,
      };
    }

    const current = await this.resolveCurrentRuntime();
    const managedUpdate = this.resolveManagedUpdateState(options.installProfile, current);
    if (!managedUpdate.enabled || !current.updateWorkdirHostPath) {
      return {
        started: false,
        error:
          managedUpdate.reason ||
          "Managed self-host updates are not configured for this installation.",
        targetTag: null,
      };
    }

    const targetTag = trimToken(options.targetTag);
    if (!targetTag || !RELEASE_TAG_PATTERN.test(targetTag)) {
      return {
        started: false,
        error: "Invalid release tag for managed update.",
        targetTag: null,
      };
    }

    const helperImage = managedUpdate.helperImage || DEFAULT_UPDATE_HELPER_IMAGE;
    const currentStudioImage = trimToken(this.deps.env.DOCKER_STUDIO_IMAGE);
    const currentStudioImageTag = parseImageTag(currentStudioImage);
    const shouldRewriteSelfHostImageTag =
      !!current.currentImageTag && !isLatestTrack(current.currentImageTag);
    const shouldRewriteStudioImage =
      !!currentStudioImageTag && !isLatestTrack(currentStudioImageTag);
    const targetStudioImage = buildTargetStudioImage({
      configuredImage: currentStudioImage,
      configuredRepository: trimToken(this.deps.env.DOCKER_STUDIO_IMAGE_REPO),
      targetTag,
    });
    const updateServices = parseServiceList(this.deps.env.VIVD_SELFHOST_UPDATE_SERVICES);
    const socketPath =
      trimToken(this.deps.env.DOCKER_STUDIO_SOCKET_PATH) ||
      soloSelfHostDefaults.dockerStudioSocketPath;

    try {
      const existingUpdater = await this.findActiveManagedUpdateContainer();
      if (existingUpdater) {
        console.info("[InstanceSoftwareService] Managed self-host update already running", {
          helperContainerId: existingUpdater.Id,
          targetTag,
        });
        return {
          started: false,
          error: "A managed self-host update is already running for this installation.",
          targetTag,
        };
      }

      await this.deps.dockerApiClient.pullImage(helperImage);

      console.info("[InstanceSoftwareService] Starting managed self-host update", {
        targetTag,
        helperImage,
        composeProject: current.composeProject,
        updateServices,
        updateWorkdirHostPath: current.updateWorkdirHostPath,
        rewriteSelfHostImageTag: shouldRewriteSelfHostImageTag,
        rewriteStudioImage: shouldRewriteStudioImage,
      });

      const created = await this.createManagedUpdateHelperContainer({
        helperImage,
        targetTag,
        targetStudioImage,
        updateServices,
        composeProject: current.composeProject,
        socketPath,
        updateWorkdirHostPath: current.updateWorkdirHostPath,
        shouldRewriteSelfHostImageTag,
        shouldRewriteStudioImage,
      });

      await this.deps.dockerApiClient.startContainer(created.Id);
      console.info("[InstanceSoftwareService] Managed self-host update started", {
        helperContainerId: created.Id,
        targetTag,
      });
      return {
        started: true,
        helperContainerId: created.Id,
        helperImage,
        targetTag,
      };
    } catch (error) {
      console.error("[InstanceSoftwareService] Managed self-host update failed to start", {
        targetTag,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        started: false,
        error: error instanceof Error ? error.message : String(error),
        targetTag,
      };
    }
  }

  private async getLatestRelease(): Promise<{ value: LatestReleaseInfo | null; error?: string }> {
    const cacheTtlMs = 5 * 60_000;
    const now = this.deps.now();
    if (this.latestReleaseCache && now - this.latestReleaseCache.fetchedAt < cacheTtlMs) {
      return {
        value: this.latestReleaseCache.value,
        ...(this.latestReleaseCache.error ? { error: this.latestReleaseCache.error } : {}),
      };
    }

    const inflight = this.latestReleaseInflight;
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const listed = await this.deps.listSemverImagesFromGhcr({
          repository: soloSelfHostDefaults.serverImageRepository,
          timeoutMs: 10_000,
          limit: 1,
        });
        const latest = listed.images[0];
        const value = latest
          ? {
              version: latest.version,
              tag: latest.tag,
              image: latest.image,
            }
          : null;
        this.latestReleaseCache = {
          fetchedAt: this.deps.now(),
          value,
        };
        return { value };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.latestReleaseCache = {
          fetchedAt: this.deps.now(),
          value: null,
          error: message,
        };
        return { value: null, error: message };
      } finally {
        this.latestReleaseInflight = null;
      }
    })();

    this.latestReleaseInflight = promise;
    return promise;
  }

  private async resolveCurrentRuntime(): Promise<CurrentRuntimeInfo> {
    const updateWorkdirContainerPath = trimToken(this.deps.env.VIVD_SELFHOST_UPDATE_WORKDIR);
    let currentImage = trimToken(this.deps.env.BACKEND_IMAGE);
    let composeProject: string | null = null;
    let updateWorkdirHostPath: string | null = null;

    try {
      const hostname = trimToken(this.deps.getHostname());
      if (hostname) {
        const inspected = await this.deps.dockerApiClient.inspectContainer(hostname);
        currentImage =
          trimToken(inspected.Config?.Image) || trimToken(inspected.Image) || currentImage;
        composeProject = trimToken(inspected.Config?.Labels?.["com.docker.compose.project"]);

        if (updateWorkdirContainerPath && Array.isArray(inspected.Mounts)) {
          const matchingMount = inspected.Mounts.find(
            (mount) => trimToken(mount.Destination) === updateWorkdirContainerPath,
          );
          updateWorkdirHostPath = trimToken(matchingMount?.Source);
        }
      }
    } catch {
      // Running outside Docker or without socket access. Keep env-based fallbacks.
    }

    const currentImageTag =
      trimToken(this.deps.env.VIVD_SELFHOST_IMAGE_TAG) || parseImageTag(currentImage);
    const currentVersion =
      trimToken(this.deps.env.VIVD_IMAGE_VERSION) ||
      normalizeSemver(currentImageTag) ||
      null;

    return {
      currentVersion,
      currentRevision: trimToken(this.deps.env.VIVD_IMAGE_REVISION),
      currentImage,
      currentImageTag,
      composeProject,
      updateWorkdirContainerPath,
      updateWorkdirHostPath,
    };
  }

  private async findActiveManagedUpdateContainer(): Promise<{ Id: string } | null> {
    try {
      const containers = await this.deps.dockerApiClient.listContainers();
      return (
        containers.find((container) => {
          const labels = container.Labels || {};
          const role = trimToken(labels.vivd_role);
          const state = trimToken(container.State)?.toLowerCase();
          return (
            role === MANAGED_UPDATE_HELPER_LABEL &&
            (!!state && ["created", "running", "restarting"].includes(state))
          );
        }) || null
      );
    } catch {
      return null;
    }
  }

  private async createManagedUpdateHelperContainer(options: {
    helperImage: string;
    targetTag: string;
    targetStudioImage: string;
    updateServices: string[];
    composeProject: string | null;
    socketPath: string;
    updateWorkdirHostPath: string;
    shouldRewriteSelfHostImageTag: boolean;
    shouldRewriteStudioImage: boolean;
  }) {
    const config = {
      Image: options.helperImage,
      Env: [
        `TARGET_TAG=${options.targetTag}`,
        `TARGET_STUDIO_IMAGE=${options.targetStudioImage}`,
        `UPDATE_WORKDIR=${options.updateWorkdirHostPath}`,
        `UPDATE_SELFHOST_IMAGE_TAG=${options.shouldRewriteSelfHostImageTag ? "1" : "0"}`,
        `UPDATE_STUDIO_IMAGE=${options.shouldRewriteStudioImage ? "1" : "0"}`,
        `UPDATE_SERVICES=${options.updateServices.join(" ")}`,
        `UPDATE_COMPOSE_PROJECT=${options.composeProject || ""}`,
      ],
      Labels: {
        vivd_managed: "true",
        vivd_role: MANAGED_UPDATE_HELPER_LABEL,
        vivd_target_tag: options.targetTag,
      },
      WorkingDir: options.updateWorkdirHostPath,
      Cmd: ["sh", "-lc", buildManagedSelfHostUpdateScript()],
      HostConfig: {
        AutoRemove: true,
        Binds: [
          `${options.socketPath}:/var/run/docker.sock`,
          `${options.updateWorkdirHostPath}:${options.updateWorkdirHostPath}`,
        ],
      },
    };

    try {
      return await this.deps.dockerApiClient.createContainer({
        name: `vivd-selfhost-updater-${this.deps.now()}`,
        config,
      });
    } catch (error) {
      if (!isMissingImageError(error, options.helperImage)) {
        throw error;
      }

      console.warn(
        "[InstanceSoftwareService] Helper image missing during updater container create; retrying after pull",
        {
          helperImage: options.helperImage,
          targetTag: options.targetTag,
        },
      );
      await this.deps.dockerApiClient.pullImage(options.helperImage);
      return await this.deps.dockerApiClient.createContainer({
        name: `vivd-selfhost-updater-${this.deps.now()}`,
        config,
      });
    }
  }

  private resolveManagedUpdateState(
    installProfile: InstallProfile,
    current: CurrentRuntimeInfo,
  ): ManagedUpdateState {
    if (installProfile !== "solo") {
      return {
        enabled: false,
        reason: "Platform deployments stay deployment-managed for now.",
        helperImage: null,
        workdir: null,
      };
    }

    const helperImage =
      trimToken(this.deps.env.VIVD_SELFHOST_UPDATE_HELPER_IMAGE) ||
      DEFAULT_UPDATE_HELPER_IMAGE;
    if (!current.updateWorkdirContainerPath) {
      return {
        enabled: false,
        reason: "Managed self-host updates are not configured for this installation.",
        helperImage,
        workdir: null,
      };
    }

    if (!current.updateWorkdirHostPath) {
      return {
        enabled: false,
        reason: "The configured self-host update workdir is not mounted into the backend container.",
        helperImage,
        workdir: current.updateWorkdirContainerPath,
      };
    }

    return {
      enabled: true,
      reason: null,
      helperImage,
      workdir: current.updateWorkdirContainerPath,
    };
  }
}

const dockerConfig = new DockerProviderConfig();
const defaultDockerApiClient = new DockerApiClient({
  getSocketPath: () => dockerConfig.socketPath,
  getBaseUrl: () => dockerConfig.apiBaseUrl,
  getApiVersion: () => dockerConfig.apiVersion,
});

export const instanceSoftwareService = new InstanceSoftwareService({
  env: process.env,
  now: () => Date.now(),
  getHostname: () => os.hostname(),
  dockerApiClient: defaultDockerApiClient,
  listSemverImagesFromGhcr,
});
