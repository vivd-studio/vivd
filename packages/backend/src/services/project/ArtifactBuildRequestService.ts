import {
  createS3Client,
  getObjectStorageConfigFromEnv,
  readArtifactBuildMeta,
  writeArtifactBuildMeta,
  type ArtifactBuildKind,
} from "@vivd/builder";
import { studioMachineProvider } from "../studioMachines";
import { parseBooleanEnv } from "../studioMachines/fly/utils";
import {
  createArtifactBuildRuntime,
  type ProjectArtifactBuildRequest,
} from "./buildRuntime";

type ArtifactBuildRequestResult = {
  accepted: boolean;
  deduped: boolean;
  status: "queued" | "building" | "ready" | "error";
};

export class ArtifactBuildRequestService {
  private runtime: ReturnType<typeof createArtifactBuildRuntime> | null = null;

  private getRuntime() {
    if (!this.runtime) {
      this.runtime = createArtifactBuildRuntime(studioMachineProvider.kind);
    }
    return this.runtime;
  }

  private getStorage() {
    const config = getObjectStorageConfigFromEnv(process.env);
    return {
      client: createS3Client(config),
      bucket: config.bucket,
    };
  }

  async requestBuild(
    request: ProjectArtifactBuildRequest,
  ): Promise<ArtifactBuildRequestResult> {
    const storage = this.getStorage();
    const existing = await readArtifactBuildMeta({
      client: storage.client,
      bucket: storage.bucket,
      organizationId: request.organizationId,
      slug: request.slug,
      version: request.version,
      kind: request.kind,
    });

    if (request.commitHash && existing?.commitHash === request.commitHash) {
      if (existing.status === "ready") {
        return { accepted: true, deduped: true, status: "ready" };
      }
      if (existing.status === "pending" || existing.status === "building") {
        return {
          accepted: true,
          deduped: true,
          status: existing.status === "pending" ? "queued" : "building",
        };
      }
    }

    await writeArtifactBuildMeta({
      client: storage.client,
      bucket: storage.bucket,
      organizationId: request.organizationId,
      slug: request.slug,
      version: request.version,
      kind: request.kind,
      meta: {
        status: "pending",
        framework: "astro",
        commitHash: request.commitHash,
        startedAt: new Date().toISOString(),
      },
    });

    try {
      await this.getRuntime().startBuild(request);
      return { accepted: true, deduped: false, status: "queued" };
    } catch (error) {
      const latest = await readArtifactBuildMeta({
        client: storage.client,
        bucket: storage.bucket,
        organizationId: request.organizationId,
        slug: request.slug,
        version: request.version,
        kind: request.kind,
      });
      if (!request.commitHash || latest?.commitHash === request.commitHash) {
        await writeArtifactBuildMeta({
          client: storage.client,
          bucket: storage.bucket,
          organizationId: request.organizationId,
          slug: request.slug,
          version: request.version,
          kind: request.kind,
          meta: {
            status: "error",
            framework: "astro",
            commitHash: request.commitHash,
            startedAt: latest?.startedAt || new Date().toISOString(),
            completedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      throw error;
    }
  }

  async requestPreviewBuild(request: Omit<ProjectArtifactBuildRequest, "kind">) {
    return await this.requestBuild({ ...request, kind: "preview" });
  }

  async requestPublishedBuild(request: Omit<ProjectArtifactBuildRequest, "kind">) {
    return await this.requestBuild({ ...request, kind: "published" });
  }
}

export function isArtifactBuilderEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseBooleanEnv(env.VIVD_ARTIFACT_BUILDER_ENABLED, false);
}

export const artifactBuildRequestService = new ArtifactBuildRequestService();
