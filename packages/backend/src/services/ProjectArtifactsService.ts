import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  createS3Client,
  deleteBucketPrefix,
  getObjectStorageConfigFromEnv,
  uploadDirectoryToBucket,
} from "./ObjectStorageService";
import {
  getProjectArtifactKeyPrefix,
  getProjectPreviewBuildMetaKey,
  getProjectPublishedBuildMetaKey,
  getProjectThumbnailKey,
} from "./ProjectStoragePaths";
import { getActiveTenantId } from "../generator/versionUtils";

export type ArtifactBuildStatus = "pending" | "building" | "ready" | "error";

export type ArtifactBuildMeta = {
  status: ArtifactBuildStatus;
  framework?: "astro" | "generic";
  commitHash?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

type Storage = { client: S3Client; bucket: string; tenantId: string };

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
  versionDir: string;
  slug: string;
  version: number;
}): Promise<{ uploaded: boolean }> {
  const storage = getStorage();
  if (!storage) return { uploaded: false };

  if (!fs.existsSync(options.versionDir)) return { uploaded: false };

  const keyPrefix = getProjectArtifactKeyPrefix({
    tenantId: storage.tenantId,
    slug: options.slug,
    version: options.version,
    kind: "source",
  });

  await uploadDirectoryToBucket({
    client: storage.client,
    bucket: storage.bucket,
    localDir: options.versionDir,
    keyPrefix,
    // Keep git history in storage; exclude bulky caches/builds.
    excludeDirNames: ["node_modules", "dist", ".astro"],
  });

  return { uploaded: true };
}

export async function uploadProjectPreviewToBucket(options: {
  localDir: string;
  slug: string;
  version: number;
  meta?: ArtifactBuildMeta;
}): Promise<{ uploaded: boolean }> {
  const storage = getStorage();
  if (!storage) return { uploaded: false };

  if (!fs.existsSync(options.localDir)) return { uploaded: false };

  const keyPrefix = getProjectArtifactKeyPrefix({
    tenantId: storage.tenantId,
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
        tenantId: storage.tenantId,
        slug: options.slug,
        version: options.version,
      }),
      payload: options.meta,
    });
  }

  return { uploaded: true };
}

export async function uploadProjectPublishedToBucket(options: {
  localDir: string;
  slug: string;
  version: number;
  meta?: ArtifactBuildMeta;
}): Promise<{ uploaded: boolean }> {
  const storage = getStorage();
  if (!storage) return { uploaded: false };

  if (!fs.existsSync(options.localDir)) return { uploaded: false };

  const keyPrefix = getProjectArtifactKeyPrefix({
    tenantId: storage.tenantId,
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
        tenantId: storage.tenantId,
        slug: options.slug,
        version: options.version,
      }),
      payload: options.meta,
    });
  }

  return { uploaded: true };
}

export async function uploadProjectThumbnailToBucket(options: {
  localFilePath: string;
  slug: string;
  version: number;
}): Promise<{ uploaded: boolean; key?: string }> {
  const storage = getStorage();
  if (!storage) return { uploaded: false };

  if (!fs.existsSync(options.localFilePath)) return { uploaded: false };

  const key = getProjectThumbnailKey({
    tenantId: storage.tenantId,
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

export function getProjectPreviewMetaPathOnDisk(options: {
  versionDir: string;
}): string {
  return path.join(options.versionDir, ".vivd", "preview-build.json");
}
