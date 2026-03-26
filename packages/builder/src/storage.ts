import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export type ArtifactBuildKind = "preview" | "published";

export type ArtifactBuildMeta = {
  status: "pending" | "building" | "ready" | "error";
  framework: "astro" | "generic";
  commitHash?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

type EnvMap = Record<string, string | undefined>;

export type ObjectStorageConfig = {
  bucket: string;
  endpointUrl?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeKeyPrefix(prefix: string): string {
  const trimmed = trimSlashes(prefix);
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function getObjectStorageConfigFromEnv(
  env: EnvMap = process.env,
): ObjectStorageConfig {
  const bucketMode = (env.VIVD_BUCKET_MODE || "").trim().toLowerCase();
  const localBucketMode = bucketMode === "local";
  const bucket = (
    env.VIVD_S3_BUCKET ||
    env.R2_BUCKET ||
    (localBucketMode ? env.VIVD_LOCAL_S3_BUCKET : "") ||
    ""
  ).trim();
  const endpointUrl = (
    env.VIVD_S3_ENDPOINT_URL ||
    env.R2_ENDPOINT ||
    (localBucketMode ? env.VIVD_LOCAL_S3_ENDPOINT_URL : "") ||
    ""
  ).trim();
  const accessKeyId = (
    env.VIVD_S3_ACCESS_KEY_ID ||
    env.R2_ACCESS_KEY ||
    env.AWS_ACCESS_KEY_ID ||
    (localBucketMode ? env.VIVD_LOCAL_S3_ACCESS_KEY : "") ||
    ""
  ).trim();
  const secretAccessKey = (
    env.VIVD_S3_SECRET_ACCESS_KEY ||
    env.R2_SECRET_KEY ||
    env.AWS_SECRET_ACCESS_KEY ||
    (localBucketMode ? env.VIVD_LOCAL_S3_SECRET_KEY : "") ||
    ""
  ).trim();
  const sessionToken =
    (env.VIVD_S3_SESSION_TOKEN || env.AWS_SESSION_TOKEN || "").trim() ||
    undefined;
  const region = (
    env.VIVD_S3_REGION ||
    env.AWS_REGION ||
    env.AWS_DEFAULT_REGION ||
    (localBucketMode ? env.VIVD_LOCAL_S3_REGION || "us-east-1" : "auto")
  ).trim();

  if (!bucket) {
    throw new Error("Missing bucket. Set VIVD_S3_BUCKET or R2_BUCKET.");
  }
  if (endpointUrl && (!accessKeyId || !secretAccessKey)) {
    throw new Error(
      "Missing object storage credentials. Set VIVD_S3_ACCESS_KEY_ID/VIVD_S3_SECRET_ACCESS_KEY or equivalent.",
    );
  }

  return {
    bucket,
    endpointUrl: endpointUrl || undefined,
    region,
    accessKeyId: accessKeyId || undefined,
    secretAccessKey: secretAccessKey || undefined,
    sessionToken,
  };
}

export function createS3Client(config: ObjectStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpointUrl,
    forcePathStyle: Boolean(config.endpointUrl),
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            sessionToken: config.sessionToken,
          }
        : undefined,
  });
}

export function getProjectArtifactKeyPrefix(options: {
  organizationId: string;
  slug: string;
  version: number;
  kind: "source" | ArtifactBuildKind;
}): string {
  const tenantId = options.organizationId.trim() || "default";
  return `tenants/${tenantId}/projects/${options.slug}/v${options.version}/${options.kind}`;
}

export function getProjectBuildMetaKey(options: {
  organizationId: string;
  slug: string;
  version: number;
  kind: "source" | ArtifactBuildKind;
}): string {
  return `${getProjectArtifactKeyPrefix(options)}/.vivd/build.json`;
}

