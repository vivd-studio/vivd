#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const DEFAULT_IMAGE = "vivd-studio:revert-smoke";
const DEFAULT_TIMEOUT_MS = 420_000;
const DEFAULT_MINIO_IMAGE = "minio/minio:latest";
const PROJECT_SLUG = "ci-studio-revert-smoke";
const PROJECT_VERSION = 1;
const STUDIO_AUTH_HEADER = "x-vivd-studio-token";
const DEFAULT_BUCKET = "vivd";
const DEFAULT_REGION = "us-east-1";
const LOG_ERROR_PATTERNS = [
  /fatal: not a git repository/i,
  /failed to list snapshot files/i,
];

function log(message) {
  console.log(`[studio-image-revert-smoke] ${message}`);
}

function logCheckpoint(name, details = {}) {
  const pairs = Object.entries(details).filter(([, value]) => value !== undefined);
  if (pairs.length === 0) {
    log(`Checkpoint: ${name}`);
    return;
  }
  log(
    `Checkpoint: ${name} (${pairs
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", ")})`,
  );
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd,
    env: options.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${stderr || stdout || "unknown error"}`,
    );
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function runDocker(args, options = {}) {
  return runCommand("docker", args, options);
}

function parseDotenvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex <= 0) return null;

  const key = trimmed.slice(0, eqIndex).trim();
  if (!key) return null;

  let value = trimmed.slice(eqIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadLocalEnv(baseEnv) {
  const nextEnv = { ...baseEnv };
  const rootDir = process.cwd();
  const files = [
    ".env",
    ".env.local",
    "packages/backend/.env",
    "packages/backend/.env.local",
  ];

  for (const relativeFile of files) {
    const absoluteFile = path.join(rootDir, relativeFile);
    if (!existsSync(absoluteFile)) continue;

    const lines = readFileSync(absoluteFile, "utf8").split(/\r?\n/u);
    for (const line of lines) {
      const parsed = parseDotenvLine(line);
      if (!parsed) continue;
      if (nextEnv[parsed.key] == null || nextEnv[parsed.key] === "") {
        nextEnv[parsed.key] = parsed.value;
      }
    }
  }

  return nextEnv;
}

const effectiveEnv = loadLocalEnv(process.env);

function getOptionalEnv(name) {
  const value = effectiveEnv[name]?.trim();
  return value ? value : null;
}

function getTimeoutMs() {
  const raw = getOptionalEnv("VIVD_STUDIO_REVERT_SMOKE_TIMEOUT_MS");
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 30_000) {
    throw new Error(
      "VIVD_STUDIO_REVERT_SMOKE_TIMEOUT_MS must be an integer >= 30000",
    );
  }
  return parsed;
}

function parseModelSelection(rawValue, tier) {
  const slashIndex = rawValue.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= rawValue.length - 1) {
    throw new Error(
      `Invalid model value for ${tier}: expected "provider/modelId", got "${rawValue}"`,
    );
  }

  return {
    tier,
    provider: rawValue.slice(0, slashIndex),
    modelId: rawValue.slice(slashIndex + 1),
    rawValue,
  };
}

function hasProviderCredentials(provider) {
  switch (provider) {
    case "openrouter":
      return Boolean(getOptionalEnv("OPENROUTER_API_KEY"));
    case "google":
      return Boolean(
        getOptionalEnv("GOOGLE_API_KEY") ||
          getOptionalEnv("GOOGLE_APPLICATION_CREDENTIALS") ||
          getOptionalEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON"),
      );
    default:
      return true;
  }
}

function getPreferredModelTiers() {
  const raw =
    getOptionalEnv("VIVD_STUDIO_REVERT_SMOKE_MODEL_TIERS") ||
    getOptionalEnv("VIVD_STUDIO_SMOKE_MODEL_TIERS") ||
    "standard,advanced,pro";

  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function selectEditModel() {
  const errors = [];

  for (const tier of getPreferredModelTiers()) {
    const envKey = `OPENCODE_MODEL_${tier.toUpperCase()}`;
    const rawValue = getOptionalEnv(envKey);
    if (!rawValue) {
      errors.push(`${envKey} missing`);
      continue;
    }

    const selection = parseModelSelection(rawValue, tier);
    if (!hasProviderCredentials(selection.provider)) {
      errors.push(`${envKey} configured but provider credentials missing`);
      continue;
    }

    return selection;
  }

  throw new Error(
    `No usable edit model configured for revert smoke (${errors.join("; ")})`,
  );
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address && "port" in address) {
          resolve(address.port);
          return;
        }
        reject(new Error("Could not determine free port"));
      });
    });
  });
}

function getContainerLogs(containerId) {
  const result = runDocker(["logs", containerId], { allowFailure: true });
  return `${result.stdout}${result.stderr}`.trim();
}

function assertContainerRunning(containerId, phase) {
  const inspect = runDocker(
    ["inspect", "-f", "{{.State.Running}}", containerId],
    { allowFailure: true },
  );

  if (inspect.status === 0 && inspect.stdout.trim() === "true") {
    return;
  }

  const logs = getContainerLogs(containerId);
  throw new Error(
    `Container ${containerId} stopped during ${phase}.${logs ? ` Logs:\n${logs}` : ""}`,
  );
}

async function waitForHttpOk(url, containerId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (containerId) {
      assertContainerRunning(containerId, `waiting for ${url}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry.
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForHealth(baseUrl, containerId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    assertContainerRunning(containerId, "startup");

    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        const body = await response.json();
        if (body?.status === "ok" && body?.initialized === true) {
          return body;
        }
      }
    } catch {
      // Retry.
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for Studio health at ${baseUrl}/health`);
}

async function waitForCondition(description, timeoutMs, fn) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await fn();
      if (result) {
        return result;
      }
      lastError = null;
    } catch (error) {
      lastError = error;
    }

    await sleep(1_000);
  }

  const detail =
    lastError instanceof Error
      ? lastError.stack || lastError.message
      : lastError
        ? String(lastError)
        : "condition remained false";
  throw new Error(`Timed out waiting for ${description}: ${detail}`);
}

function createTrpcClient(baseUrl, accessToken) {
  return createTRPCProxyClient({
    links: [
      httpBatchLink({
        url: new URL("/trpc", baseUrl).toString(),
        fetch(url, init) {
          const headers = new Headers(init?.headers);
          headers.set(STUDIO_AUTH_HEADER, accessToken);
          return fetch(url, { ...init, headers });
        },
      }),
    ],
  });
}

async function waitForSessionIdle(client, sessionId, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const statuses = await client.agent.getSessionsStatus.query({
      projectSlug: PROJECT_SLUG,
      version: PROJECT_VERSION,
    });

    const status = statuses?.[sessionId]?.type;
    if (status === "idle" || status === "done") {
      return;
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for session ${sessionId} to become idle`);
}

