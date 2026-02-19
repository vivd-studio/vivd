/**
 * Fly OpenCode rehydrate + revert integration test
 *
 * Flow:
 * - create machine
 * - run agent prompt that edits index.html
 * - wait for machine sync trigger to flush to bucket
 * - destroy machine
 * - recreate machine
 * - verify edit is still present after hydrate
 * - revert the original message
 * - verify edit is removed (file still exists)
 *
 * Run with:
 *   npm run test:integration -w @vivd/backend -- test/integration/fly_opencode_rehydrate_revert.test.ts
 *
 * Requires:
 *   VIVD_RUN_OPENCODE_REHYDRATE_REVERT_TESTS=1
 *   FLY_API_TOKEN
 *   FLY_STUDIO_APP
 *   Object storage env vars (R2_* or VIVD_S3_* + AWS_*)
 *   OpenCode model credentials/config in runtime env
 */
import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
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

const RUN_TESTS =
  process.env.VIVD_RUN_OPENCODE_REHYDRATE_REVERT_TESTS === "1";
const FLY_API_TOKEN = (process.env.FLY_API_TOKEN || "").trim();
const FLY_STUDIO_APP = (process.env.FLY_STUDIO_APP || "").trim();

function hasModelCredentialsConfigured(): boolean {
  const hasOpenRouter = Boolean((process.env.OPENROUTER_API_KEY || "").trim());
  const hasGoogleApi = Boolean((process.env.GOOGLE_API_KEY || "").trim());
  const hasVertex =
    Boolean((process.env.GOOGLE_CLOUD_PROJECT || "").trim()) &&
    Boolean(
      (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim() ||
        (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim() ||
        (process.env.VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH || "").trim(),
    );
  return hasOpenRouter || hasGoogleApi || hasVertex;
}

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
  RUN_TESTS &&
  FLY_API_TOKEN.length > 0 &&
  FLY_STUDIO_APP.length > 0 &&
  STORAGE_CONFIG !== null &&
  S3_CLIENT !== null &&
  hasModelCredentialsConfigured();

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
    // Keep periodic sync out; trigger/shutdown paths should be sufficient.
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
    "OPENROUTER_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_CLOUD_PROJECT",
    "VERTEX_LOCATION",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH",
    "OPENCODE_MODEL",
    "OPENCODE_MODELS",
  ] as const;

  for (const key of passthroughKeys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      env[key] = value.trim();
    }
  }

  return env;
}

function unwrapTrpcResult<T>(value: unknown): T {
  if (value && typeof value === "object" && "json" in (value as any)) {
    return (value as any).json as T;
  }
  return value as T;
}

function createStudioTrpcClient(options: {
  baseUrl: string;
  accessToken?: string;
}) {
  const url = new URL("/trpc", options.baseUrl).toString();
  const accessToken = options.accessToken?.trim();

  return createTRPCProxyClient<any>({
    links: [
      httpBatchLink({
        url,
        fetch(input, init) {
          const headers = new Headers(init?.headers);
          if (accessToken) {
            headers.set("x-vivd-studio-token", accessToken);
          }
          return fetch(input, { ...init, headers });
        },
      }),
    ],
  });
}

