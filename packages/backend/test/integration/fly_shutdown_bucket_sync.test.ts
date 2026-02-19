/**
 * Fly shutdown sync integration test
 *
 * Verifies that source + opencode data written inside a running Fly studio machine
 * is synced to object storage and rehydrated after lifecycle actions:
 * - stop -> start
 * - destroy -> recreate
 * - warm reconcile -> start
 *
 * Run with:
 *   npm run test:integration -w @vivd/backend -- test/integration/fly_shutdown_bucket_sync.test.ts
 *
 * Requires:
 *   VIVD_RUN_STUDIO_BUCKET_SYNC_TESTS=1
 *   FLY_API_TOKEN
 *   FLY_STUDIO_APP
 *   Object storage env vars (R2_* or VIVD_S3_* + AWS_*)
 */
import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { FlyStudioMachineProvider } from "../../src/services/studioMachines/fly/provider";
import type { FlyMachine } from "../../src/services/studioMachines/fly/types";
import {
  createS3Client,
  deleteBucketPrefix,
  getObjectBuffer,
  getObjectStorageConfigFromEnv,
  parseS3Uri,
  type ObjectStorageConfig,
} from "../../src/services/ObjectStorageService";

const RUN_STUDIO_BUCKET_SYNC_TESTS =
  process.env.VIVD_RUN_STUDIO_BUCKET_SYNC_TESTS === "1";
const FLY_API_TOKEN = (process.env.FLY_API_TOKEN || "").trim();
const FLY_STUDIO_APP = (process.env.FLY_STUDIO_APP || "").trim();

function getStorageConfigOrNull():
  | { config: ObjectStorageConfig; reason: null }
  | { config: null; reason: string } {
  try {
    return { config: getObjectStorageConfigFromEnv(), reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { config: null, reason: message };
  }
}

const storage = getStorageConfigOrNull();
const STORAGE_CONFIG = storage.config;
const S3_CLIENT = STORAGE_CONFIG ? createS3Client(STORAGE_CONFIG) : null;

const SHOULD_RUN =
  RUN_STUDIO_BUCKET_SYNC_TESTS &&
  FLY_API_TOKEN.length > 0 &&
  FLY_STUDIO_APP.length > 0 &&
  STORAGE_CONFIG !== null &&
  S3_CLIENT !== null;

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function flyApiFetch<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const url = `https://api.machines.dev/v1/apps/${FLY_STUDIO_APP}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${FLY_API_TOKEN}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[Fly exec] request failed for ${path}: ${message}`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `[Fly exec] ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
    );
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

type FlyExecResponse = {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  exit_signal?: number;
};

async function executeMachineCommand(options: {
  machineId: string;
  command: string[];
  timeoutSeconds?: number;
}): Promise<{ stdout: string; stderr: string }> {
  const result = await flyApiFetch<FlyExecResponse>(
    `/machines/${options.machineId}/exec`,
    {
      method: "POST",
      body: JSON.stringify({
        command: options.command,
        timeout: options.timeoutSeconds ?? 60,
      }),
    },
    ((options.timeoutSeconds ?? 60) + 30) * 1000,
  );

  const exitCode = typeof result.exit_code === "number" ? result.exit_code : 0;
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (exitCode !== 0) {
    throw new Error(
      `Machine command failed (machine=${options.machineId}, code=${exitCode}, signal=${
        result.exit_signal ?? "none"
      }): ${stderr || stdout}`,
    );
  }

  return { stdout, stderr };
}

async function getMachine(
  provider: FlyStudioMachineProvider,
  machineId: string,
): Promise<FlyMachine> {
  return (provider as any).getMachine(machineId) as Promise<FlyMachine>;
}

async function waitForMachineState(options: {
  provider: FlyStudioMachineProvider;
  machineId: string;
  targetStates: string[];
  timeoutMs: number;
}): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    const machine = await getMachine(options.provider, options.machineId);
    const state = machine.state || "unknown";
    if (options.targetStates.includes(state)) {
      return state;
    }
    if (state === "destroyed" || state === "destroying") {
      throw new Error(
        `Machine ${options.machineId} was destroyed while waiting for state=${options.targetStates.join(",")}`,
      );
    }
    await sleep(750);
  }

  throw new Error(
    `Timed out waiting for machine ${options.machineId} to reach one of: ${options.targetStates.join(",")}`,
  );
}

async function findMachineId(options: {
  provider: FlyStudioMachineProvider;
  organizationId: string;
  projectSlug: string;
  version: number;
}): Promise<string> {
  const summaries = await options.provider.listStudioMachines();
  const summary = summaries.find(
    (machine) =>
      machine.organizationId === options.organizationId &&
      machine.projectSlug === options.projectSlug &&
      machine.version === options.version,
  );
  if (!summary) {
    throw new Error(
      `Could not find machine for ${options.organizationId}:${options.projectSlug}/v${options.version}`,
    );
  }
  return summary.id;
}

function buildMachineStorageEnv(options: {
  sourceUri: string;
  opencodeUri: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    VIVD_S3_SOURCE_URI: options.sourceUri,
    VIVD_S3_OPENCODE_URI: options.opencodeUri,
    // Keep periodic sync out of the picture; we want to verify shutdown-driven sync.
    VIVD_S3_SYNC_INTERVAL_SECONDS: "3600",
  };

  const passthroughKeys = [
    "R2_ENDPOINT",
    "R2_BUCKET",
    "R2_ACCESS_KEY",
    "R2_SECRET_KEY",
    "VIVD_S3_BUCKET",
    "VIVD_S3_ENDPOINT_URL",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_DEFAULT_REGION",
    "AWS_REGION",
  ] as const;

  for (const key of passthroughKeys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      env[key] = value.trim();
    }
  }

  return env;
}

async function waitForBucketObjectContent(options: {
  bucket: string;
  key: string;
  expectedContent: string;
  timeoutMs: number;
}): Promise<void> {
  if (!S3_CLIENT) {
    throw new Error("S3 client is not configured");
  }

  const startedAt = Date.now();
  let lastError: string | null = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      const { buffer } = await getObjectBuffer({
        client: S3_CLIENT,
        bucket: options.bucket,
        key: options.key,
      });
      const content = buffer.toString("utf-8");
      if (content === options.expectedContent) {
        return;
      }
      lastError = `unexpected content length=${content.length}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(1000);
  }

  throw new Error(
    `Timed out waiting for s3://${options.bucket}/${options.key} (last error: ${lastError || "unknown"})`,
  );
}

