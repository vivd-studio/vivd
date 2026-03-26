/**
 * Artifact sync object-storage integration test.
 *
 * Run with:
 *   npm run test:run -w @vivd/studio -- server/services/sync/ArtifactSyncService.integration.test.ts
 *
 * Requires:
 *   VIVD_RUN_ARTIFACT_SYNC_BUCKET_TESTS=1
 *   Object storage env vars (R2_* or VIVD_S3_* + AWS_*)
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncSourceToBucket } from "./ArtifactSyncService.js";

type StorageConfig = {
  bucket: string;
  endpointUrl?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

type AwsSdkModule = {
  S3Client: new (options: any) => { send: (command: unknown) => Promise<any> };
  ListObjectsV2Command: new (input: any) => unknown;
  DeleteObjectsCommand: new (input: any) => unknown;
  GetObjectCommand: new (input: any) => unknown;
};

const RUN_BUCKET_TESTS =
  process.env.VIVD_RUN_ARTIFACT_SYNC_BUCKET_TESTS === "1";

function getStorageConfigOrNull():
  | { config: StorageConfig; reason: null }
  | { config: null; reason: string } {
  const bucket = (process.env.VIVD_S3_BUCKET || process.env.R2_BUCKET || "").trim();
  if (!bucket) {
    return { config: null, reason: "missing VIVD_S3_BUCKET/R2_BUCKET" };
  }

  const endpointUrl = (
    process.env.VIVD_S3_ENDPOINT_URL ||
    process.env.R2_ENDPOINT ||
    ""
  ).trim();
  const accessKeyId = (
    process.env.R2_ACCESS_KEY ||
    process.env.AWS_ACCESS_KEY_ID ||
    ""
  ).trim();
  const secretAccessKey = (
    process.env.R2_SECRET_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    ""
  ).trim();
  const sessionToken = (process.env.AWS_SESSION_TOKEN || "").trim() || undefined;
  const region = (
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "auto"
  ).trim();

  if (endpointUrl && (!accessKeyId || !secretAccessKey)) {
    return {
      config: null,
      reason: "endpoint configured without credentials",
    };
  }

  return {
    config: {
      bucket,
      endpointUrl: endpointUrl || undefined,
      region,
      accessKeyId: accessKeyId || undefined,
      secretAccessKey: secretAccessKey || undefined,
      sessionToken,
    },
    reason: null,
  };
}

async function loadAwsSdkOrNull():
  Promise<
  | { sdk: AwsSdkModule; reason: null }
  | { sdk: null; reason: string }
  > {
  try {
    const sdk = (await import("@aws-sdk/client-s3")) as unknown as AwsSdkModule;
    return { sdk, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sdk: null, reason: message };
  }
}

async function listKeys(options: {
  client: { send: (command: unknown) => Promise<any> };
  sdk: AwsSdkModule;
  bucket: string;
  prefix: string;
}): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await options.client.send(
      new options.sdk.ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: options.prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const entry of page.Contents ?? []) {
      if (typeof entry.Key === "string") keys.push(entry.Key);
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys.sort();
}

async function deletePrefix(options: {
  client: { send: (command: unknown) => Promise<any> };
  sdk: AwsSdkModule;
  bucket: string;
  prefix: string;
}): Promise<void> {
  const keys = await listKeys(options);
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (batch.length === 0) continue;
    await options.client.send(
      new options.sdk.DeleteObjectsCommand({
        Bucket: options.bucket,
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }
}

async function readObjectText(options: {
  client: { send: (command: unknown) => Promise<any> };
  sdk: AwsSdkModule;
  bucket: string;
  key: string;
}): Promise<string> {
  const output = await options.client.send(
    new options.sdk.GetObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
    }),
  );

  const body = output.Body as any;
  if (!body) return "";
  if (typeof body.transformToString === "function") {
    return body.transformToString();
  }
  if (typeof body.transformToByteArray === "function") {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes).toString("utf-8");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const storage = getStorageConfigOrNull();
const awsSdk = await loadAwsSdkOrNull();
const SHOULD_RUN =
  RUN_BUCKET_TESTS && storage.config !== null && awsSdk.sdk !== null;

describe.sequential("ArtifactSyncService bucket integration", () => {
  it.skipIf(!SHOULD_RUN)(
    "syncs source with excludes and deletes stale remote keys on exact sync",
    { timeout: 180_000 },
    async () => {
      const config = storage.config!;
      const sdk = awsSdk.sdk!;
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

      const previousPrefix = process.env.VIVD_S3_PREFIX;
      const uniqueId = `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const testPrefix = `integration/artifact-sync/${uniqueId}`;
      const sourcePrefix = `${testPrefix}/source/`;
      const slug = "artifact-sync-test";
      const version = 1;

      const projectDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "vivd-artifact-sync-it-"),
      );

      try {
        process.env.VIVD_S3_PREFIX = testPrefix;

        await fs.mkdir(path.join(projectDir, "nested"), { recursive: true });
        await fs.mkdir(path.join(projectDir, "dist"), { recursive: true });
        await fs.mkdir(path.join(projectDir, "node_modules"), { recursive: true });
        await fs.mkdir(path.join(projectDir, ".astro"), { recursive: true });
        await fs.mkdir(path.join(projectDir, ".vivd", "opencode-data"), {
          recursive: true,
        });

        await fs.writeFile(path.join(projectDir, "index.html"), "<h1>Home</h1>\n");
        await fs.writeFile(path.join(projectDir, "nested", "about.html"), "<p>About</p>\n");
        await fs.writeFile(path.join(projectDir, "dist", "index.html"), "ignored\n");
        await fs.writeFile(path.join(projectDir, "node_modules", "pkg.js"), "ignored\n");
        await fs.writeFile(path.join(projectDir, ".astro", "cache.txt"), "ignored\n");
        await fs.writeFile(
          path.join(projectDir, ".vivd", "opencode-data", "secret.txt"),
          "ignored\n",
        );
        await fs.writeFile(
          path.join(projectDir, ".vivd", "build.json"),
          '{"status":"old"}\n',
        );

        await syncSourceToBucket({
          projectDir,
          slug,
          version,
          commitHash: "commit-1",
          exact: true,
        });

        const firstKeys = await listKeys({
          client,
          sdk,
          bucket: config.bucket,
          prefix: sourcePrefix,
        });

        expect(firstKeys).toContain(`${sourcePrefix}index.html`);
        expect(firstKeys).toContain(`${sourcePrefix}nested/about.html`);
        expect(firstKeys).toContain(`${sourcePrefix}.vivd/build.json`);
        expect(firstKeys).not.toContain(`${sourcePrefix}dist/index.html`);
        expect(firstKeys).not.toContain(`${sourcePrefix}node_modules/pkg.js`);
        expect(firstKeys).not.toContain(`${sourcePrefix}.astro/cache.txt`);
        expect(firstKeys).not.toContain(
          `${sourcePrefix}.vivd/opencode-data/secret.txt`,
        );

        const firstBuildMeta = JSON.parse(
          await readObjectText({
            client,
            sdk,
            bucket: config.bucket,
            key: `${sourcePrefix}.vivd/build.json`,
          }),
        ) as { commitHash?: string; status?: string };
        expect(firstBuildMeta.status).toBe("ready");
        expect(firstBuildMeta.commitHash).toBe("commit-1");

        await fs.rm(path.join(projectDir, "nested", "about.html"), { force: true });
        await fs.writeFile(path.join(projectDir, "contact.html"), "<p>Contact</p>\n");

        await syncSourceToBucket({
          projectDir,
          slug,
          version,
          commitHash: "commit-2",
          exact: true,
        });

        const secondKeys = await listKeys({
          client,
          sdk,
          bucket: config.bucket,
          prefix: sourcePrefix,
        });

        expect(secondKeys).toContain(`${sourcePrefix}index.html`);
        expect(secondKeys).toContain(`${sourcePrefix}contact.html`);
        expect(secondKeys).not.toContain(`${sourcePrefix}nested/about.html`);

        const secondBuildMeta = JSON.parse(
          await readObjectText({
            client,
            sdk,
            bucket: config.bucket,
            key: `${sourcePrefix}.vivd/build.json`,
          }),
        ) as { commitHash?: string; status?: string };
        expect(secondBuildMeta.status).toBe("ready");
        expect(secondBuildMeta.commitHash).toBe("commit-2");
      } finally {
        try {
          await deletePrefix({
            client,
            sdk,
            bucket: config.bucket,
            prefix: sourcePrefix,
          });
        } catch {
          // best-effort cleanup
        }
        await fs.rm(projectDir, { recursive: true, force: true });

        if (typeof previousPrefix === "string") {
          process.env.VIVD_S3_PREFIX = previousPrefix;
        } else {
          delete process.env.VIVD_S3_PREFIX;
        }
      }
    },
  );

  it.skipIf(SHOULD_RUN)(
    "documents skip reason when bucket integration env is missing",
    () => {
      const reasons: string[] = [];
      if (!RUN_BUCKET_TESTS) {
        reasons.push("VIVD_RUN_ARTIFACT_SYNC_BUCKET_TESTS!=1");
      }
      if (!storage.config) {
        reasons.push(`object storage unavailable: ${storage.reason}`);
      }
      if (!awsSdk.sdk) {
        reasons.push(`missing @aws-sdk/client-s3: ${awsSdk.reason}`);
      }
      expect(reasons.length).toBeGreaterThan(0);
    },
  );
});