async function waitForSessionIdle(options: {
  client: any;
  projectSlug: string;
  version: number;
  sessionId: string;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    const raw = await options.client.agent.getSessionsStatus.query({
      projectSlug: options.projectSlug,
      version: options.version,
    });
    const statuses = unwrapTrpcResult<Record<string, { type?: string }>>(raw);
    if (statuses?.[options.sessionId]?.type === "idle") {
      return;
    }
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for session ${options.sessionId} to become idle`);
}

async function waitForBucketObjectToContain(options: {
  bucket: string;
  key: string;
  expectedSubstring: string;
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
      if (content.includes(options.expectedSubstring)) {
        return;
      }
      lastError = "marker not present in object content yet";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for s3://${options.bucket}/${options.key} to contain marker (last error: ${lastError || "unknown"})`,
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

describe.sequential("Fly OpenCode rehydrate + revert", () => {
  it.skipIf(!SHOULD_RUN)(
    "persists agent edit across rehydrate and reverts it afterwards",
    { timeout: 900_000 },
    async () => {
      if (!S3_CLIENT || !STORAGE_CONFIG) {
        throw new Error("Object storage is not configured");
      }

      const provider = new FlyStudioMachineProvider();
      const runId = `${Date.now().toString(36)}-${crypto
        .randomBytes(4)
        .toString("hex")}`;
      const organizationId = "integration";
      const projectSlug = `studio-opencode-rehydrate-${runId}`;
      const version = 1;
      const marker = `fly-rehydrate-marker-${runId}`;

      const basePrefix = `integration-tests/opencode-rehydrate-revert/${runId}`;
      const sourceUri = `s3://${STORAGE_CONFIG.bucket}/${basePrefix}/source`;
      const opencodeUri = `s3://${STORAGE_CONFIG.bucket}/${basePrefix}/opencode`;
      const sourcePrefix = parseS3Uri(sourceUri).keyPrefix;
      const opencodePrefix = parseS3Uri(opencodeUri).keyPrefix;
      const sourceKeyPrefix = trimSlashes(sourcePrefix);
      const indexKey = sourceKeyPrefix ? `${sourceKeyPrefix}/index.html` : "index.html";

      const machineEnv = buildMachineStorageEnv({ sourceUri, opencodeUri });

      let machineId: string | null = null;
      try {
        await cleanupBucketPrefixes([sourcePrefix, opencodePrefix]);

        const start = await provider.ensureRunning({
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

        const client = createStudioTrpcClient({
          baseUrl: start.url,
          accessToken: start.accessToken,
        });

        const initialRead = await executeMachineCommand({
          machineId,
          timeoutSeconds: 60,
          command: ["/bin/sh", "-lc", "cat \"$VIVD_WORKSPACE_DIR/index.html\""],
        });
        expect(initialRead.stdout.length).toBeGreaterThan(0);

        const runTaskRaw = await client.agent.runTask.mutate({
          projectSlug,
          version,
          task: `In index.html, add this exact HTML comment as the first line: <!-- ${marker} -->. Do not use terminal commands.`,
        });
        const runTask = unwrapTrpcResult<{ success: boolean; sessionId: string }>(runTaskRaw);
        expect(runTask.success).toBe(true);
        expect(typeof runTask.sessionId).toBe("string");

        await waitForSessionIdle({
          client,
          projectSlug,
          version,
          sessionId: runTask.sessionId,
          timeoutMs: 420_000,
        });

        const afterEditRead = await executeMachineCommand({
          machineId,
          timeoutSeconds: 60,
          command: ["/bin/sh", "-lc", "cat \"$VIVD_WORKSPACE_DIR/index.html\""],
        });
        expect(afterEditRead.stdout).toContain(marker);

        await waitForBucketObjectToContain({
          bucket: STORAGE_CONFIG.bucket,
          key: indexKey,
          expectedSubstring: marker,
          timeoutMs: 180_000,
        });

        const sessionContentRaw = await client.agent.getSessionContent.query({
          sessionId: runTask.sessionId,
          projectSlug,
          version,
        });
        const sessionContent = unwrapTrpcResult<any[]>(sessionContentRaw);
        const userMessage = [...sessionContent]
          .reverse()
          .find((m) => m?.info?.role === "user");
        const userMessageId =
          typeof userMessage?.info?.id === "string" ? userMessage.info.id : null;
        expect(userMessageId).toBeTruthy();

        await provider.destroyStudioMachine(machineId);
        machineId = null;

        const restart = await provider.ensureRunning({
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

        const clientAfterHydrate = createStudioTrpcClient({
          baseUrl: restart.url,
          accessToken: restart.accessToken,
        });

        const afterHydrateRead = await executeMachineCommand({
          machineId,
          timeoutSeconds: 60,
          command: ["/bin/sh", "-lc", "cat \"$VIVD_WORKSPACE_DIR/index.html\""],
        });
        expect(afterHydrateRead.stdout).toContain(marker);

        const revertRaw = await clientAfterHydrate.agent.revertToMessage.mutate({
          sessionId: runTask.sessionId,
          messageId: userMessageId,
          projectSlug,
          version,
        });
        const revert = unwrapTrpcResult<{ success: boolean }>(revertRaw);
        expect(revert.success).toBe(true);

        const afterRevertRead = await executeMachineCommand({
          machineId,
          timeoutSeconds: 60,
          command: ["/bin/sh", "-lc", "cat \"$VIVD_WORKSPACE_DIR/index.html\""],
        });
        expect(afterRevertRead.stdout).not.toContain(marker);
      } finally {
        if (machineId) {
          try {
            await provider.destroyStudioMachine(machineId);
          } catch {
            // best-effort cleanup
          }
        }
        await cleanupBucketPrefixes([sourcePrefix, opencodePrefix]);
      }
    },
  );

  it.skipIf(SHOULD_RUN)(
    "documents skip reason when integration env is missing",
    () => {
      const reasons: string[] = [];
      if (!RUN_TESTS) {
        reasons.push("VIVD_RUN_OPENCODE_REHYDRATE_REVERT_TESTS!=1");
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
      if (!hasModelCredentialsConfigured()) {
        reasons.push("missing OpenCode model credentials/config");
      }
      expect(reasons.length).toBeGreaterThan(0);
    },
  );
});
