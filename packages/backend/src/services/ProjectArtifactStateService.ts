import { type S3Client } from "@aws-sdk/client-s3";
import { createS3Client, doesObjectExist, doesPrefixHaveObjects, downloadBucketPrefixToDirectory, getObjectBuffer, getObjectStorageConfigFromEnv } from "./ObjectStorageService";
import { getProjectArtifactKeyPrefix, getProjectPreviewBuildMetaKey, getProjectSourceBuildMetaKey } from "./ProjectStoragePaths";
import { getActiveTenantId } from "../generator/versionUtils";
import type { ArtifactBuildMeta, ArtifactBuildStatus } from "./ProjectArtifactsService";

type Storage = {
  client: S3Client;
  bucket: string;
  tenantId: string;
};

export type PublishArtifactKind = "source" | "preview";
export type ArtifactReadiness =
  | "ready"
  | "build_in_progress"
  | "artifact_not_ready"
  | "not_found"
  | "storage_disabled";

export type PublishableArtifactState = {
  storageEnabled: boolean;
  readiness: ArtifactReadiness;
  sourceKind: PublishArtifactKind | null;
  framework: "astro" | "generic";
  commitHash: string | null;
  builtAt: string | null;
  previewCommitHash: string | null;
  sourceCommitHash: string | null;
  previewBuiltAt: string | null;
  sourceBuiltAt: string | null;
  error: string | null;
  previewStatus: ArtifactBuildStatus | null;
  sourceStatus: ArtifactBuildStatus | null;
};

let storageCache: Storage | null | undefined;

function getStorage(): Storage | null {
  if (storageCache !== undefined) return storageCache;

  try {
    const config = getObjectStorageConfigFromEnv(process.env);
    storageCache = {
      client: createS3Client(config),
      bucket: config.bucket,
      tenantId: getActiveTenantId(),
    };
  } catch {
    storageCache = null;
  }

  return storageCache;
}