async function cleanupBucketPrefixes(prefixes: string[]): Promise<void> {
  if (!S3_CLIENT || !STORAGE_CONFIG) return;
  for (const prefix of prefixes) {
    await deleteBucketPrefix({
      client: S3_CLIENT,
      bucket: STORAGE_CONFIG.bucket,
      keyPrefix: prefix,
    });
  }
}

type LifecycleScenario = "stop" | "destroy" | "reconcile" | "trigger";

async function runScenario(scenario: LifecycleScenario): Promise<void> {
  if (!S3_CLIENT || !STORAGE_CONFIG) {
    throw new Error("Object storage is not configured");
  }

  const provider = new FlyStudioMachineProvider();
  const runId = `${scenario}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const organizationId = "integration";
  const projectSlug = `studio-shutdown-sync-${runId}`;
  const version = 1;

  const sourceRelativePath = `.vivd/integration/source-${runId}.txt`;
  const opencodeRelativePath = `integration/opencode-${runId}.txt`;
  const sourceMarker = `source-marker-${runId}`;
  const opencodeMarker = `opencode-marker-${runId}`;

  const basePrefix = `integration-tests/studio-shutdown-sync/${runId}`;
  const sourceUri = `s3://${STORAGE_CONFIG.bucket}/${basePrefix}/source`;
  const opencodeUri = `s3://${STORAGE_CONFIG.bucket}/${basePrefix}/opencode`;
  const sourcePrefix = parseS3Uri(sourceUri).keyPrefix;
  const opencodePrefix = parseS3Uri(opencodeUri).keyPrefix;

  const sourceKeyPrefix = trimSlashes(sourcePrefix);
  const opencodeKeyPrefix = trimSlashes(opencodePrefix);
  const sourceKey = sourceKeyPrefix
    ? `${sourceKeyPrefix}/${sourceRelativePath}`
    : sourceRelativePath;
  const opencodeKey = opencodeKeyPrefix
    ? `${opencodeKeyPrefix}/${opencodeRelativePath}`
    : opencodeRelativePath;

  const machineEnv = buildMachineStorageEnv({
    sourceUri,
    opencodeUri,
  });

  const log = (message: string): void => {
    console.log(`[FlySync:${scenario}] ${message}`);
  };

  let machineId: string | null = null;
  try {
    log(`cleaning bucket prefixes (${basePrefix})`);
    await cleanupBucketPrefixes([sourcePrefix, opencodePrefix]);

    log("ensuring machine is running");
    await provider.ensureRunning({
      organizationId,
      projectSlug,
      version,
      env: machineEnv,
    });
    machineId = await findMachineId({
      provider,
      organizationId,
      projectSlug,
      version,
    });
    log(`machine ready (${machineId})`);

    log("writing source + opencode markers inside machine");
    await executeMachineCommand({
      machineId,
      timeoutSeconds: 120,
      command: [
        "/bin/sh",
        "-lc",
        [
          "set -eu",
          `source_path=\"$VIVD_WORKSPACE_DIR/${sourceRelativePath}\"`,
          `opencode_path=\"$VIVD_OPENCODE_DATA_HOME/${opencodeRelativePath}\"`,
          "mkdir -p \"$(dirname \"$source_path\")\"",
          "mkdir -p \"$(dirname \"$opencode_path\")\"",
          `printf '%s' ${shellEscape(sourceMarker)} > \"$source_path\"`,
          `printf '%s' ${shellEscape(opencodeMarker)} > \"$opencode_path\"`,
        ].join("\n"),
      ],
    });
    const preLifecycleSourceRead = await executeMachineCommand({
      machineId,
      timeoutSeconds: 60,
      command: [
        "/bin/sh",
        "-lc",
        `cat \"$VIVD_WORKSPACE_DIR/${sourceRelativePath}\"`,
      ],
    });
    const preLifecycleOpencodeRead = await executeMachineCommand({
      machineId,
      timeoutSeconds: 60,
      command: [
        "/bin/sh",
        "-lc",
        `cat \"$VIVD_OPENCODE_DATA_HOME/${opencodeRelativePath}\"`,
      ],
    });
    expect(preLifecycleSourceRead.stdout).toBe(sourceMarker);
    expect(preLifecycleOpencodeRead.stdout).toBe(opencodeMarker);
    log("marker write verified before lifecycle action");

    if (scenario === "trigger") {
      log("triggering immediate sync request");
      await executeMachineCommand({
        machineId,
        timeoutSeconds: 60,
        command: [
          "/bin/sh",
          "-lc",
          "touch \"${VIVD_SYNC_TRIGGER_FILE:-/tmp/vivd-sync.trigger}\"",
        ],
      });
      log("sync trigger file touched");
    } else if (scenario === "stop") {
      log("triggering stop");
      await provider.stop(organizationId, projectSlug, version);
      await waitForMachineState({
        provider,
        machineId,
        targetStates: ["suspended", "stopped"],
        timeoutMs: 120_000,
      });
      log("machine stopped/suspended");
    } else if (scenario === "destroy") {
      log("triggering destroy");
      await provider.destroyStudioMachine(machineId);
      machineId = null;
      log("machine destroyed");
    } else {
      log("triggering stop before reconcile");
      await provider.stop(organizationId, projectSlug, version);
      await waitForMachineState({
        provider,
        machineId,
        targetStates: ["suspended", "stopped"],
        timeoutMs: 120_000,
      });
      log("injecting image metadata drift");

      const desiredImage = (await (provider as any).getDesiredImage()) as string;
      const machine = await getMachine(provider, machineId);
      const driftedConfig = {
        ...(machine.config || {}),
        metadata: {
          ...(machine.config?.metadata || {}),
          vivd_image: `${desiredImage}-drift`,
        },
      };

      await (provider as any).updateMachineConfig({
        machineId,
        config: driftedConfig,
        skipLaunch: true,
      });

      log("running warm reconcile");
      await provider.warmReconcileStudioMachine(machineId);
      await waitForMachineState({
        provider,
        machineId,
        targetStates: ["suspended", "stopped"],
        timeoutMs: 180_000,
      });
      log("warm reconcile parked machine");
    }

    log("waiting for markers in bucket");
    await waitForBucketObjectContent({
      bucket: STORAGE_CONFIG.bucket,
      key: sourceKey,
      expectedContent: sourceMarker,
      timeoutMs: 120_000,
    });
    await waitForBucketObjectContent({
      bucket: STORAGE_CONFIG.bucket,
      key: opencodeKey,
      expectedContent: opencodeMarker,
      timeoutMs: 120_000,
    });
    log("bucket markers found");

    if (scenario === "trigger") {
      log("trigger-driven sync verified");
      return;
    }

    log("starting machine again for hydration check");
    await provider.ensureRunning({
      organizationId,
      projectSlug,
      version,
      env: machineEnv,
    });
    machineId = await findMachineId({
      provider,
      organizationId,
      projectSlug,
      version,
    });
    log(`machine restarted (${machineId}), verifying hydrated markers`);

    const sourceRead = await executeMachineCommand({
      machineId,
      timeoutSeconds: 60,
      command: [
        "/bin/sh",
        "-lc",
        `cat \"$VIVD_WORKSPACE_DIR/${sourceRelativePath}\"`,
      ],
    });
    const opencodeRead = await executeMachineCommand({
      machineId,
      timeoutSeconds: 60,
      command: [
        "/bin/sh",
        "-lc",
        `cat \"$VIVD_OPENCODE_DATA_HOME/${opencodeRelativePath}\"`,
      ],
    });

    expect(sourceRead.stdout).toBe(sourceMarker);
    expect(opencodeRead.stdout).toBe(opencodeMarker);
    log("hydration verified");
  } finally {
    log("cleanup start");
    if (machineId) {
      try {
        await provider.destroyStudioMachine(machineId);
      } catch {
        // best-effort cleanup
      }
    }
    await cleanupBucketPrefixes([sourcePrefix, opencodePrefix]);
    log("cleanup done");
  }
}