function extractSummaryDiffs(message) {
  const rawDiffs = Array.isArray(message?.info?.summary?.diffs)
    ? message.info.summary.diffs
    : [];

  return rawDiffs.filter(
    (diff) => diff && typeof diff === "object" && typeof diff.file === "string",
  );
}

async function waitForUserMessageWithDiffs(client, sessionId, timeoutMs) {
  return waitForCondition(
    `tracked file diffs for session ${sessionId}`,
    timeoutMs,
    async () => {
      const messages = await client.agent.getSessionContent.query({
        sessionId,
        projectSlug: PROJECT_SLUG,
        version: PROJECT_VERSION,
      });

      const userMessage = [...messages]
        .reverse()
        .find((message) => message?.info?.role === "user");

      if (!userMessage?.info?.id) {
        return null;
      }

      const diffs = extractSummaryDiffs(userMessage);
      if (diffs.length === 0) {
        return null;
      }

      return { messages, userMessage, diffs };
    },
  );
}

async function waitForFileToContain(filePath, expected, timeoutMs) {
  return waitForCondition(
    `${path.basename(filePath)} to contain ${expected}`,
    timeoutMs,
    async () => {
      const content = await fs.readFile(filePath, "utf-8");
      return content.includes(expected) ? content : null;
    },
  );
}