async function getBuildMeta(options: {
  storage: Storage;
  slug: string;
  version: number;
  kind: PublishArtifactKind;
}): Promise<ArtifactBuildMeta | null> {
  const key =
    options.kind === "preview"
      ? getProjectPreviewBuildMetaKey({
          tenantId: options.storage.tenantId,
          slug: options.slug,
          version: options.version,
        })
      : getProjectSourceBuildMetaKey({
          tenantId: options.storage.tenantId,
          slug: options.slug,
          version: options.version,
        });

  try {
    const { buffer } = await getObjectBuffer({
      client: options.storage.client,
      bucket: options.storage.bucket,
      key,
    });

    const parsed = JSON.parse(buffer.toString("utf-8")) as ArtifactBuildMeta;
    if (!parsed || typeof parsed !== "object" || typeof parsed.status !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getArtifactStorageConfig(): Storage | null {
  return getStorage();
}

export async function resolvePublishableArtifactState(options: {
  slug: string;
  version: number;
}): Promise<PublishableArtifactState> {
  const storage = getStorage();
  if (!storage) {
    return {
      storageEnabled: false,
      readiness: "storage_disabled",
      sourceKind: null,
      framework: "generic",
      commitHash: null,
      builtAt: null,
      previewCommitHash: null,
      sourceCommitHash: null,
      previewBuiltAt: null,
      sourceBuiltAt: null,
      error: "Object storage is not configured",
      previewStatus: null,
      sourceStatus: null,
    };
  }

  const previewPrefix = getProjectArtifactKeyPrefix({
    tenantId: storage.tenantId,
    slug: options.slug,
    version: options.version,
    kind: "preview",
  });
  const sourcePrefix = getProjectArtifactKeyPrefix({
    tenantId: storage.tenantId,
    slug: options.slug,
    version: options.version,
    kind: "source",
  });

  const [
    previewMeta,
    sourceMeta,
    previewHasIndex,
    sourceHasIndex,
    previewHasAny,
    sourceHasAny,
    sourceHasAstroConfig,
  ] =
    await Promise.all([
      getBuildMeta({
        storage,
        slug: options.slug,
        version: options.version,
        kind: "preview",
      }),
      getBuildMeta({
        storage,
        slug: options.slug,
        version: options.version,
        kind: "source",
      }),
      doesObjectExist({
        client: storage.client,
        bucket: storage.bucket,
        key: `${previewPrefix}/index.html`,
      }),
      doesObjectExist({
        client: storage.client,
        bucket: storage.bucket,
        key: `${sourcePrefix}/index.html`,
      }),
      doesPrefixHaveObjects({
        client: storage.client,
        bucket: storage.bucket,
        keyPrefix: previewPrefix,
      }),
      doesPrefixHaveObjects({
        client: storage.client,
        bucket: storage.bucket,
        keyPrefix: sourcePrefix,
      }),
      Promise.all([
        "astro.config.mjs",
        "astro.config.js",
        "astro.config.ts",
        "astro.config.cjs",
      ].map((filename) =>
        doesObjectExist({
          client: storage.client,
          bucket: storage.bucket,
          key: `${sourcePrefix}/${filename}`,
        }),
      )).then((matches) => matches.some(Boolean)),
    ]);

  const isAstro =
    previewMeta?.framework === "astro" ||
    Boolean(previewMeta) ||
    previewHasIndex ||
    sourceHasAstroConfig ||
    (previewHasAny && !sourceHasIndex);

  if (isAstro) {
    if (previewMeta?.status === "building" || previewMeta?.status === "pending") {
      return {
        storageEnabled: true,
        readiness: "build_in_progress",
        sourceKind: "preview",
        framework: "astro",
        commitHash: previewMeta.commitHash ?? null,
        builtAt: previewMeta.completedAt ?? null,
        previewCommitHash: previewMeta.commitHash ?? null,
        sourceCommitHash: sourceMeta?.commitHash ?? null,
        previewBuiltAt: previewMeta.completedAt ?? previewMeta.startedAt ?? null,
        sourceBuiltAt: sourceMeta?.completedAt ?? sourceMeta?.startedAt ?? null,
        error: null,
        previewStatus: previewMeta.status,
        sourceStatus: sourceMeta?.status ?? null,
      };
    }

    if (previewMeta?.status === "error") {
      return {
        storageEnabled: true,
        readiness: "artifact_not_ready",
        sourceKind: "preview",
        framework: "astro",
        commitHash: previewMeta.commitHash ?? null,
        builtAt: previewMeta.completedAt ?? null,
        previewCommitHash: previewMeta.commitHash ?? null,
        sourceCommitHash: sourceMeta?.commitHash ?? null,
        previewBuiltAt: previewMeta.completedAt ?? previewMeta.startedAt ?? null,
        sourceBuiltAt: sourceMeta?.completedAt ?? sourceMeta?.startedAt ?? null,
        error: previewMeta.error ?? "Preview artifact is not ready",
        previewStatus: previewMeta.status,
        sourceStatus: sourceMeta?.status ?? null,
      };
    }

    if (previewHasIndex || previewHasAny) {
      return {
        storageEnabled: true,
        readiness: "ready",
        sourceKind: "preview",
        framework: "astro",
        commitHash: previewMeta?.commitHash ?? sourceMeta?.commitHash ?? null,
        builtAt:
          previewMeta?.completedAt ??
          previewMeta?.startedAt ??
          sourceMeta?.completedAt ??
          null,
        previewCommitHash: previewMeta?.commitHash ?? null,
        sourceCommitHash: sourceMeta?.commitHash ?? null,
        previewBuiltAt: previewMeta?.completedAt ?? previewMeta?.startedAt ?? null,
        sourceBuiltAt: sourceMeta?.completedAt ?? sourceMeta?.startedAt ?? null,
        error: null,
        previewStatus: previewMeta?.status ?? null,
        sourceStatus: sourceMeta?.status ?? null,
      };
    }

    return {
      storageEnabled: true,
      readiness: "artifact_not_ready",
      sourceKind: "preview",
      framework: "astro",
      commitHash: previewMeta?.commitHash ?? null,
      builtAt: previewMeta?.completedAt ?? null,
      previewCommitHash: previewMeta?.commitHash ?? null,
      sourceCommitHash: sourceMeta?.commitHash ?? null,
      previewBuiltAt: previewMeta?.completedAt ?? previewMeta?.startedAt ?? null,
      sourceBuiltAt: sourceMeta?.completedAt ?? sourceMeta?.startedAt ?? null,
      error: "Preview artifact is not available",
      previewStatus: previewMeta?.status ?? null,
      sourceStatus: sourceMeta?.status ?? null,
    };
  }

  if (sourceHasIndex || (sourceHasAny && !sourceHasAstroConfig)) {
    return {
      storageEnabled: true,
      readiness: "ready",
      sourceKind: "source",
      framework: sourceMeta?.framework ?? "generic",
      commitHash: sourceMeta?.commitHash ?? null,
      builtAt: sourceMeta?.completedAt ?? sourceMeta?.startedAt ?? null,
      previewCommitHash: previewMeta?.commitHash ?? null,
      sourceCommitHash: sourceMeta?.commitHash ?? null,
      previewBuiltAt: previewMeta?.completedAt ?? previewMeta?.startedAt ?? null,
      sourceBuiltAt: sourceMeta?.completedAt ?? sourceMeta?.startedAt ?? null,
      error: null,
      previewStatus: previewMeta?.status ?? null,
      sourceStatus: sourceMeta?.status ?? null,
    };
  }

  return {
    storageEnabled: true,
    readiness: "not_found",
    sourceKind: null,
    framework: "generic",
    commitHash: null,
    builtAt: null,
    previewCommitHash: previewMeta?.commitHash ?? null,
    sourceCommitHash: sourceMeta?.commitHash ?? null,
    previewBuiltAt: previewMeta?.completedAt ?? previewMeta?.startedAt ?? null,
    sourceBuiltAt: sourceMeta?.completedAt ?? sourceMeta?.startedAt ?? null,
    error: "No publishable artifact found",
    previewStatus: previewMeta?.status ?? null,
    sourceStatus: sourceMeta?.status ?? null,
  };
}

export async function downloadArtifactToDirectory(options: {
  slug: string;
  version: number;
  kind: PublishArtifactKind;
  destinationDir: string;
}): Promise<{ downloaded: boolean; filesDownloaded: number }> {
  const storage = getStorage();
  if (!storage) return { downloaded: false, filesDownloaded: 0 };

  const keyPrefix = getProjectArtifactKeyPrefix({
    tenantId: storage.tenantId,
    slug: options.slug,
    version: options.version,
    kind: options.kind,
  });

  const result = await downloadBucketPrefixToDirectory({
    client: storage.client,
    bucket: storage.bucket,
    keyPrefix,
    localDir: options.destinationDir,
  });

  return {
    downloaded: result.filesDownloaded > 0,
    filesDownloaded: result.filesDownloaded,
  };
}
