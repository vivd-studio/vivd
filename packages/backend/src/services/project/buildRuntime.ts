import crypto from "node:crypto";
import { runProjectArtifactBuild, type ArtifactBuildKind } from "@vivd/builder";
import { DockerApiClient } from "../studioMachines/docker/apiClient";
import { DockerStudioImageResolver } from "../studioMachines/docker/imageResolver";
import { DockerProviderConfig } from "../studioMachines/docker/providerConfig";
import type { DockerContainerCreateConfig } from "../studioMachines/docker/types";
import { FlyApiClient } from "../studioMachines/fly/apiClient";
import { FlyStudioImageResolver } from "../studioMachines/fly/imageResolver";
import { FlyProviderConfig } from "../studioMachines/fly/providerConfig";
import type { FlyMachineConfig } from "../studioMachines/fly/types";
import type { StudioMachineProviderKind } from "../studioMachines/types";

export type ProjectArtifactBuildRequest = {
  organizationId: string;
  slug: string;
  version: number;
  kind: ArtifactBuildKind;
  commitHash?: string;
};

export interface ArtifactBuildRuntime {
  kind: StudioMachineProviderKind;
  startBuild(request: ProjectArtifactBuildRequest): Promise<void>;
}

function trimToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function extractImageTag(image: string): string | null {
  const trimmed = image.trim();
  if (!trimmed) return null;
  const withoutDigest = trimmed.includes("@") ? trimmed.slice(0, trimmed.indexOf("@")) : trimmed;
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  if (lastColon <= lastSlash) return null;
  return trimToken(withoutDigest.slice(lastColon + 1));
}

export function deriveBuilderImageFromStudioImage(options: {
  studioImage: string;
  builderRepository: string;
  configuredImage?: string | null;
}): string {
  const configured = trimToken(options.configuredImage);
  if (configured) return configured;

  const tag = extractImageTag(options.studioImage);
  return `${options.builderRepository}:${tag || "latest"}`;
}

function getBuilderPassthroughEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const keys = [
    "VIVD_BUCKET_MODE",
    "VIVD_S3_BUCKET",
    "VIVD_S3_ENDPOINT_URL",
    "VIVD_S3_ACCESS_KEY_ID",
    "VIVD_S3_SECRET_ACCESS_KEY",
    "VIVD_S3_SESSION_TOKEN",
    "VIVD_S3_REGION",
    "VIVD_LOCAL_S3_BUCKET",
    "VIVD_LOCAL_S3_ENDPOINT_URL",
    "VIVD_LOCAL_S3_ACCESS_KEY",
    "VIVD_LOCAL_S3_SECRET_KEY",
    "VIVD_LOCAL_S3_REGION",
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_ACCESS_KEY",
    "R2_SECRET_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "VIVD_BUILDER_INSTALL_TIMEOUT_MS",
    "VIVD_BUILDER_BUILD_TIMEOUT_MS",
    "VIVD_BUILDER_MAX_OLD_SPACE_MB",
    "VIVD_BUILDER_INSTALL_MAX_OLD_SPACE_MB",
    "VIVD_BUILDER_ASTRO_MAX_OLD_SPACE_MB",
    "NODE_AUTH_TOKEN",
    "NPM_TOKEN",
    "NPM_CONFIG_REGISTRY",
    "npm_config_registry",
    "YARN_NPM_AUTH_TOKEN",
  ];

  const result: Record<string, string> = {
    HOME: "/tmp",
    CI: "1",
  };
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      result[key] = value;
    }
  }
  return result;
}

function buildBuilderEnv(
  request: ProjectArtifactBuildRequest,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    ...getBuilderPassthroughEnv(env),
    VIVD_BUILDER_ORGANIZATION_ID: request.organizationId,
    VIVD_TENANT_ID: request.organizationId,
    VIVD_PROJECT_SLUG: request.slug,
    VIVD_PROJECT_VERSION: String(request.version),
    VIVD_BUILDER_KIND: request.kind,
    ...(request.commitHash ? { VIVD_BUILD_COMMIT_HASH: request.commitHash } : {}),
  };
}

class LocalArtifactBuildRuntime implements ArtifactBuildRuntime {
  kind = "local" as const;

