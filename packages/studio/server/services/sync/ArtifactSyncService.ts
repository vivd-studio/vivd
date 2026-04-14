import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectProjectType, hasNodeModules } from "../project/projectType.js";
import { ensureAstroCmsToolkit } from "../project/astroCmsToolkit.js";

type ArtifactKind = "source" | "preview" | "published";

type BuildMeta = {
  status: "building" | "ready" | "error";
  framework: "astro" | "generic";
  commitHash?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

type S3Client = {
  send: (command: unknown) => Promise<any>;
};

type AwsSdkModule = {
  S3Client: new (options: any) => S3Client;
  PutObjectCommand: new (input: any) => unknown;
  ListObjectsV2Command: new (input: any) => unknown;
  DeleteObjectsCommand: new (input: any) => unknown;
};

let awsSdkPromise: Promise<AwsSdkModule | null> | null = null;
let awsCliAvailable: boolean | null = null;

async function loadAwsSdk(): Promise<AwsSdkModule | null> {
  if (!awsSdkPromise) {
    awsSdkPromise = import("@aws-sdk/client-s3")
      .then((mod) => mod as unknown as AwsSdkModule)
      .catch(() => null);
  }
  return awsSdkPromise;
}

function isMissingFileError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return true;

  const message = err instanceof Error ? err.message : String(err);
  return /no such file or directory|cannot find/i.test(message);
}