describe.sequential("Fly shutdown sync to bucket", () => {
  it.skipIf(!SHOULD_RUN)(
    "syncs source + opencode data on stop -> restart",
    { timeout: 600_000 },
    async () => {
      await runScenario("stop");
    },
  );

  it.skipIf(!SHOULD_RUN)(
    "syncs source + opencode data on destroy -> recreate",
    { timeout: 600_000 },
    async () => {
      await runScenario("destroy");
    },
  );

  it.skipIf(!SHOULD_RUN)(
    "syncs source + opencode data through warm reconcile restart",
    { timeout: 600_000 },
    async () => {
      await runScenario("reconcile");
    },
  );

  it.skipIf(!SHOULD_RUN)(
    "syncs source + opencode data when sync trigger file is touched",
    { timeout: 600_000 },
    async () => {
      await runScenario("trigger");
    },
  );

  it.skipIf(SHOULD_RUN)(
    "documents skip reason when integration env is missing",
    () => {
      const reasons: string[] = [];
      if (!RUN_STUDIO_BUCKET_SYNC_TESTS) {
        reasons.push("VIVD_RUN_STUDIO_BUCKET_SYNC_TESTS!=1");
      }
      if (!FLY_API_TOKEN) {
        reasons.push("missing FLY_API_TOKEN");
      }
      if (!FLY_STUDIO_APP) {
        reasons.push("missing FLY_STUDIO_APP");
      }
      if (!STORAGE_CONFIG) {
        reasons.push(`object storage unavailable: ${storage.reason}`);
      }
      expect(reasons.length).toBeGreaterThan(0);
    },
  );
});