  async startBuild(request: ProjectArtifactBuildRequest): Promise<void> {
    void runProjectArtifactBuild({
      ...request,
      env: process.env,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ArtifactBuild] Local ${request.kind} build failed for ${request.organizationId}/${request.slug}/v${request.version}: ${message}`,
      );
    });
  }
}

class DockerArtifactBuildRuntime implements ArtifactBuildRuntime {
  kind = "docker" as const;

  private readonly config = new DockerProviderConfig();
  private readonly apiClient = new DockerApiClient({
    getSocketPath: () => this.config.socketPath,
    getBaseUrl: () => this.config.apiBaseUrl,
    getApiVersion: () => this.config.apiVersion,
  });
  private readonly studioImageResolver = new DockerStudioImageResolver({
    getStudioImageRepository: () => this.config.studioImageRepository,
  });

  private async getBuilderImage(): Promise<string> {
    const studioImage = await this.studioImageResolver.getDesiredImage();
    return deriveBuilderImageFromStudioImage({
      studioImage,
      builderRepository: this.config.builderImageRepository,
      configuredImage: process.env.DOCKER_BUILDER_IMAGE,
    });
  }

  private buildContainerName(request: ProjectArtifactBuildRequest): string {
    const base = sanitizeName(
      `builder-${request.kind}-${request.slug}-v${request.version}`,
    ).slice(0, 40);
    const suffix = crypto.randomBytes(4).toString("hex");
    return `${base}-${suffix}`;
  }

  async startBuild(request: ProjectArtifactBuildRequest): Promise<void> {
    const image = await this.getBuilderImage();
    const containerName = this.buildContainerName(request);
    const env = buildBuilderEnv(request);
    const config: DockerContainerCreateConfig = {
      Image: image,
      Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
      Labels: {
        vivd_managed: "true",
        vivd_provider: "docker",
        vivd_builder: "true",
        vivd_organization_id: request.organizationId,
        vivd_project_slug: request.slug,
        vivd_project_version: String(request.version),
        vivd_build_kind: request.kind,
        ...(request.commitHash ? { vivd_build_commit_hash: request.commitHash } : {}),
      },
      HostConfig: {
        NetworkMode: this.config.network,
        NanoCpus: this.config.builderNanoCpus,
        Memory: this.config.builderMemoryBytes,
        AutoRemove: true,
      },
    };

    try {
      try {
        const created = await this.apiClient.createContainer({
          name: containerName,
          config,
        });
        await this.apiClient.startContainer(created.Id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes("no such image")) throw error;
        await this.apiClient.pullImage(image, {
          platform: this.config.fallbackPlatform || undefined,
        });
        const created = await this.apiClient.createContainer({
          name: containerName,
          config,
          platform: this.config.fallbackPlatform || undefined,
        });
        await this.apiClient.startContainer(created.Id);
      }
    } catch (error) {
      throw new Error(
        `[ArtifactBuild] Failed to start Docker builder for ${request.organizationId}/${request.slug}/v${request.version}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

class FlyArtifactBuildRuntime implements ArtifactBuildRuntime {
  kind = "fly" as const;

  private readonly config = new FlyProviderConfig();
  private readonly apiClient = new FlyApiClient({
    getToken: () => this.config.token,
    getAppName: () => this.config.appName,
  });
  private readonly studioImageResolver = new FlyStudioImageResolver({
    getStudioImageRepository: () => this.config.studioImageRepository,
  });

  private async getBuilderImage(): Promise<string> {
    const studioImage = await this.studioImageResolver.getDesiredImage();
    return deriveBuilderImageFromStudioImage({
      studioImage,
      builderRepository: this.config.builderImageRepository,
      configuredImage: process.env.FLY_BUILDER_IMAGE,
    });
  }

  private buildMachineName(request: ProjectArtifactBuildRequest): string {
    const base = sanitizeName(
      `builder-${request.kind}-${request.slug}-v${request.version}`,
    ).slice(0, 35);
    const suffix = crypto.randomBytes(4).toString("hex");
    return `${base}-${suffix}`;
  }

  async startBuild(request: ProjectArtifactBuildRequest): Promise<void> {
    const image = await this.getBuilderImage();
    const env = buildBuilderEnv(request);
    const machineConfig: FlyMachineConfig = {
      image,
      env,
      guest: this.config.builderGuest,
      metadata: {
        vivd_managed: "true",
        vivd_provider: "fly",
        vivd_builder: "true",
        vivd_organization_id: request.organizationId,
        vivd_project_slug: request.slug,
        vivd_project_version: String(request.version),
        vivd_build_kind: request.kind,
        ...(request.commitHash ? { vivd_build_commit_hash: request.commitHash } : {}),
        vivd_created_at: new Date().toISOString(),
      },
      auto_destroy: true,
      restart: {
        policy: "no",
      },
    };

    try {
      await this.apiClient.createMachine({
        machineName: this.buildMachineName(request),
        region: this.config.region,
        config: machineConfig,
      });
    } catch (error) {
      throw new Error(
        `[ArtifactBuild] Failed to start Fly builder for ${request.organizationId}/${request.slug}/v${request.version}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export function createArtifactBuildRuntime(
  kind: StudioMachineProviderKind,
): ArtifactBuildRuntime {
  if (kind === "docker") return new DockerArtifactBuildRuntime();
  if (kind === "fly") return new FlyArtifactBuildRuntime();
  return new LocalArtifactBuildRuntime();
}