async function readObjectBodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.from("");
  if (typeof body === "string") return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);

  if (typeof body === "object" && body !== null) {
    const streamWithHelpers = body as {
      transformToByteArray?: () => Promise<Uint8Array>;
    };
    if (typeof streamWithHelpers.transformToByteArray === "function") {
      const bytes = await streamWithHelpers.transformToByteArray();
      return Buffer.from(bytes);
    }
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported object body type");
}

export async function readArtifactBuildMeta(options: {
  client: S3Client;
  bucket: string;
  organizationId: string;
  slug: string;
  version: number;
  kind: "source" | ArtifactBuildKind;
}): Promise<ArtifactBuildMeta | null> {
  try {
    const response = await options.client.send(
      new GetObjectCommand({
        Bucket: options.bucket,
        Key: getProjectBuildMetaKey(options),
      }),
    );
    const buffer = await readObjectBodyToBuffer(response.Body);
    const parsed = JSON.parse(buffer.toString("utf-8")) as ArtifactBuildMeta;
    if (!parsed || typeof parsed.status !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeArtifactBuildMeta(options: {
  client: S3Client;
  bucket: string;
  organizationId: string;
  slug: string;
  version: number;
  kind: "source" | ArtifactBuildKind;
  meta: ArtifactBuildMeta;
}): Promise<void> {
  await options.client.send(
    new PutObjectCommand({
      Bucket: options.bucket,
      Key: getProjectBuildMetaKey(options),
      Body: Buffer.from(`${JSON.stringify(options.meta, null, 2)}\n`, "utf-8"),
      ContentType: "application/json",
    }),
  );
}

export async function deleteBucketPrefix(options: {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
}): Promise<void> {
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);
  let continuationToken: string | undefined;

  do {
    const page = await options.client.send(
      new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (page.Contents ?? [])
      .map((entry) => entry.Key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);

    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      if (batch.length === 0) continue;
      await options.client.send(
        new DeleteObjectsCommand({
          Bucket: options.bucket,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function listLocalFiles(
  rootDir: string,
): Promise<Array<{ absPath: string; relPath: string; size: number }>> {
  const files: Array<{ absPath: string; relPath: string; size: number }> = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.promises.stat(absPath);
      files.push({
        absPath,
        relPath: toPosixPath(path.relative(rootDir, absPath)),
        size: stat.size,
      });
    }
  }

  await walk(rootDir);
  return files;
}

export async function uploadDirectoryToBucket(options: {
  client: S3Client;
  bucket: string;
  localDir: string;
  keyPrefix: string;
}): Promise<void> {
  const files = await listLocalFiles(options.localDir);
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);

  for (const file of files) {
    await options.client.send(
      new PutObjectCommand({
        Bucket: options.bucket,
        Key: `${keyPrefix}${file.relPath}`,
        Body: fs.createReadStream(file.absPath),
        ContentLength: file.size,
      }),
    );
  }
}

export async function replaceBucketPrefixWithDirectory(options: {
  client: S3Client;
  bucket: string;
  localDir: string;
  keyPrefix: string;
}): Promise<void> {
  await deleteBucketPrefix({
    client: options.client,
    bucket: options.bucket,
    keyPrefix: options.keyPrefix,
  });
  await uploadDirectoryToBucket(options);
}

export async function downloadBucketPrefixToDirectory(options: {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
  localDir: string;
}): Promise<void> {
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);
  let continuationToken: string | undefined;

  await fs.promises.mkdir(options.localDir, { recursive: true });

  do {
    const page = await options.client.send(
      new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const entry of page.Contents ?? []) {
      const key = entry.Key;
      if (!key || key.endsWith("/")) continue;
      const relPath = key.slice(keyPrefix.length);
      if (!relPath) continue;
      const destination = path.resolve(options.localDir, relPath);
      const response = await options.client.send(
        new GetObjectCommand({
          Bucket: options.bucket,
          Key: key,
        }),
      );
      const body = await readObjectBodyToBuffer(response.Body);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.writeFile(destination, body);
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}
