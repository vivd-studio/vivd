import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type ObjectStorageConfig = {
  bucket: string;
  endpointUrl?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

type EnvMap = Record<string, string | undefined>;

let publicBaseUrlCache: string | null | undefined;
let signedUrlStorageCache:
  | { client: S3Client; bucket: string }
  | null
  | undefined;

function getPublicObjectBaseUrl(env: EnvMap = process.env): string | null {
  if (publicBaseUrlCache !== undefined) return publicBaseUrlCache;
  const base = (env.VIVD_S3_PUBLIC_BASE_URL || env.R2_PUBLIC_BASE_URL || "").trim();
  publicBaseUrlCache = base ? base.replace(/\/+$/, "") : null;
  return publicBaseUrlCache;
}

function getSignedUrlStorage(env: EnvMap = process.env): { client: S3Client; bucket: string } | null {
  if (signedUrlStorageCache !== undefined) return signedUrlStorageCache;
  try {
    const config = getObjectStorageConfigFromEnv(env);
    signedUrlStorageCache = {
      client: createS3Client(config),
      bucket: config.bucket,
    };
  } catch {
    signedUrlStorageCache = null;
  }
  return signedUrlStorageCache;
}

export async function getObjectDownloadUrl(options: {
  key: string;
  expiresInSeconds?: number;
  env?: EnvMap;
}): Promise<string | null> {
  const env = options.env ?? process.env;
  const key = options.key.replace(/^\/+/, "");

  const publicBaseUrl = getPublicObjectBaseUrl(env);
  if (publicBaseUrl) {
    return `${publicBaseUrl}/${key}`;
  }

  const storage = getSignedUrlStorage(env);
  if (!storage) return null;

  const expiresInSeconds = options.expiresInSeconds ?? 60 * 60;
  try {
    return await getSignedUrl(
      storage.client,
      new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  } catch {
    return null;
  }
}

export function getObjectStorageConfigFromEnv(env: EnvMap = process.env): ObjectStorageConfig {
  const bucket = (env.VIVD_S3_BUCKET || env.R2_BUCKET || "").trim();
  const endpointUrl = (
    env.VIVD_S3_ENDPOINT_URL ||
    env.R2_ENDPOINT ||
    ""
  ).trim();

  const accessKeyId = (
    env.R2_ACCESS_KEY ||
    env.AWS_ACCESS_KEY_ID ||
    ""
  ).trim();
  const secretAccessKey = (
    env.R2_SECRET_KEY ||
    env.AWS_SECRET_ACCESS_KEY ||
    ""
  ).trim();
  const sessionToken = (env.AWS_SESSION_TOKEN || "").trim() || undefined;

  const region = (
    env.AWS_REGION ||
    env.AWS_DEFAULT_REGION ||
    "auto"
  ).trim();

  if (!bucket) {
    throw new Error("Missing bucket. Set VIVD_S3_BUCKET or R2_BUCKET.");
  }

  const r2Configured =
    Boolean(env.R2_BUCKET) ||
    Boolean(env.R2_ENDPOINT) ||
    Boolean(env.R2_ACCESS_KEY) ||
    Boolean(env.R2_SECRET_KEY);

  if (r2Configured && !endpointUrl) {
    throw new Error("Missing R2 endpoint. Set R2_ENDPOINT or VIVD_S3_ENDPOINT_URL.");
  }

  if (endpointUrl && (!accessKeyId || !secretAccessKey)) {
    throw new Error(
      "Missing object storage credentials. Set R2_ACCESS_KEY/R2_SECRET_KEY (or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)."
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
    // Path-style addressing is the most compatible default for S3-compatible storage like R2.
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

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

function normalizeKeyPrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function parseS3Uri(uri: string): { bucket: string; keyPrefix: string } {
  const value = uri.trim();
  if (!value.startsWith("s3://")) {
    throw new Error(`Invalid S3 URI: ${uri}`);
  }

  const withoutScheme = value.slice("s3://".length);
  const firstSlash = withoutScheme.indexOf("/");
  if (firstSlash < 0) {
    return { bucket: withoutScheme, keyPrefix: "" };
  }

  const bucket = withoutScheme.slice(0, firstSlash).trim();
  const keyPrefix = withoutScheme.slice(firstSlash + 1).trim();
  return { bucket, keyPrefix };
}

async function listFilesRecursively(options: {
  rootDir: string;
  excludeDirNames: Set<string>;
}): Promise<Array<{ absPath: string; relPath: string; size: number }>> {
  const rootDir = path.resolve(options.rootDir);
  const files: Array<{ absPath: string; relPath: string; size: number }> = [];

  const walk = async (currentDir: string): Promise<void> => {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, absPath);

      if (entry.isDirectory()) {
        if (options.excludeDirNames.has(entry.name)) continue;
        await walk(absPath);
        continue;
      }

      if (entry.isFile()) {
        const stat = await fs.promises.stat(absPath);
        files.push({ absPath, relPath, size: stat.size });
      }
    }
  };

  await walk(rootDir);
  return files;
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const concurrency = Math.max(1, Math.floor(limit));
  let index = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = index++;
        if (i >= items.length) return;
        await worker(items[i]!);
      }
    }
  );

  await Promise.all(runners);
}