function hasAwsCli(): boolean {
  if (awsCliAvailable !== null) return awsCliAvailable;
  const check = spawnSync("aws", ["--version"], {
    stdio: "ignore",
  });

  if (check.error) {
    const code = (check.error as NodeJS.ErrnoException).code;
    awsCliAvailable = code !== "ENOENT";
    return awsCliAvailable;
  }

  awsCliAvailable = check.status === 0;
  return awsCliAvailable;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

function getBucket(): string | null {
  const bucket = (process.env.VIVD_S3_BUCKET || process.env.R2_BUCKET || "").trim();
  return bucket || null;
}

function getEndpointUrl(): string | null {
  const endpoint = (
    process.env.VIVD_S3_ENDPOINT_URL ||
    process.env.R2_ENDPOINT ||
    ""
  ).trim();
  return endpoint || null;
}

function getTenantId(): string {
  return (
    process.env.VIVD_TENANT_ID ||
    process.env.TENANT_ID ||
    "default"
  ).trim();
}

function getBasePrefix(slug: string, version: number): string {
  const tenantId = getTenantId();
  const defaultPrefix = `tenants/${tenantId}/projects/${slug}/v${version}`;
  const configured = (process.env.VIVD_S3_PREFIX || "").trim();
  return trimSlashes(configured || defaultPrefix);
}

function getKeyPrefix(options: {
  slug: string;
  version: number;
  kind: ArtifactKind;
}): string {
  return `${getBasePrefix(options.slug, options.version)}/${options.kind}`;
}

function getS3Uri(options: {
  bucket: string;
  keyPrefix: string;
}): string {
  const prefix = trimSlashes(options.keyPrefix);
  return prefix ? `s3://${options.bucket}/${prefix}` : `s3://${options.bucket}`;
}

type ObjectStorageConfig = {
  bucket: string;
  endpointUrl?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

function getObjectStorageConfigFromEnv(): ObjectStorageConfig | null {
  const bucket = (process.env.VIVD_S3_BUCKET || process.env.R2_BUCKET || "").trim();
  if (!bucket) return null;

  const endpointUrl = (
    process.env.VIVD_S3_ENDPOINT_URL ||
    process.env.R2_ENDPOINT ||
    ""
  ).trim();

  const accessKeyId = (
    process.env.VIVD_S3_ACCESS_KEY_ID ||
    process.env.R2_ACCESS_KEY ||
    process.env.AWS_ACCESS_KEY_ID ||
    ""
  ).trim();
  const secretAccessKey = (
    process.env.VIVD_S3_SECRET_ACCESS_KEY ||
    process.env.R2_SECRET_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    ""
  ).trim();
  const sessionToken =
    (process.env.VIVD_S3_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN || "").trim() ||
    undefined;

  const region = (
    process.env.VIVD_S3_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "auto"
  ).trim();

  const r2Configured =
    Boolean(process.env.R2_BUCKET) ||
    Boolean(process.env.R2_ENDPOINT) ||
    Boolean(process.env.R2_ACCESS_KEY) ||
    Boolean(process.env.R2_SECRET_KEY);

  // If credentials are missing, don't attempt SDK mode (CLI might still work via profiles/roles).
  if (r2Configured && (!endpointUrl || !accessKeyId || !secretAccessKey)) {
    return null;
  }

  if (endpointUrl && (!accessKeyId || !secretAccessKey)) {
    return null;
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

async function listFilesRecursively(options: {
  rootDir: string;
  excludedPrefixes: string[];
}): Promise<Array<{ absPath: string; relPath: string; size: number }>> {
  const rootDir = path.resolve(options.rootDir);
  const files: Array<{ absPath: string; relPath: string; size: number }> = [];
  const excluded = options.excludedPrefixes;

  const isExcluded = (relPath: string): boolean => {
    if (!excluded.length) return false;
    const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    return excluded.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  };

  const walk = async (currentDir: string): Promise<void> => {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const relPath = toPosixPath(path.relative(rootDir, absPath));

      if (isExcluded(relPath)) continue;

      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }

      if (entry.isFile()) {
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(absPath);
        } catch (err) {
          // Files like .git/index.lock can disappear mid-walk; skip them.
          if (isMissingFileError(err)) continue;
          throw err;
        }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createS3Client(): Promise<{ client: S3Client; bucket: string } | null> {
  const config = getObjectStorageConfigFromEnv();
  if (!config) return null;

  const sdk = await loadAwsSdk();
  if (!sdk) return null;

  const client = new sdk.S3Client({
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

  return { client, bucket: config.bucket };
}

function getAwsErrorHttpStatusCode(err: unknown): number | null {
  const status = (err as any)?.$metadata?.httpStatusCode;
  return typeof status === "number" ? status : null;
}

function isRetryableAwsError(err: unknown): boolean {
  const status = getAwsErrorHttpStatusCode(err);
  if (status && [408, 429, 500, 502, 503, 504].includes(status)) return true;

  const message = err instanceof Error ? err.message : String(err);
  return Boolean(
    message &&
      /internal error|non-retryable streaming request|timeout|timed out|econnreset|econnrefused|epipe|socket hang up|network/i.test(
        message
      )
  );
}

async function deletePrefixSdk(options: {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
}): Promise<void> {
  const sdk = await loadAwsSdk();
  if (!sdk) throw new Error("Missing @aws-sdk/client-s3");

  const bucket = options.bucket.trim();
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);

  let continuationToken: string | undefined;
  do {
    const page = await options.client.send(
      new sdk.ListObjectsV2Command({
        Bucket: bucket,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
      })
    );

    const keys = (page.Contents ?? [])
      .map((obj: any) => obj.Key)
      .filter((key: any): key is string => typeof key === "string" && key.length > 0);

    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      if (batch.length === 0) continue;
      await options.client.send(
        new sdk.DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((Key: string) => ({ Key })),
            Quiet: true,
          },
        })
      );
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function uploadDirectorySdk(options: {
  client: S3Client;
  bucket: string;
  localDir: string;
  keyPrefix: string;
  exclude?: string[];
  concurrency?: number;
}): Promise<void> {
  const sdk = await loadAwsSdk();
  if (!sdk) throw new Error("Missing @aws-sdk/client-s3");

  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);
  const excludedPrefixes = normalizeExcludedPrefixes(options.exclude);

  const files = await listFilesRecursively({
    rootDir: options.localDir,
    excludedPrefixes,
  });

  await mapLimit(files, options.concurrency ?? 6, async (file) => {
    const key = `${keyPrefix}${toPosixPath(file.relPath)}`;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let size = file.size;
      try {
        const stat = await fs.promises.stat(file.absPath);
        if (!stat.isFile()) return;
        size = stat.size;
      } catch (err) {
        if (isMissingFileError(err)) return;
        throw err;
      }

      try {
        await options.client.send(
          new sdk.PutObjectCommand({
            Bucket: options.bucket,
            Key: key,
            // Re-create the stream for each attempt; AWS SDK won't retry non-seekable bodies.
            Body: fs.createReadStream(file.absPath),
            ContentLength: size,
          })
        );
        break;
      } catch (err) {
        if (isMissingFileError(err)) return;
        if (attempt >= maxAttempts || !isRetryableAwsError(err)) {
          throw err;
        }
        await sleep(Math.min(2_000, 200 * 2 ** (attempt - 1)));
      }
    }
  });
}

function resolveInstallCommand(projectDir: string, packageManager: "npm" | "pnpm" | "yarn"): {
  cmd: string;
  args: string[];
} {
  if (packageManager === "pnpm") {
    if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
      return { cmd: "pnpm", args: ["install", "--frozen-lockfile", "--prefer-offline"] };
    }
    return { cmd: "pnpm", args: ["install", "--prefer-offline"] };
  }

  if (packageManager === "yarn") {
    if (fs.existsSync(path.join(projectDir, "yarn.lock"))) {
      return { cmd: "yarn", args: ["install", "--frozen-lockfile", "--prefer-offline"] };
    }
    return { cmd: "yarn", args: ["install", "--prefer-offline"] };
  }

  if (
    fs.existsSync(path.join(projectDir, "package-lock.json")) ||
    fs.existsSync(path.join(projectDir, "npm-shrinkwrap.json"))
  ) {
    return { cmd: "npm", args: ["ci", "--prefer-offline", "--no-audit", "--no-fund"] };
  }

  return { cmd: "npm", args: ["install", "--prefer-offline", "--no-audit", "--no-fund"] };
}

function runCommand(options: {
  cmd: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  label: string;
  timeoutMs: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(options.cmd, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new Error(`${options.label} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    timeout.unref?.();

    proc.stdout?.on("data", (d) => {
      const text = d.toString().trim();
      if (text) {
        stdout = stdout ? `${stdout}\n${text}` : text;
        console.log(`[${options.label}] ${text}`);
      }
    });
    proc.stderr?.on("data", (d) => {
      const text = d.toString().trim();
      if (text) {
        stderr = stderr ? `${stderr}\n${text}` : text;
        console.error(`[${options.label}] ${text}`);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve();
      const detail = stderr || stdout;
      reject(new Error(detail || `${options.label} failed (exit code ${code ?? 1})`));
    });
  });
}

async function syncDirectoryToBucket(options: {
  source: string;
  bucket: string;
  keyPrefix: string;
  delete?: boolean;
  exclude?: string[];
  label: string;
}): Promise<void> {
  let sdkError: unknown = null;
  const sdkStorage = await createS3Client();
  if (sdkStorage) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (options.delete) {
          await deletePrefixSdk({
            client: sdkStorage.client,
            bucket: options.bucket,
            keyPrefix: options.keyPrefix,
          });
        }

        await uploadDirectorySdk({
          client: sdkStorage.client,
          bucket: options.bucket,
          localDir: options.source,
          keyPrefix: options.keyPrefix,
          exclude: options.exclude,
        });
        return;
      } catch (err) {
        sdkError = err;
        if (attempt < maxAttempts && isRetryableAwsError(err)) {
          await sleep(Math.min(2_000, 200 * 2 ** (attempt - 1)));
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[${options.label}] SDK upload failed, falling back to AWS CLI: ${message}`
        );
        break;
      }
    }
  }

  if (!hasAwsCli()) {
    const reason =
      sdkError instanceof Error
        ? sdkError.message
        : sdkError
          ? String(sdkError)
          : "AWS SDK storage client unavailable";
    throw new Error(
      `[${options.label}] AWS CLI is not installed and SDK sync failed: ${reason}`
    );
  }

  // Fallback to AWS CLI when available.
  const endpointUrl = getEndpointUrl();
  const args: string[] = [];
  if (endpointUrl) {
    args.push("--endpoint-url", endpointUrl);
  }

  const destination = getS3Uri({ bucket: options.bucket, keyPrefix: options.keyPrefix });
  args.push("s3", "sync", options.source, destination, "--only-show-errors");
  if (options.delete) args.push("--delete");
  for (const pattern of options.exclude ?? []) {
    args.push("--exclude", pattern);
  }

  await runCommand({
    cmd: "aws",
    args,
    cwd: process.cwd(),
    label: options.label,
    timeoutMs: 15 * 60 * 1000,
  });
}

function writeBuildMeta(distDir: string, meta: BuildMeta): void {
  const dir = path.join(distDir, ".vivd");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "build.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
}

async function uploadBuildMeta(options: {
  bucket: string;
  keyPrefix: string;
  label: string;
  meta: BuildMeta;
}): Promise<void> {
  const metaDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-build-meta-"));
  try {
    writeBuildMeta(metaDir, options.meta);
    await syncDirectoryToBucket({
      source: metaDir,
      bucket: options.bucket,
      keyPrefix: options.keyPrefix,
      delete: false,
      label: options.label,
    });
  } finally {
    fs.rmSync(metaDir, { recursive: true, force: true });
  }
}

export async function syncSourceToBucket(options: {
  projectDir: string;
  slug: string;
  version: number;
  commitHash?: string;
  exact?: boolean;
}): Promise<void> {
  const bucket = getBucket();
  if (!bucket) return;

  const config = detectProjectType(options.projectDir);
  await ensureAstroCmsToolkit(options.projectDir, config.framework);

  const keyPrefix = getKeyPrefix({ slug: options.slug, version: options.version, kind: "source" });

  await syncDirectoryToBucket({
    source: options.projectDir,
    bucket,
    keyPrefix,
    // Source sync is exact by default so remote keys don't resurrect deleted files.
    delete: options.exact ?? true,
    exclude: [
      "node_modules/*",
      "dist/*",
      ".astro/*",
      ".vivd/opencode-data/*",
      ".vivd/build.json",
      ".git/index.lock",
    ],
    label: "SourceSync",
  });

  await uploadBuildMeta({
    bucket,
    keyPrefix,
    label: "SourceMetaUpload",
    meta: {
      status: "ready",
      framework: "generic",
      commitHash: options.commitHash,
      completedAt: new Date().toISOString(),
    },
  });
}

async function ensureAstroBuild(projectDir: string, commitHash?: string): Promise<string> {
  const config = detectProjectType(projectDir);
  if (config.framework !== "astro") {
    throw new Error("Not an Astro project");
  }

  await ensureAstroCmsToolkit(projectDir, config.framework);

  if (!hasNodeModules(projectDir)) {
    const install = resolveInstallCommand(projectDir, config.packageManager);
    await runCommand({
      cmd: install.cmd,
      args: install.args,
      cwd: projectDir,
      label: "AstroInstall",
      timeoutMs: 15 * 60 * 1000,
    });
  }

  const distDir = path.join(projectDir, "dist");
  const astroBin = path.join(projectDir, "node_modules", ".bin", "astro");
  if (!fs.existsSync(astroBin)) {
    throw new Error("Astro CLI not found (node_modules/.bin/astro)");
  }

  const startedAt = new Date().toISOString();
  await runCommand({
    cmd: astroBin,
    args: ["build", "--outDir", "dist"],
    cwd: projectDir,
    label: "AstroBuild",
    timeoutMs: 15 * 60 * 1000,
  });

  writeBuildMeta(distDir, {
    status: "ready",
    framework: "astro",
    commitHash,
    startedAt,
    completedAt: new Date().toISOString(),
  });

  return distDir;
}

export async function buildAndUploadPreview(options: {
  projectDir: string;
  slug: string;
  version: number;
  commitHash?: string;
}): Promise<void> {
  const bucket = getBucket();
  if (!bucket) return;

  const config = detectProjectType(options.projectDir);
  if (config.framework !== "astro") return;

  const keyPrefix = getKeyPrefix({ slug: options.slug, version: options.version, kind: "preview" });
  const startedAt = new Date().toISOString();
  let distDir: string;
  try {
    distDir = await ensureAstroBuild(options.projectDir, options.commitHash);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await uploadBuildMeta({
        bucket,
        keyPrefix,
        label: "PreviewErrorMetaUpload",
        meta: {
          status: "error",
          framework: "astro",
          commitHash: options.commitHash,
          startedAt,
          completedAt: new Date().toISOString(),
          error: message,
        },
      });
    } catch (metaError) {
      const metaMessage = metaError instanceof Error ? metaError.message : String(metaError);
      console.warn(`[PreviewErrorMetaUpload] Failed to persist build error: ${metaMessage}`);
    }
    throw error;
  }

  await syncDirectoryToBucket({
    source: distDir,
    bucket,
    keyPrefix,
    delete: true,
    label: "PreviewUpload",
  });
}

export async function buildAndUploadPublished(options: {
  projectDir: string;
  slug: string;
  version: number;
  commitHash?: string;
}): Promise<void> {
  const bucket = getBucket();
  if (!bucket) return;

  const config = detectProjectType(options.projectDir);
  if (config.framework !== "astro") return;

  const distDir = await ensureAstroBuild(options.projectDir, options.commitHash);

  const keyPrefix = getKeyPrefix({ slug: options.slug, version: options.version, kind: "published" });

  await syncDirectoryToBucket({
    source: distDir,
    bucket,
    keyPrefix,
    delete: true,
    label: "PublishedUpload",
  });
}
