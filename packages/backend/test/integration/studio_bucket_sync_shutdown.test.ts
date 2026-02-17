/**
 * Studio Bucket Sync Shutdown Integration Test
 *
 * Verifies that the Studio runtime (prod image + entrypoint sync loop) uploads
 * both the workspace directory and the OpenCode data directory to object storage
 * on shutdown, and that a fresh container can hydrate those files again.
 *
 * Opt-in (writes to your configured bucket under a unique test prefix):
 *   VIVD_RUN_STUDIO_BUCKET_SYNC_TESTS=1 \
 *   npm run test:integration -w @vivd/backend -- test/integration/studio_bucket_sync_shutdown.test.ts
 *
 * Requires object storage env (loaded from repo root .env via test/setup.ts):
 *   R2_* or VIVD_S3_* credentials + endpoint (for R2) + bucket.
 *
 * Optional:
 *   VIVD_STUDIO_IMAGE=<existing studio image ref>  (skips docker build)
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  createS3Client,
  deleteBucketPrefix,
  getObjectStorageConfigFromEnv,
} from "../../src/services/ObjectStorageService";

const RUN = process.env.VIVD_RUN_STUDIO_BUCKET_SYNC_TESTS === "1";
const HAS_DOCKER_CLI = (() => {
  try {
    const res = spawnSync("docker", ["--version"], { stdio: "ignore" });
    return res.error === undefined && res.status === 0;
  } catch {
    return false;
  }
})();
const HAS_DOCKER_DAEMON = (() => {
  if (!HAS_DOCKER_CLI) return false;
  try {
    const res = spawnSync("docker", ["info"], {
      stdio: "ignore",
      timeout: 5_000,
    });
    return res.error === undefined && res.status === 0;
  } catch {
    return false;
  }
})();

const MAX_OUTPUT_CHARS = 20_000;

function redactSensitive(value: string): string {
  const patterns: Array<[RegExp, string]> = [
    [/(AWS_ACCESS_KEY_ID=)[^\s"'`]+/g, "$1***"],
    [/(AWS_SECRET_ACCESS_KEY=)[^\s"'`]+/g, "$1***"],
    [/(AWS_SESSION_TOKEN=)[^\s"'`]+/g, "$1***"],
    [/(OPENROUTER_API_KEY=)[^\s"'`]+/g, "$1***"],
    [/(GOOGLE_API_KEY=)[^\s"'`]+/g, "$1***"],
    [/(FLY_API_TOKEN=)[^\s"'`]+/g, "$1***"],
    [/sk-[a-zA-Z0-9_-]{10,}/g, "sk-***"],
    [/FlyV1\s+[A-Za-z0-9+/=._-]{20,}/g, "FlyV1 ***"],
  ];

  let out = value;
  for (const [re, replacement] of patterns) {
    out = out.replace(re, replacement);
  }
  return out;
}

function appendCapped(current: string, next: string): string {
  const merged = current + next;
  if (merged.length <= MAX_OUTPUT_CHARS) return merged;
  return merged.slice(-MAX_OUTPUT_CHARS);
}

function randomId(): string {
  return crypto.randomBytes(8).toString("hex");
}

async function readStreamToString(stream: any): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function run(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const startedAt = Date.now();

  return await new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const killTimer =
      typeof options.timeoutMs === "number"
        ? setTimeout(() => {
            try {
              proc.kill("SIGKILL");
            } catch {
              // ignore
            }
          }, options.timeoutMs)
        : null;

    proc.stdout?.on("data", (chunk) => {
      stdout = appendCapped(stdout, chunk.toString());
    });
    proc.stderr?.on("data", (chunk) => {
      stderr = appendCapped(stderr, chunk.toString());
    });

    proc.once("error", (err) => {
      if (killTimer) clearTimeout(killTimer);
      reject(err);
    });

    proc.once("exit", (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const elapsed = Date.now() - startedAt;
      const commandLabel = [cmd, ...args].join(" ");
      const sanitizedStdout = redactSensitive(stdout.trim());
      const sanitizedStderr = redactSensitive(stderr.trim());
      const details = [
        sanitizedStdout ? `stdout:\n${sanitizedStdout}` : "",
        sanitizedStderr ? `stderr:\n${sanitizedStderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      reject(
        new Error(
          `${commandLabel} exited with code ${code} after ${elapsed}ms${details ? `\n\n${details}` : ""}`,
        ),
      );
    });
  });
}

async function listKeys(options: {
  client: ReturnType<typeof createS3Client>;
  bucket: string;
  prefix: string;
}): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const page = await options.client.send(
      new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: options.prefix,
        ContinuationToken: token,
      }),
    );
    for (const item of page.Contents ?? []) {
      if (typeof item.Key === "string") out.push(item.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function waitForKeys(options: {
  client: ReturnType<typeof createS3Client>;
  bucket: string;
  prefix: string;
  expectedKeys: string[];
  timeoutMs?: number;
}): Promise<string[]> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 45_000;

  let lastKeys: string[] = [];
  while (Date.now() - startedAt < timeoutMs) {
    lastKeys = await listKeys({
      client: options.client,
      bucket: options.bucket,
      prefix: options.prefix,
    });

    const ok = options.expectedKeys.every((key) => lastKeys.includes(key));
    if (ok) return lastKeys;

    await new Promise((r) => setTimeout(r, 1_500));
  }

  return lastKeys;
}

describe("Studio bucket sync on shutdown", () => {
  if (RUN && !HAS_DOCKER_CLI) {
    console.warn(
      "[StudioBucketSyncTest] Skipping: docker CLI is required but was not found in PATH.",
    );
  } else if (RUN && !HAS_DOCKER_DAEMON) {
    console.warn(
      "[StudioBucketSyncTest] Skipping: docker daemon is not reachable. Start Docker Desktop (or ensure the daemon is running) and retry.",
    );
  }

  it.skipIf(!RUN)(
    "uploads workspace + opencode data on shutdown and hydrates them again",
    { timeout: 900_000 },
    async () => {
      if (!HAS_DOCKER_CLI) {
        throw new Error(
          "docker CLI is required for this test but was not found in PATH.",
        );
      }
      if (!HAS_DOCKER_DAEMON) {
        throw new Error(
          "docker daemon is not reachable. Start Docker Desktop (or ensure the daemon is running) and retry.",
        );
      }

      const cfg = getObjectStorageConfigFromEnv();
      const bucket = cfg.bucket;
      const client = createS3Client(cfg);

      // Create a unique prefix so the test never touches production project data.
      const testId = `${Date.now().toString(36)}-${randomId()}`;
      const basePrefix = `vivd-integration/studio-bucket-sync/${testId}`;

      const sourceUri = `s3://${bucket}/${basePrefix}/source`;
      const opencodeUri = `s3://${bucket}/${basePrefix}/opencode`;

      const markerSource = `MARKER-${testId}`;
      const markerOpencode = `OPENCODE-${testId}`;

      const tmpRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "vivd-studio-bucket-sync-"),
      );
      const envFile = path.join(tmpRoot, "studio.env");

      const workspaceDir = "/home/studio/project";
      const opencodeDataHome = "/home/studio/opencode-data";

      // Use env-file so secrets aren't present in the docker CLI arg list.
      const envLines = [
        `AWS_EC2_METADATA_DISABLED=true`,
        `AWS_DEFAULT_REGION=${cfg.region || "auto"}`,
        cfg.endpointUrl ? `VIVD_S3_ENDPOINT_URL=${cfg.endpointUrl}` : "",
        cfg.accessKeyId ? `AWS_ACCESS_KEY_ID=${cfg.accessKeyId}` : "",
        cfg.secretAccessKey ? `AWS_SECRET_ACCESS_KEY=${cfg.secretAccessKey}` : "",
        cfg.sessionToken ? `AWS_SESSION_TOKEN=${cfg.sessionToken}` : "",
        `VIVD_S3_BUCKET=${bucket}`,
        `VIVD_S3_SOURCE_URI=${sourceUri}`,
        `VIVD_S3_OPENCODE_URI=${opencodeUri}`,
        `VIVD_S3_SYNC_INTERVAL_SECONDS=3600`,
        `VIVD_WORKSPACE_DIR=${workspaceDir}`,
        `VIVD_OPENCODE_DATA_HOME=${opencodeDataHome}`,
        `XDG_DATA_HOME=${opencodeDataHome}`,
        `VIVD_TENANT_ID=integration`,
        `VIVD_PROJECT_SLUG=integration-studio-sync`,
        `VIVD_PROJECT_VERSION=1`,
      ].filter(Boolean);

      await fs.writeFile(envFile, `${envLines.join("\n")}\n`, "utf-8");

      const containerName = `vivd-studio-sync-${randomId()}`;
      const imageOverride = (process.env.VIVD_STUDIO_IMAGE || "").trim();
      const imageTag = imageOverride || `vivd-studio:bucket-sync-test-${testId}`;

      try {
        // Best-effort cleanup in case a previous run crashed.
        await run("docker", ["rm", "-f", containerName]).catch(() => {});

        if (!imageOverride) {
          await run(
            "docker",
            ["build", "-f", "packages/studio/Dockerfile", "--target", "prod", "-t", imageTag, "."],
            { cwd: path.resolve(process.cwd(), "..", "..") },
          ).catch(async () => {
            // Try again with cwd at repo root (common when tests run from workspace root).
            await run("docker", [
              "build",
              "-f",
              "packages/studio/Dockerfile",
              "--target",
              "prod",
              "-t",
              imageTag,
              ".",
            ]);
          });
        }

        // Start a long-lived container so we can exec and then stop to trigger final sync.
        await run("docker", [
          "run",
          "-d",
          "--name",
          containerName,
          "--env-file",
          envFile,
          imageTag,
          "sh",
          "-c",
          "sleep 3600",
        ]);

        // Create marker files after startup but before shutdown so the shutdown sync must upload them.
        await run("docker", [
          "exec",
          containerName,
          "sh",
          "-c",
          [
            "set -e",
            `mkdir -p "${workspaceDir}"`,
            `mkdir -p "${opencodeDataHome}/opencode/storage"`,
            `mkdir -p "${opencodeDataHome}/opencode/snapshot/testproj/objects/aa"`,
            `printf "%s\\n" "${markerSource}" > "${workspaceDir}/index.html"`,
            `printf "%s\\n" "${markerOpencode}" > "${opencodeDataHome}/opencode/storage/marker.txt"`,
            `printf "%s\\n" "OBJ-${testId}" > "${opencodeDataHome}/opencode/snapshot/testproj/objects/aa/bb"`,
          ].join(" && "),
        ]);

        // Stop with a short timeout to better approximate Fly's shutdown grace period.
        await run("docker", ["stop", "-t", "8", containerName], { timeoutMs: 60_000 });

        const sourcePrefix = `${basePrefix}/source/`;
        const opencodePrefix = `${basePrefix}/opencode/`;

        const expectedKeys = [
          `${sourcePrefix}index.html`,
          `${opencodePrefix}opencode/storage/marker.txt`,
          `${opencodePrefix}opencode/snapshot/testproj/objects/aa/bb`,
        ];

        const keys = await waitForKeys({
          client,
          bucket,
          prefix: `${basePrefix}/`,
          expectedKeys,
        });

        const missing = expectedKeys.filter((key) => !keys.includes(key));
        if (missing.length > 0) {
          const logs = await run("docker", ["logs", containerName]).catch(
            () => null,
          );
          const logText = logs
            ? redactSensitive(
                `${logs.stdout}\n${logs.stderr}`.trim().slice(-MAX_OUTPUT_CHARS),
              )
            : "";
          const suffix = logText ? `\n\ncontainer logs:\n${logText}` : "";
          throw new Error(
            `Expected synced keys not found in bucket. Missing: ${missing.join(
              ", ",
            )}. Found ${keys.length} key(s) under prefix ${basePrefix}/${suffix}`,
          );
        }

        // Verify contents in the bucket.
        const sourceObj = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: `${sourcePrefix}index.html`,
          }),
        );
        expect(await readStreamToString(sourceObj.Body)).toBe(`${markerSource}\n`);

        const opencodeObj = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: `${opencodePrefix}opencode/storage/marker.txt`,
          }),
        );
        expect(await readStreamToString(opencodeObj.Body)).toBe(`${markerOpencode}\n`);

        // Verify a fresh container can hydrate the markers again.
        await run("docker", [
          "run",
          "--rm",
          "--env-file",
          envFile,
          imageTag,
          "sh",
          "-c",
          [
            "set -e",
            `test "$(cat ${workspaceDir}/index.html)" = "${markerSource}"`,
            `test "$(cat ${opencodeDataHome}/opencode/storage/marker.txt)" = "${markerOpencode}"`,
            `test -f "${opencodeDataHome}/opencode/snapshot/testproj/objects/aa/bb"`,
          ].join(" && "),
        ]);
      } finally {
        await run("docker", ["rm", "-f", containerName]).catch(() => {});
        await deleteBucketPrefix({ client, bucket, keyPrefix: basePrefix }).catch(() => {});
      }
    },
  );
});