export async function uploadDirectoryToBucket(options: {
  client: S3Client;
  bucket: string;
  localDir: string;
  keyPrefix: string;
  excludeDirNames?: string[];
  concurrency?: number;
}): Promise<{
  filesUploaded: number;
  bytesUploaded: number;
  errors: Array<{ file: string; key: string; error: string }>;
}> {
  const excludeDirNames = new Set(options.excludeDirNames ?? []);
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);

  const files = await listFilesRecursively({
    rootDir: options.localDir,
    excludeDirNames,
  });

  let filesUploaded = 0;
  let bytesUploaded = 0;
  const errors: Array<{ file: string; key: string; error: string }> = [];

  await mapLimit(files, options.concurrency ?? 6, async (file) => {
    const key = `${keyPrefix}${toPosixPath(file.relPath)}`;
    try {
      await options.client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: fs.createReadStream(file.absPath),
          ContentLength: file.size,
        })
      );
      filesUploaded++;
      bytesUploaded += file.size;
    } catch (err) {
      errors.push({
        file: file.relPath,
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { filesUploaded, bytesUploaded, errors };
}

function isPathInside(baseDir: string, target: string): boolean {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

function isExcludedPath(relPath: string, excludedDirNames: Set<string>): boolean {
  if (excludedDirNames.size === 0) return false;
  const segments = relPath.split("/").filter(Boolean);
  return segments.some((segment) => excludedDirNames.has(segment));
}

async function writeObjectBodyToFile(
  body: unknown,
  destinationPath: string
): Promise<void> {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

  if (!body) {
    await fs.promises.writeFile(destinationPath, "");
    return;
  }

  if (typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array) {
    await fs.promises.writeFile(destinationPath, body);
    return;
  }

  if (typeof body === "object" && body !== null) {
    const streamWithHelpers = body as {
      transformToByteArray?: () => Promise<Uint8Array>;
    };
    if (typeof streamWithHelpers.transformToByteArray === "function") {
      const bytes = await streamWithHelpers.transformToByteArray();
      await fs.promises.writeFile(destinationPath, Buffer.from(bytes));
      return;
    }
  }

  if (body instanceof Readable) {
    await pipeline(body, fs.createWriteStream(destinationPath));
    return;
  }

  throw new Error("Unsupported object body type");
}

async function readObjectBodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.from("");

  if (typeof body === "string") {
    return Buffer.from(body);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

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
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(Buffer.from(chunk as Buffer));
      }
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported object body type");
}

export async function downloadBucketPrefixToDirectory(options: {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
  localDir: string;
  excludeDirNames?: string[];
  concurrency?: number;
}): Promise<{
  filesDownloaded: number;
  bytesDownloaded: number;
  errors: Array<{ key: string; file: string; error: string }>;
}> {
  const bucket = options.bucket.trim();
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);
  const rootDir = path.resolve(options.localDir);
  const excludedDirNames = new Set(options.excludeDirNames ?? []);

  await fs.promises.mkdir(rootDir, { recursive: true });

  const objectKeys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await options.client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const object of page.Contents ?? []) {
      const key = object.Key;
      if (!key || key.endsWith("/")) continue;
      objectKeys.push(key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  let filesDownloaded = 0;
  let bytesDownloaded = 0;
  const errors: Array<{ key: string; file: string; error: string }> = [];

  await mapLimit(objectKeys, options.concurrency ?? 6, async (key) => {
    const relPathRaw = key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key;
    const relPath = relPathRaw.replace(/^\/+/, "");
    if (!relPath) return;
    if (isExcludedPath(relPath, excludedDirNames)) return;

    const destPath = path.resolve(rootDir, relPath);
    if (!isPathInside(rootDir, destPath)) {
      errors.push({
        key,
        file: relPath,
        error: "Path traversal detected; skipped download",
      });
      return;
    }

    try {
      const response = await options.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      await writeObjectBodyToFile(response.Body, destPath);
      filesDownloaded++;
      bytesDownloaded += response.ContentLength ?? 0;
    } catch (err) {
      errors.push({
        key,
        file: relPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { filesDownloaded, bytesDownloaded, errors };
}

export async function doesObjectExist(options: {
  client: S3Client;
  bucket: string;
  key: string;
}): Promise<boolean> {
  try {
    await options.client.send(
      new HeadObjectCommand({
        Bucket: options.bucket,
        Key: options.key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function doesPrefixHaveObjects(options: {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
}): Promise<boolean> {
  const prefix = normalizeKeyPrefix(options.keyPrefix);
  try {
    const result = await options.client.send(
      new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: prefix,
        MaxKeys: 1,
      }),
    );
    return (result.Contents?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function getObjectBuffer(options: {
  client: S3Client;
  bucket: string;
  key: string;
}): Promise<{ buffer: Buffer; contentType: string | null }> {
  const response = await options.client.send(
    new GetObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
    })
  );

  const buffer = await readObjectBodyToBuffer(response.Body);
  const contentTypeRaw = response.ContentType;
  const contentType =
    typeof contentTypeRaw === "string" && contentTypeRaw.trim().length > 0
      ? contentTypeRaw
      : null;
  return { buffer, contentType };
}

export async function deleteBucketPrefix(options: {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
}): Promise<{ objectsDeleted: number }> {
  const bucket = options.bucket.trim();
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);

  let objectsDeleted = 0;

  let continuationToken: string | undefined;
  do {
    const page = await options.client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
      })
    );

    const keys = (page.Contents ?? [])
      .map((obj) => obj.Key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);

    // Batch delete: S3 max is 1000 keys.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      if (batch.length === 0) continue;

      await options.client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      objectsDeleted += batch.length;
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return { objectsDeleted };
}
