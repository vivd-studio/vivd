import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
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

const SYNC_MANIFEST_FILENAME = ".vivd-sync-manifest.json";
const SYNC_MANIFEST_VERSION = 1;

function isLocalBucketMode(env: EnvMap = process.env): boolean {
  return (env.VIVD_BUCKET_MODE || "").trim().toLowerCase() === "local";
}

function getLocalBucketDownloadEndpoint(env: EnvMap = process.env): string {
  return (env.VIVD_LOCAL_S3_DOWNLOAD_ENDPOINT_URL || "").trim();
}

type SyncManifestEntry = {
  relPath: string;
  size: number;
  sha256: string;
};

type SyncManifest = {
  version: number;
  generatedAt: string;
  files: SyncManifestEntry[];
};

function getPublicObjectBaseUrl(env: EnvMap = process.env): string | null {
  if (publicBaseUrlCache !== undefined) return publicBaseUrlCache;
  const base = (
    env.VIVD_S3_PUBLIC_BASE_URL ||
    env.R2_PUBLIC_BASE_URL ||
    (isLocalBucketMode(env) ? env.VIVD_LOCAL_S3_PUBLIC_BASE_URL : "") ||
    ""
  ).trim();
  publicBaseUrlCache = base ? base.replace(/\/+$/, "") : null;
  return publicBaseUrlCache;
}