async function waitForFileToNotContain(filePath, unexpected, timeoutMs) {
  return waitForCondition(
    `${path.basename(filePath)} to stop containing ${unexpected}`,
    timeoutMs,
    async () => {
      const content = await fs.readFile(filePath, "utf-8");
      return content.includes(unexpected) ? null : content;
    },
  );
}

function createWorkspaceDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeInitialWorkspaceFile(workspaceDir) {
  writeFileSync(
    path.join(workspaceDir, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "  <head>",
      '    <meta charset="utf-8" />',
      "    <title>Vivd Studio Revert Smoke</title>",
      "  </head>",
      "  <body>",
      "    <main>",
      "      <h1>Vivd Studio Revert Smoke</h1>",
      "      <p>This workspace verifies OpenCode tracking and revert hydration.</p>",
      "    </main>",
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
}

function initializeGitWorkspace(workspaceDir) {
  writeInitialWorkspaceFile(workspaceDir);

  runCommand("git", ["init"], { cwd: workspaceDir });
  runCommand("git", ["config", "user.email", "smoke@vivd.local"], {
    cwd: workspaceDir,
  });
  runCommand("git", ["config", "user.name", "Vivd Smoke"], {
    cwd: workspaceDir,
  });
  runCommand("git", ["branch", "-M", "main"], {
    cwd: workspaceDir,
    allowFailure: true,
  });
  runCommand("git", ["add", "-A"], { cwd: workspaceDir });
  runCommand("git", ["commit", "-m", "init"], { cwd: workspaceDir });
}

function tryRemoveWorkspaceDir(workspaceDir) {
  try {
    rmSync(workspaceDir, { recursive: true, force: true });
    return null;
  } catch (error) {
    return error;
  }
}

function cleanupWorkspaceDir(image, workspaceDir) {
  const initialError = tryRemoveWorkspaceDir(workspaceDir);
  if (!initialError) {
    return;
  }

  runDocker(
    [
      "run",
      "--rm",
      "--volume",
      `${workspaceDir}:/workspace/project`,
      "--entrypoint",
      "/bin/sh",
      image,
      "-lc",
      "chmod -R a+rwX /workspace/project || true",
    ],
    { allowFailure: true },
  );

  const retryError = tryRemoveWorkspaceDir(workspaceDir);
  if (!retryError) {
    return;
  }

  const retryMessage =
    retryError instanceof Error ? retryError.message : String(retryError);
  console.warn(
    `[studio-image-revert-smoke] Warning: failed to remove temp workspace ${workspaceDir}: ${retryMessage}`,
  );
}

function createS3Client(endpointUrl, accessKeyId, secretAccessKey, region) {
  return new S3Client({
    region,
    endpoint: endpointUrl,
    forcePathStyle: true,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

async function ensureBucketExists(client, bucket) {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/i.test(message)) {
      throw error;
    }
  }
}

async function listKeys(client, bucket, prefix) {
  const keys = [];
  let continuationToken;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const entry of page.Contents ?? []) {
      if (typeof entry.Key === "string") {
        keys.push(entry.Key);
      }
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys.sort();
}

async function deletePrefix(client, bucket, prefix) {
  const keys = await listKeys(client, bucket, prefix);
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (batch.length === 0) continue;
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }
}

async function readObjectText(client, bucket, key) {
  const output = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  const body = output.Body;
  if (!body) return "";
  if (typeof body.transformToString === "function") {
    return body.transformToString();
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function waitForObjectToContain(client, bucket, key, expected, timeoutMs) {
  return waitForCondition(
    `s3://${bucket}/${key} to contain ${expected}`,
    timeoutMs,
    async () => {
      const content = await readObjectText(client, bucket, key);
      return content.includes(expected) ? content : null;
    },
  );
}

async function waitForPrefixToHaveKeys(client, bucket, prefix, timeoutMs) {
  return waitForCondition(
    `s3://${bucket}/${prefix} to contain objects`,
    timeoutMs,
    async () => {
      const keys = await listKeys(client, bucket, prefix);
      return keys.length > 0 ? keys : null;
    },
  );
}

async function waitForObjectKey(client, bucket, key, timeoutMs) {
  return waitForCondition(
    `s3://${bucket}/${key} to exist`,
    timeoutMs,
    async () => {
      const keys = await listKeys(client, bucket, key);
      return keys.includes(key) ? keys : null;
    },
  );
}

function buildStudioEnvArgs(options) {
  const env = {
    PORT: "3100",
    STUDIO_ACCESS_TOKEN: options.accessToken,
    STUDIO_ID: options.studioId,
    VIVD_WORKSPACE_DIR: "/workspace/project",
    OPENCODE_IDLE_TIMEOUT_MS: "0",
    OPENCODE_SERVER_READY_TIMEOUT_MS: "120000",
    VIVD_S3_SOURCE_URI: options.sourceUri,
    VIVD_S3_OPENCODE_URI: options.opencodeUri,
    VIVD_S3_ENDPOINT_URL: options.endpointUrl,
    AWS_ACCESS_KEY_ID: options.accessKeyId,
    AWS_SECRET_ACCESS_KEY: options.secretAccessKey,
    AWS_DEFAULT_REGION: options.region,
    AWS_REGION: options.region,
    AWS_EC2_METADATA_DISABLED: "true",
    VIVD_S3_SYNC_INTERVAL_SECONDS: "3600",
  };

  const passthroughKeys = [
    "OPENROUTER_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_CLOUD_PROJECT",
    "VERTEX_LOCATION",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH",
    "OPENCODE_MODEL_STANDARD",
    "OPENCODE_MODEL_ADVANCED",
    "OPENCODE_MODEL_PRO",
  ];

  for (const key of passthroughKeys) {
    const value = getOptionalEnv(key);
    if (value) {
      env[key] = value;
    }
  }

  const args = [];
  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }
  return args;
}

function startStudioContainer(options) {
  const runArgs = [
    "run",
    "--detach",
    "--name",
    options.containerName,
    "--network",
    options.networkName,
    "--publish",
    `127.0.0.1:${options.port}:3100`,
    "--volume",
    `${options.workspaceDir}:/workspace/project`,
    ...buildStudioEnvArgs(options),
    options.image,
  ];

  const containerId = runDocker(runArgs).stdout.trim();
  if (!containerId) {
    throw new Error("docker run did not return a studio container id");
  }
  return containerId;
}

async function stopContainer(containerId) {
  runDocker(["stop", "--time", "60", containerId], { allowFailure: true });
}

async function removeContainer(containerId) {
  runDocker(["rm", "-f", containerId], { allowFailure: true });
}

function assertNoBrokenSnapshotLogs(logs) {
  for (const pattern of LOG_ERROR_PATTERNS) {
    assert.doesNotMatch(logs, pattern, `Unexpected Studio log output matching ${pattern}`);
  }
}

function assertAvailableModel(availableModels, selection) {
  const available = availableModels.find((entry) => entry?.tier === selection.tier);
  assert.ok(available, `Configured ${selection.tier} tier missing from Studio model list`);
  assert.equal(available.provider, selection.provider, `${selection.tier} provider mismatch`);
  assert.equal(available.modelId, selection.modelId, `${selection.tier} model mismatch`);
}

async function readFileContains(filePath, needle) {
  const content = await fs.readFile(filePath, "utf-8");
  return content.includes(needle);
}

async function main() {
  const image = getOptionalEnv("STUDIO_IMAGE") || DEFAULT_IMAGE;
  const timeoutMs = getTimeoutMs();
  const model = selectEditModel();
  const runId = randomUUID().slice(0, 12);
  const networkName = `vivd-studio-revert-smoke-${runId}`;
  const minioName = `vivd-minio-revert-smoke-${runId}`;
  const firstStudioName = `vivd-studio-revert-smoke-a-${runId}`;
  const secondStudioName = `vivd-studio-revert-smoke-b-${runId}`;
  const firstStudioPort = await getFreePort();
  const secondStudioPort = await getFreePort();
  const minioPort = await getFreePort();
  const accessKeyId = "vivdsmoke";
  const secretAccessKey = `vivdsmoke-${randomUUID().replace(/-/g, "")}`;
  const bucket = DEFAULT_BUCKET;
  const region = DEFAULT_REGION;
  const sourcePrefix = `smoke/opencode-revert/${runId}/source`;
  const opencodePrefix = `smoke/opencode-revert/${runId}/opencode`;
  const sourceUri = `s3://${bucket}/${sourcePrefix}`;
  const opencodeUri = `s3://${bucket}/${opencodePrefix}`;
  const hostS3Endpoint = `http://127.0.0.1:${minioPort}`;
  const containerS3Endpoint = "http://minio:9000";
  const workspaceDir = createWorkspaceDir("vivd-studio-revert-smoke-");
  const rehydratedWorkspaceDir = createWorkspaceDir(
    "vivd-studio-revert-smoke-rehydrated-",
  );
  const indexPath = path.join(workspaceDir, "index.html");
  const rehydratedIndexPath = path.join(rehydratedWorkspaceDir, "index.html");
  const s3 = createS3Client(
    hostS3Endpoint,
    accessKeyId,
    secretAccessKey,
    region,
  );
  let minioContainerId = null;
  let firstStudioContainerId = null;
  let secondStudioContainerId = null;
  let firstStudioLogs = "";
  let secondStudioLogs = "";
  let succeeded = false;
  const firstAccessToken = randomUUID();
  const secondAccessToken = randomUUID();
  const firstMarker = `opencode-revert-smoke-${runId}-one`;
  const secondMarker = `opencode-revert-smoke-${runId}-two`;

  initializeGitWorkspace(workspaceDir);

  log(`Using image ${image}`);
  log(`Using model ${model.rawValue} for revert smoke`);

  try {
    runDocker(["network", "create", networkName]);

    minioContainerId = runDocker([
      "run",
      "--detach",
      "--name",
      minioName,
      "--network",
      networkName,
      "--network-alias",
      "minio",
      "--publish",
      `127.0.0.1:${minioPort}:9000`,
      "--env",
      `MINIO_ROOT_USER=${accessKeyId}`,
      "--env",
      `MINIO_ROOT_PASSWORD=${secretAccessKey}`,
      getOptionalEnv("VIVD_STUDIO_REVERT_SMOKE_MINIO_IMAGE") || DEFAULT_MINIO_IMAGE,
      "server",
      "/data",
    ]).stdout.trim();
    if (!minioContainerId) {
      throw new Error("docker run did not return a MinIO container id");
    }

    await waitForHttpOk(
      `${hostS3Endpoint}/minio/health/live`,
      minioContainerId,
      timeoutMs,
    );
    await ensureBucketExists(s3, bucket);

    firstStudioContainerId = startStudioContainer({
      image,
      containerName: firstStudioName,
      networkName,
      port: firstStudioPort,
      workspaceDir,
      accessToken: firstAccessToken,
      studioId: "studio-image-revert-smoke-a",
      sourceUri,
      opencodeUri,
      endpointUrl: containerS3Endpoint,
      accessKeyId,
      secretAccessKey,
      region,
    });

    const firstBaseUrl = `http://127.0.0.1:${firstStudioPort}`;
    await waitForHealth(firstBaseUrl, firstStudioContainerId, timeoutMs);

    const firstClient = createTrpcClient(firstBaseUrl, firstAccessToken);
    const firstAvailableModels = await firstClient.agent.getAvailableModels.query();
    assertAvailableModel(firstAvailableModels, model);

    const firstRun = await firstClient.agent.runTask.mutate({
      projectSlug: PROJECT_SLUG,
      version: PROJECT_VERSION,
      task: `In index.html, add this exact HTML comment as the first line: <!-- ${firstMarker} -->. Do not use terminal commands.`,
      model: {
        provider: model.provider,
        modelId: model.modelId,
      },
    });

    assert.equal(firstRun?.success, true, "Expected first runTask to succeed");
    assert.ok(
      typeof firstRun?.sessionId === "string" && firstRun.sessionId.length > 0,
      "Expected first runTask to return a sessionId",
    );

    await waitForSessionIdle(firstClient, firstRun.sessionId, timeoutMs);
    await waitForFileToContain(indexPath, firstMarker, timeoutMs);

    const firstSessionSummary = await waitForUserMessageWithDiffs(
      firstClient,
      firstRun.sessionId,
      timeoutMs,
    );
    assert.ok(
      firstSessionSummary.diffs.some((diff) => diff.file.includes("index.html")),
      "Expected tracked diff summary to include index.html",
    );
    const firstUserMessageId = firstSessionSummary.userMessage.info.id;
    logCheckpoint("initial_edit_tracked", {
      sessionId: firstRun.sessionId,
      messageId: firstUserMessageId,
      diffFiles: firstSessionSummary.diffs.length,
    });

    const sourceIndexKey = `${sourcePrefix}/index.html`;
    const snapshotPrefix = `${opencodePrefix}/snapshot/`;
    const sessionDiffPrefix = `${opencodePrefix}/storage/session_diff/`;
    const opencodeDbKey = `${opencodePrefix}/opencode.db`;

    await waitForObjectToContain(s3, bucket, sourceIndexKey, firstMarker, timeoutMs);
    await waitForPrefixToHaveKeys(s3, bucket, snapshotPrefix, timeoutMs);
    await waitForPrefixToHaveKeys(s3, bucket, sessionDiffPrefix, timeoutMs);
    logCheckpoint("initial_state_synced", {
      sourceKey: sourceIndexKey,
      snapshotPrefix,
      sessionDiffPrefix,
    });

    await stopContainer(firstStudioContainerId);
    firstStudioLogs = getContainerLogs(firstStudioContainerId);
    assertNoBrokenSnapshotLogs(firstStudioLogs);
    await waitForObjectKey(s3, bucket, opencodeDbKey, timeoutMs);
    logCheckpoint("initial_opencode_db_synced", {
      opencodeDbKey,
    });
    await removeContainer(firstStudioContainerId);
    firstStudioContainerId = null;

    secondStudioContainerId = startStudioContainer({
      image,
      containerName: secondStudioName,
      networkName,
      port: secondStudioPort,
      workspaceDir: rehydratedWorkspaceDir,
      accessToken: secondAccessToken,
      studioId: "studio-image-revert-smoke-b",
      sourceUri,
      opencodeUri,
      endpointUrl: containerS3Endpoint,
      accessKeyId,
      secretAccessKey,
      region,
    });

    const secondBaseUrl = `http://127.0.0.1:${secondStudioPort}`;
    await waitForHealth(secondBaseUrl, secondStudioContainerId, timeoutMs);
    const secondClient = createTrpcClient(secondBaseUrl, secondAccessToken);

    await waitForFileToContain(rehydratedIndexPath, firstMarker, timeoutMs);
    logCheckpoint("hydrated_workspace_restored", {
      marker: firstMarker,
    });

    secondStudioLogs = getContainerLogs(secondStudioContainerId);
    assert.match(
      secondStudioLogs,
      /Repaired snapshot git directories:/,
      "Expected hydrated Studio logs to report snapshot repair",
    );
    assertNoBrokenSnapshotLogs(secondStudioLogs);

    const revertResult = await secondClient.agent.revertToMessage.mutate({
      projectSlug: PROJECT_SLUG,
      version: PROJECT_VERSION,
      sessionId: firstRun.sessionId,
      messageId: firstUserMessageId,
    });

    const fileContainsMarkerImmediatelyAfterRevert = await readFileContains(
      rehydratedIndexPath,
      firstMarker,
    );
    logCheckpoint("rehydrate_revert_response", {
      reverted: revertResult?.reverted,
      reason:
        revertResult && "reason" in revertResult ? revertResult.reason : undefined,
      fileContainsMarkerImmediatelyAfterRevert,
    });

    assert.equal(revertResult?.success, true, "Expected revertToMessage to succeed");
    if (revertResult?.reverted !== true) {
      log(
        `Rehydrate revert reported reverted=${String(revertResult?.reverted)}${
          revertResult?.reason ? ` reason=${String(revertResult.reason)}` : ""
        }; verifying file state on disk before failing.`,
      );
    }
    try {
      await waitForFileToNotContain(rehydratedIndexPath, firstMarker, timeoutMs);
    } catch (error) {
      throw new Error(
        `Expected rehydrate revert to restore files. Response: ${JSON.stringify(revertResult)}`,
        { cause: error },
      );
    }
    logCheckpoint("rehydrate_revert_restored_file", {
      markerRemoved: true,
    });

    const unrevertResult = await secondClient.agent.unrevertSession.mutate({
      projectSlug: PROJECT_SLUG,
      version: PROJECT_VERSION,
      sessionId: firstRun.sessionId,
    });

    assert.equal(unrevertResult?.success, true, "Expected unrevertSession to succeed");
    await waitForFileToContain(rehydratedIndexPath, firstMarker, timeoutMs);
    logCheckpoint("rehydrate_unrevert_restored_change", {
      marker: firstMarker,
    });

    const secondAvailableModels = await secondClient.agent.getAvailableModels.query();
    assertAvailableModel(secondAvailableModels, model);

    const secondRun = await secondClient.agent.runTask.mutate({
      projectSlug: PROJECT_SLUG,
      version: PROJECT_VERSION,
      task: `In index.html, add this exact HTML comment as the first line: <!-- ${secondMarker} -->. Do not use terminal commands.`,
      model: {
        provider: model.provider,
        modelId: model.modelId,
      },
    });

    assert.equal(secondRun?.success, true, "Expected second runTask to succeed");
    assert.ok(
      typeof secondRun?.sessionId === "string" && secondRun.sessionId.length > 0,
      "Expected second runTask to return a sessionId",
    );

    await waitForSessionIdle(secondClient, secondRun.sessionId, timeoutMs);
    await waitForFileToContain(rehydratedIndexPath, secondMarker, timeoutMs);

    const secondSessionSummary = await waitForUserMessageWithDiffs(
      secondClient,
      secondRun.sessionId,
      timeoutMs,
    );
    assert.ok(
      secondSessionSummary.diffs.some((diff) => diff.file.includes("index.html")),
      "Expected post-hydrate tracked diff summary to include index.html",
    );
    logCheckpoint("post_hydrate_tracking_ok", {
      sessionId: secondRun.sessionId,
      diffFiles: secondSessionSummary.diffs.length,
    });

    secondStudioLogs = getContainerLogs(secondStudioContainerId);
    assertNoBrokenSnapshotLogs(secondStudioLogs);

    succeeded = true;
    log("Studio image revert smoke completed successfully");
  } finally {
    if (!succeeded) {
      const secondLogs =
        secondStudioLogs ||
        (secondStudioContainerId ? getContainerLogs(secondStudioContainerId) : "");
      if (secondLogs) {
        log("Second Studio container logs:");
        process.stdout.write(`${secondLogs}\n`);
      }

      const firstLogs =
        firstStudioLogs ||
        (firstStudioContainerId ? getContainerLogs(firstStudioContainerId) : "");
      if (firstLogs) {
        log("First Studio container logs:");
        process.stdout.write(`${firstLogs}\n`);
      }

      if (minioContainerId) {
        const logs = getContainerLogs(minioContainerId);
        if (logs) {
          log("MinIO container logs:");
          process.stdout.write(`${logs}\n`);
        }
      }
    }

    if (secondStudioContainerId) {
      await removeContainer(secondStudioContainerId);
    }
    if (firstStudioContainerId) {
      await removeContainer(firstStudioContainerId);
    }
    if (minioContainerId) {
      await removeContainer(minioContainerId);
    }

    runDocker(["network", "rm", networkName], { allowFailure: true });

    try {
      await deletePrefix(s3, bucket, sourcePrefix);
      await deletePrefix(s3, bucket, opencodePrefix);
    } catch {
      // Best-effort cleanup only.
    }

    cleanupWorkspaceDir(image, workspaceDir);
    cleanupWorkspaceDir(image, rehydratedWorkspaceDir);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[studio-image-revert-smoke] ${message}`);
  process.exit(1);
});
