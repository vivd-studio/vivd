import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  copyBucketPrefix,
  createS3Client,
  deleteBucketPrefix,
  doesPrefixHaveObjects,
  getObjectStorageConfigFromEnv,
  uploadDirectoryToBucket,
} from "../storage/ObjectStorageService";
import {
  getProjectArtifactKeyPrefix,
  getProjectBasePrefix,
  getProjectSourceBuildMetaKey,
  getProjectPreviewBuildMetaKey,
  getProjectPublishedBuildMetaKey,
  getProjectThumbnailKey,
  getProjectVersionBasePrefix,
} from "./ProjectStoragePaths";

export type ArtifactBuildStatus = "pending" | "building" | "ready" | "error";

export type ArtifactBuildMeta = {
  status: ArtifactBuildStatus;
  framework?: "astro" | "generic";
  commitHash?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

type Storage = { client: S3Client; bucket: string };

let storageCache: Storage | null | undefined;

function getStorage(): Storage | null {
  if (storageCache !== undefined) return storageCache;

  try {
    const config = getObjectStorageConfigFromEnv(process.env);
    storageCache = {
      client: createS3Client(config),
      bucket: config.bucket,
    };
  } catch {
    storageCache = null;
  }

  return storageCache;
}

async function putJsonObject(options: {
  client: S3Client;
  bucket: string;
  key: string;
  payload: unknown;
}): Promise<void> {
  const body = `${JSON.stringify(options.payload, null, 2)}\n`;
  await options.client.send(
    new PutObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      Body: body,
      ContentType: "application/json",
    }),
  );
}

export async function uploadProjectSourceToBucket(options: {
  organizationId: string;
  versionDir: string;
  slug: string;
  version: number;
  meta?: ArtifactBuildMeta;
}): Promise<{ uploaded: boolean }> {
  const storage = getStorage();
  if (!storage) return { uploaded: false };

  if (!fs.existsSync(options.versionDir)) return { uploaded: false };

  const keyPrefix = getProjectArtifactKeyPrefix({
    tenantId: options.organizationId,
    slug: options.slug,
    version: options.version,
    kind: "source",
  });

  await deleteBucketPrefix({
    client: storage.client,
    bucket: storage.bucket,
    keyPrefix,
  });

  await uploadDirectoryToBucket({
    client: storage.client,
    bucket: storage.bucket,
    localDir: options.versionDir,
    keyPrefix,
    // Keep git history in storage; exclude bulky caches/builds.
    excludeDirNames: ["node_modules", "dist", ".astro"],
  });

  if (options.meta) {
    await putJsonObject({
      client: storage.client,
      bucket: storage.bucket,
      key: getProjectSourceBuildMetaKey({
        tenantId: options.organizationId,
        slug: options.slug,
        version: options.version,
      }),
      payload: options.meta,
    });
  }

  return { uploaded: true };
}

export async function uploadProjectPreviewToBucket(options: {
  organizationId: string;
  localDir: string;
  slug: string;
  version: number;
  meta?: ArtifactBuildMeta;
}): Promise<{ uploaded: boolean }> {
  const storage = getStorage();
  if (!storage) return { uploaded: false };

  if (!fs.existsSync(options.localDir)) return { uploaded: false };

  const keyPrefix = getProjectArtifactKeyPrefix({
    tenantId: options.organizationId,
    slug: options.slug,
    version: options.version,
    kind: "preview",
  });

  await deleteBucketPrefix({
    client: storage.client,
    bucket: storage.bucket,
    keyPrefix,
  });

  await uploadDirectoryToBucket({
    client: storage.client,
    bucket: storage.bucket,
    localDir: options.localDir,
    keyPrefix,
  });

  if (options.meta) {
    await putJsonObject({
      client: storage.client,
      bucket: storage.bucket,
      key: getProjectPreviewBuildMetaKey({
        tenantId: options.organizationId,
        slug: options.slug,
        version: options.version,
      }),
      payload: options.meta,
    });
  }

  return { uploaded: true };
}

export async function uploadProjectPublishedToBucket(options: {
  organizationId: string;
  localDir: string;
  slug: string;
  version: number;
  meta?: ArtifactBuildMeta;
}): Promise<{ uploaded: boolean }> {
  const storage = getStorage();
  if (!storage) return { uploaded: false };

  if (!fs.existsSync(options.localDir)) return { uploaded: false };

  const keyPrefix = getProjectArtifactKeyPrefix({
    tenantId: options.organizationId,
    slug: options.slug,
    version: options.version,
    kind: "published",
  });

  await deleteBucketPrefix({
    client: storage.client,
    bucket: storage.bucket,
    keyPrefix,
  });

  await uploadDirectoryToBucket({
    client: storage.client,
    bucket: storage.bucket,
    localDir: options.localDir,
    keyPrefix,
  });

  if (options.meta) {
    await putJsonObject({
      client: storage.client,
      bucket: storage.bucket,
      key: getProjectPublishedBuildMetaKey({
        tenantId: options.organizationId,
        slug: options.slug,
        version: options.version,
      }),
      payload: options.meta,
    });
  }

  return { uploaded: true };
}