function getSignedUrlStorage(env: EnvMap = process.env): { client: S3Client; bucket: string } | null {
  if (signedUrlStorageCache !== undefined) return signedUrlStorageCache;
  try {
    const config = getObjectStorageConfigFromEnv(env);
    const downloadEndpointUrl = (
      env.VIVD_S3_DOWNLOAD_ENDPOINT_URL ||
      (isLocalBucketMode(env) ? getLocalBucketDownloadEndpoint(env) : "") ||
      ""
    ).trim();
    signedUrlStorageCache = {
      client: createS3Client({
        ...config,
        endpointUrl: downloadEndpointUrl || config.endpointUrl,
      }),
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
  const localBucketMode = isLocalBucketMode(env);
  const bucketMode = (env.VIVD_BUCKET_MODE || "").trim().toLowerCase();
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
    (env.VIVD_S3_SESSION_TOKEN || env.AWS_SESSION_TOKEN || "").trim() || undefined;

  const region = (
    env.VIVD_S3_REGION ||
    env.AWS_REGION ||
    env.AWS_DEFAULT_REGION ||
    (localBucketMode ? env.VIVD_LOCAL_S3_REGION || "us-east-1" : "auto")
  ).trim();

  const r2Configured =
    Boolean(env.R2_BUCKET) ||
    Boolean(env.R2_ENDPOINT) ||
    Boolean(env.R2_ACCESS_KEY) ||
    Boolean(env.R2_SECRET_KEY);
  const localConfigured =
    localBucketMode ||
    (!bucketMode &&
      (Boolean(env.VIVD_LOCAL_S3_BUCKET) ||
        Boolean(env.VIVD_LOCAL_S3_ENDPOINT_URL) ||
        Boolean(env.VIVD_LOCAL_S3_ACCESS_KEY) ||
        Boolean(env.VIVD_LOCAL_S3_SECRET_KEY)));

  if (r2Configured && !endpointUrl) {
    throw new Error("Missing object storage endpoint. Set VIVD_S3_ENDPOINT_URL or R2_ENDPOINT.");
  }
  if (localConfigured && !bucket) {
    throw new Error(
      "Missing local bucket name. Set VIVD_LOCAL_S3_BUCKET (or VIVD_S3_BUCKET).",
    );
  }
  if (localConfigured && !endpointUrl) {
    throw new Error(
      "Missing local bucket endpoint. Set VIVD_LOCAL_S3_ENDPOINT_URL (or VIVD_S3_ENDPOINT_URL).",
    );
  }
  if (!bucket) {
    throw new Error("Missing bucket. Set VIVD_S3_BUCKET or R2_BUCKET.");
  }

  if (endpointUrl && (!accessKeyId || !secretAccessKey)) {
    throw new Error(
      "Missing object storage credentials. Set VIVD_S3_ACCESS_KEY_ID/VIVD_S3_SECRET_ACCESS_KEY, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, R2_ACCESS_KEY/R2_SECRET_KEY, or the local bucket credentials."
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

function normalizeExcludedPrefixes(exclude: string[] | undefined): string[] {
  return (exclude ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/\\/g, "/"))
    .map((value) => value.replace(/^\.\//, ""))
    .map((value) => value.replace(/^\/+/, ""))
    .map((value) => value.replace(/\*+$/, ""))
    .map((value) => value.replace(/\/+$/, ""))
    .filter(Boolean);
}

function isExcludedByPrefix(relPath: string, excludedPrefixes: string[]): boolean {
  if (!excludedPrefixes.length) return false;
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return excludedPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
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

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function listBucketObjects(options: {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
}): Promise<Array<{ key: string; size: number }>> {
  const results: Array<{ key: string; size: number }> = [];
  let continuationToken: string | undefined;

  do {
    const page = await options.client.send(
      new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: options.keyPrefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of page.Contents ?? []) {
      const key = object.Key;
      if (!key || key.endsWith("/")) continue;
      results.push({ key, size: object.Size ?? 0 });
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return results;
}

function getSyncManifestKey(keyPrefix: string): string {
  return `${normalizeKeyPrefix(keyPrefix)}${SYNC_MANIFEST_FILENAME}`;
}

function parseSyncManifest(raw: Buffer): SyncManifest | null {
  try {
    const parsed = JSON.parse(raw.toString("utf-8")) as Partial<SyncManifest>;
    if (parsed.version !== SYNC_MANIFEST_VERSION) return null;
    if (!Array.isArray(parsed.files)) return null;

    const files = parsed.files
      .filter((entry): entry is SyncManifestEntry => {
        if (!entry || typeof entry !== "object") return false;
        if (typeof entry.relPath !== "string") return false;
        if (!entry.relPath.trim()) return false;
        if (!Number.isFinite(entry.size) || entry.size < 0) return false;
        if (typeof entry.sha256 !== "string" || !entry.sha256.trim()) return false;
        return true;
      })
      .map((entry) => ({
        relPath: entry.relPath.replace(/^\/+/, ""),
        size: entry.size,
        sha256: entry.sha256.toLowerCase(),
      }));

    return {
      version: SYNC_MANIFEST_VERSION,
      generatedAt:
        typeof parsed.generatedAt === "string" && parsed.generatedAt.trim()
          ? parsed.generatedAt
          : new Date(0).toISOString(),
      files,
    };
  } catch {
    return null;
  }
}

export async function uploadDirectoryToBucket(options: {
  client: S3Client;
  bucket: string;
  localDir: string;
  keyPrefix: string;
  excludeDirNames?: string[];
  exclude?: string[];
  concurrency?: number;
}): Promise<{
  filesUploaded: number;
  bytesUploaded: number;
  errors: Array<{ file: string; key: string; error: string }>;
}> {
  const excludeDirNames = new Set(options.excludeDirNames ?? []);
  const excludedPrefixes = normalizeExcludedPrefixes(options.exclude);
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);

  const files = await listFilesRecursively({
    rootDir: options.localDir,
    excludeDirNames,
  });

  let filesUploaded = 0;
  let bytesUploaded = 0;
  const errors: Array<{ file: string; key: string; error: string }> = [];

  await mapLimit(files, options.concurrency ?? 6, async (file) => {
    const relPath = toPosixPath(file.relPath);
    if (isExcludedByPrefix(relPath, excludedPrefixes)) return;

    const key = `${keyPrefix}${relPath}`;
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

export async function syncDirectoryToBucketExact(options: {
  client: S3Client;
  bucket: string;
  localDir: string;
  keyPrefix: string;
  excludeDirNames?: string[];
  exclude?: string[];
  concurrency?: number;
}): Promise<{
  filesUploaded: number;
  filesDeleted: number;
  filesUnchanged: number;
  bytesUploaded: number;
  errors: Array<{ file: string; key: string; error: string }>;
}> {
  const excludeDirNames = new Set(options.excludeDirNames ?? []);
  const excludedPrefixes = normalizeExcludedPrefixes(options.exclude);
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);
  const bucket = options.bucket.trim();
  const manifestKey = getSyncManifestKey(keyPrefix);

  const files = await listFilesRecursively({
    rootDir: options.localDir,
    excludeDirNames,
  });
  const localFilesByKey = new Map<
    string,
    { absPath: string; relPath: string; size: number; posixRelPath: string }
  >();

  for (const file of files) {
    const posixRelPath = toPosixPath(file.relPath);
    if (isExcludedByPrefix(posixRelPath, excludedPrefixes)) continue;
    const key = `${keyPrefix}${posixRelPath}`;
    localFilesByKey.set(key, {
      absPath: file.absPath,
      relPath: file.relPath,
      size: file.size,
      posixRelPath,
    });
  }

  const remoteObjectsAll = await listBucketObjects({
    client: options.client,
    bucket,
    keyPrefix,
  });
  const remoteObjects = remoteObjectsAll.filter((obj) => obj.key !== manifestKey);
  const remoteByKey = new Map(remoteObjects.map((obj) => [obj.key, obj]));
  const keysToDelete = remoteObjects
    .map((obj) => obj.key)
    .filter((key) => !localFilesByKey.has(key));

  let filesDeleted = 0;
  const errors: Array<{ file: string; key: string; error: string }> = [];
  const manifestEntries: SyncManifestEntry[] = [];

  for (let i = 0; i < keysToDelete.length; i += 1000) {
    const batch = keysToDelete.slice(i, i + 1000);
    if (batch.length === 0) continue;

    try {
      const response = await options.client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: false,
          },
        }),
      );

      filesDeleted += response.Deleted?.length ?? batch.length;
      for (const entry of response.Errors ?? []) {
        const key = entry.Key || "";
        errors.push({
          file: key,
          key,
          error: entry.Message || "Failed to delete object",
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      for (const key of batch) {
        errors.push({ file: key, key, error });
      }
    }
  }

  let filesUploaded = 0;
  let filesUnchanged = 0;
  let bytesUploaded = 0;
  const localDigestCache = new Map<string, Promise<string>>();
  const getLocalDigest = async (absPath: string): Promise<string> => {
    let digestPromise = localDigestCache.get(absPath);
    if (!digestPromise) {
      digestPromise = sha256File(absPath);
      localDigestCache.set(absPath, digestPromise);
    }
    return await digestPromise;
  };

  await mapLimit(
    Array.from(localFilesByKey.entries()),
    options.concurrency ?? 6,
    async ([key, file]) => {
      const remote = remoteByKey.get(key);
      let shouldUpload = true;
      let localDigest: string | null = null;

      if (remote && remote.size === file.size) {
        try {
          const head = await options.client.send(
            new HeadObjectCommand({
              Bucket: bucket,
              Key: key,
            }),
          );
          const metadata = head.Metadata ?? {};
          const remoteDigest = metadata["vivd-sha256"] || metadata["vivd_sha256"];
          if (remoteDigest) {
            localDigest = await getLocalDigest(file.absPath);
            if (localDigest === remoteDigest.toLowerCase()) {
              shouldUpload = false;
            }
          }
        } catch {
          // Fall back to upload.
        }
      }

      if (!shouldUpload) {
        filesUnchanged++;
        manifestEntries.push({
          relPath: file.posixRelPath,
          size: file.size,
          sha256: localDigest ?? (await getLocalDigest(file.absPath)),
        });
        return;
      }

      try {
        const digest = localDigest ?? (await getLocalDigest(file.absPath));
        await options.client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: fs.createReadStream(file.absPath),
            ContentLength: file.size,
            Metadata: {
              "vivd-sha256": digest,
            },
          }),
        );
        manifestEntries.push({
          relPath: file.posixRelPath,
          size: file.size,
          sha256: digest,
        });
        filesUploaded++;
        bytesUploaded += file.size;
      } catch (err) {
        errors.push({
          file: file.relPath,
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  try {
    const manifest: SyncManifest = {
      version: SYNC_MANIFEST_VERSION,
      generatedAt: new Date().toISOString(),
      files: manifestEntries.sort((a, b) => a.relPath.localeCompare(b.relPath)),
    };
    await options.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: manifestKey,
        Body: Buffer.from(`${JSON.stringify(manifest)}\n`, "utf-8"),
        ContentType: "application/json",
      }),
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    errors.push({
      file: SYNC_MANIFEST_FILENAME,
      key: manifestKey,
      error,
    });
  }

  return {
    filesUploaded,
    filesDeleted,
    filesUnchanged,
    bytesUploaded,
    errors,
  };
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

export async function downloadBucketPrefixToDirectoryIncremental(options: {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
  localDir: string;
  excludeDirNames?: string[];
  concurrency?: number;
}): Promise<{
  filesDownloaded: number;
  filesSkipped: number;
  filesDeleted: number;
  bytesDownloaded: number;
  errors: Array<{ key: string; file: string; error: string }>;
}> {
  const bucket = options.bucket.trim();
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);
  const rootDir = path.resolve(options.localDir);
  const excludedDirNames = new Set(options.excludeDirNames ?? []);
  const manifestKey = getSyncManifestKey(keyPrefix);

  await fs.promises.mkdir(rootDir, { recursive: true });

  const remoteObjectsAll = await listBucketObjects({
    client: options.client,
    bucket,
    keyPrefix,
  });
  const hasManifest = remoteObjectsAll.some((object) => object.key === manifestKey);
  const remoteObjects = remoteObjectsAll.filter((object) => object.key !== manifestKey);

  const manifestByRelPath = new Map<string, SyncManifestEntry>();
  const errors: Array<{ key: string; file: string; error: string }> = [];

  if (hasManifest) {
    try {
      const manifestObject = await getObjectBuffer({
        client: options.client,
        bucket,
        key: manifestKey,
      });
      const manifest = parseSyncManifest(manifestObject.buffer);
      if (!manifest) {
        errors.push({
          key: manifestKey,
          file: SYNC_MANIFEST_FILENAME,
          error: "Invalid sync manifest format",
        });
      } else {
        for (const entry of manifest.files) {
          manifestByRelPath.set(entry.relPath, entry);
        }
      }
    } catch (err) {
      errors.push({
        key: manifestKey,
        file: SYNC_MANIFEST_FILENAME,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const remoteFiles: Array<{ key: string; relPath: string; size: number }> = [];
  const expectedRelPaths = new Set<string>();

  for (const object of remoteObjects) {
    const relPathRaw = object.key.startsWith(keyPrefix)
      ? object.key.slice(keyPrefix.length)
      : object.key;
    const relPath = relPathRaw.replace(/^\/+/, "");
    if (!relPath) continue;
    if (isExcludedPath(relPath, excludedDirNames)) continue;

    const destPath = path.resolve(rootDir, relPath);
    if (!isPathInside(rootDir, destPath)) {
      errors.push({
        key: object.key,
        file: relPath,
        error: "Path traversal detected; skipped download",
      });
      continue;
    }

    expectedRelPaths.add(toPosixPath(relPath));
    remoteFiles.push({
      key: object.key,
      relPath,
      size: object.size,
    });
  }

  let filesDeleted = 0;
  const localFiles = await listFilesRecursively({
    rootDir,
    excludeDirNames: excludedDirNames,
  });

  for (const localFile of localFiles) {
    const relPath = toPosixPath(localFile.relPath);
    if (expectedRelPaths.has(relPath)) continue;
    try {
      await fs.promises.rm(localFile.absPath, { force: true });
      filesDeleted++;
    } catch (err) {
      errors.push({
        key: `${keyPrefix}${relPath}`,
        file: relPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let filesDownloaded = 0;
  let filesSkipped = 0;
  let bytesDownloaded = 0;

  await mapLimit(remoteFiles, options.concurrency ?? 6, async (remoteFile) => {
    const relPathPosix = toPosixPath(remoteFile.relPath);
    const destPath = path.resolve(rootDir, remoteFile.relPath);
    if (!isPathInside(rootDir, destPath)) {
      errors.push({
        key: remoteFile.key,
        file: relPathPosix,
        error: "Path traversal detected; skipped download",
      });
      return;
    }

    const manifestEntry = manifestByRelPath.get(relPathPosix);
    if (manifestEntry && manifestEntry.size === remoteFile.size) {
      try {
        const stat = await fs.promises.stat(destPath);
        if (stat.isFile() && stat.size === remoteFile.size) {
          const localDigest = await sha256File(destPath);
          if (localDigest === manifestEntry.sha256.toLowerCase()) {
            filesSkipped++;
            return;
          }
        }
      } catch {
        // Missing/unreadable local file; fall back to download.
      }
    }

    try {
      const response = await options.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: remoteFile.key,
        }),
      );
      await writeObjectBodyToFile(response.Body, destPath);
      filesDownloaded++;
      bytesDownloaded += response.ContentLength ?? remoteFile.size;
    } catch (err) {
      errors.push({
        key: remoteFile.key,
        file: relPathPosix,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { filesDownloaded, filesSkipped, filesDeleted, bytesDownloaded, errors };
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

function encodeCopySourceKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function copyBucketPrefix(options: {
  client: S3Client;
  bucket: string;
  sourceKeyPrefix: string;
  targetKeyPrefix: string;
  concurrency?: number;
}): Promise<{
  objectsCopied: number;
  errors: Array<{ sourceKey: string; targetKey: string; error: string }>;
}> {
  const bucket = options.bucket.trim();
  const sourceKeyPrefix = normalizeKeyPrefix(options.sourceKeyPrefix);
  const targetKeyPrefix = normalizeKeyPrefix(options.targetKeyPrefix);

  if (!bucket) {
    throw new Error("Bucket is required");
  }

  if (sourceKeyPrefix === targetKeyPrefix) {
    throw new Error("Source and target prefixes must differ");
  }

  const sourceObjects = await listBucketObjects({
    client: options.client,
    bucket,
    keyPrefix: sourceKeyPrefix,
  });

  let objectsCopied = 0;
  const errors: Array<{ sourceKey: string; targetKey: string; error: string }> = [];

  await mapLimit(sourceObjects, options.concurrency ?? 6, async (object) => {
    const sourceKey = object.key;
    const relativeKey = sourceKey.startsWith(sourceKeyPrefix)
      ? sourceKey.slice(sourceKeyPrefix.length)
      : "";
    if (!relativeKey) return;

    const targetKey = `${targetKeyPrefix}${relativeKey}`;
    const copySource = `${bucket}/${encodeCopySourceKey(sourceKey)}`;

    try {
      await options.client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: targetKey,
          CopySource: copySource,
        }),
      );
      objectsCopied += 1;
    } catch (err) {
      errors.push({
        sourceKey,
        targetKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { objectsCopied, errors };
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