export async function uploadProjectThumbnailToBucket(options: {
  organizationId: string;
  localFilePath: string;
  slug: string;
  version: number;
}): Promise<{ uploaded: boolean; key?: string }> {
  const storage = getStorage();
  if (!storage) return { uploaded: false };

  if (!fs.existsSync(options.localFilePath)) return { uploaded: false };

  const key = getProjectThumbnailKey({
    tenantId: options.organizationId,
    slug: options.slug,
    version: options.version,
  });

  await storage.client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      Body: fs.createReadStream(options.localFilePath),
      ContentType: "image/webp",
    }),
  );

  return { uploaded: true, key };
}

export async function uploadProjectThumbnailBufferToBucket(options: {
  organizationId: string;
  buffer: Buffer | Uint8Array;
  slug: string;
  version: number;
}): Promise<{ uploaded: boolean; key?: string }> {
  const storage = getStorage();
  if (!storage) return { uploaded: false };

  const key = getProjectThumbnailKey({
    tenantId: options.organizationId,
    slug: options.slug,
    version: options.version,
  });

  await storage.client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      Body: options.buffer,
      ContentType: "image/webp",
    }),
  );

  return { uploaded: true, key };
}

export async function copyProjectArtifactsInBucket(options: {
  organizationId: string;
  sourceSlug: string;
  targetSlug: string;
}): Promise<{ copied: boolean; objectsCopied: number }> {
  const storage = getStorage();
  if (!storage) return { copied: false, objectsCopied: 0 };

  const sourcePrefix = getProjectBasePrefix({
    tenantId: options.organizationId,
    slug: options.sourceSlug,
  });
  const targetPrefix = getProjectBasePrefix({
    tenantId: options.organizationId,
    slug: options.targetSlug,
  });

  const targetHasObjects = await doesPrefixHaveObjects({
    client: storage.client,
    bucket: storage.bucket,
    keyPrefix: targetPrefix,
  });
  if (targetHasObjects) {
    throw new Error(
      `Target artifact prefix already exists for slug "${options.targetSlug}".`,
    );
  }

  const res = await copyBucketPrefix({
    client: storage.client,
    bucket: storage.bucket,
    sourceKeyPrefix: sourcePrefix,
    targetKeyPrefix: targetPrefix,
  });
  if (res.errors.length > 0) {
    const first = res.errors[0];
    throw new Error(
      `Artifact copy failed for ${res.errors.length} object(s). First failure: ${first?.sourceKey ?? "unknown"} -> ${first?.targetKey ?? "unknown"} (${first?.error ?? "unknown error"})`,
    );
  }

  return { copied: true, objectsCopied: res.objectsCopied };
}

export function getProjectPreviewMetaPathOnDisk(options: {
  versionDir: string;
}): string {
  return path.join(options.versionDir, ".vivd", "preview-build.json");
}

export async function deleteProjectArtifactsFromBucket(options: {
  organizationId: string;
  slug: string;
}): Promise<{ deleted: boolean; objectsDeleted: number }> {
  const storage = getStorage();
  if (!storage) return { deleted: false, objectsDeleted: 0 };

  const keyPrefix = getProjectBasePrefix({
    tenantId: options.organizationId,
    slug: options.slug,
  });

  const res = await deleteBucketPrefix({
    client: storage.client,
    bucket: storage.bucket,
    keyPrefix,
  });

  return { deleted: true, objectsDeleted: res.objectsDeleted };
}

export async function deleteProjectVersionArtifactsFromBucket(options: {
  organizationId: string;
  slug: string;
  version: number;
}): Promise<{ deleted: boolean; objectsDeleted: number }> {
  const storage = getStorage();
  if (!storage) return { deleted: false, objectsDeleted: 0 };

  const keyPrefix = getProjectVersionBasePrefix({
    tenantId: options.organizationId,
    slug: options.slug,
    version: options.version,
  });

  const res = await deleteBucketPrefix({
    client: storage.client,
    bucket: storage.bucket,
    keyPrefix,
  });

  return { deleted: true, objectsDeleted: res.objectsDeleted };
}
