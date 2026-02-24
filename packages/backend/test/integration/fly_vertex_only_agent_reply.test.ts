/**
 * Fly Vertex-only agent reply integration test
 *
 * Flow:
 * - create/start a Fly studio machine
 * - pass only Vertex auth credentials/config (no OpenRouter key, no Google API key)
 * - run a simple agent task
 * - verify an assistant reply is produced
 *
 * Run with:
 *   npm run test:integration -w @vivd/backend -- test/integration/fly_vertex_only_agent_reply.test.ts
 *
 * Requires:
 *   VIVD_RUN_FLY_VERTEX_ONLY_AGENT_REPLY_TESTS=1 (or VIVD_RUN_OPENCODE_REHYDRATE_REVERT_TESTS=1)
 *   FLY_API_TOKEN
 *   FLY_STUDIO_APP
 *   GOOGLE_CLOUD_PROJECT
 *   one of: GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_APPLICATION_CREDENTIALS_JSON, VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH
 *   a Google model via OPENCODE_MODEL or OPENCODE_MODELS
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { FlyStudioMachineProvider } from "../../src/services/studioMachines/fly/provider";

const RUN_TESTS =
  process.env.VIVD_RUN_FLY_VERTEX_ONLY_AGENT_REPLY_TESTS === "1" ||
  process.env.VIVD_RUN_OPENCODE_REHYDRATE_REVERT_TESTS === "1";
const FLY_API_TOKEN = (process.env.FLY_API_TOKEN || "").trim();
const FLY_STUDIO_APP = (process.env.FLY_STUDIO_APP || "").trim();

type ModelSelection = {
  provider: string;
  modelId: string;
};

function parseModelSelection(value: string | undefined | null): ModelSelection | null {
  if (!value) return null;
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= value.length - 1) return null;
  return {
    provider: value.slice(0, slashIndex),
    modelId: value.slice(slashIndex + 1),
  };
}

function isVertexModelProvider(provider: string): boolean {
  return provider.trim().toLowerCase().startsWith("google");
}

function resolveVertexModelSelectionFromEnv(): ModelSelection | null {
  const direct = parseModelSelection((process.env.OPENCODE_MODEL || "").trim());
  if (direct && isVertexModelProvider(direct.provider)) {
    return direct;
  }

  const rawModels = (process.env.OPENCODE_MODELS || "").trim();
  if (!rawModels) return null;

  for (const entry of rawModels.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(":");
    const modelSpec = colonIndex >= 0 ? trimmed.slice(colonIndex + 1) : trimmed;
    const parsed = parseModelSelection(modelSpec.trim());
    if (!parsed) continue;
    if (isVertexModelProvider(parsed.provider)) {
      return parsed;
    }
  }
  return null;
}

function hasVertexCredentialsConfigured(): boolean {
  return (
    Boolean((process.env.GOOGLE_CLOUD_PROJECT || "").trim()) &&
    Boolean(
      (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim() ||
        (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim() ||
        (process.env.VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH || "").trim(),
    )
  );
}

const VERTEX_MODEL_SELECTION = resolveVertexModelSelectionFromEnv();

const SHOULD_RUN =
  RUN_TESTS &&
  FLY_API_TOKEN.length > 0 &&
  FLY_STUDIO_APP.length > 0 &&
  hasVertexCredentialsConfigured() &&
  VERTEX_MODEL_SELECTION !== null;

function createStudioTrpcClient(options: { baseUrl: string; accessToken?: string }) {
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

function unwrapTrpcResult<T>(value: unknown): T {
  if (value && typeof value === "object" && "json" in (value as any)) {
    return (value as any).json as T;
  }
  return value as T;
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

function extractAssistantText(message: any): string {
  if (!message || typeof message !== "object") return "";
  const parts = Array.isArray((message as any).parts) ? (message as any).parts : [];
  return parts
    .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
    .map((part: any) => part.text)
    .join("")
    .trim();
}

function buildVertexOnlyMachineEnv(model: ModelSelection): Record<string, string> {
  const env: Record<string, string> = {
    OPENROUTER_API_KEY: "",
    GOOGLE_API_KEY: "",
    OPENCODE_MODELS: "",
    OPENCODE_MODEL: `${model.provider}/${model.modelId}`,

    // Explicitly blank storage creds/config so this test isolates agent auth.
    R2_ENDPOINT: "",
    R2_BUCKET: "",
    R2_ACCESS_KEY: "",
    R2_SECRET_KEY: "",
    VIVD_S3_BUCKET: "",
    VIVD_S3_ENDPOINT_URL: "",
    VIVD_S3_SOURCE_URI: "",
    VIVD_S3_OPENCODE_URI: "",
    VIVD_S3_OPENCODE_STORAGE_URI: "",
    VIVD_S3_PREFIX: "",
    VIVD_S3_OPENCODE_PREFIX: "",
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    AWS_SESSION_TOKEN: "",
    AWS_DEFAULT_REGION: "",
    AWS_REGION: "",
  };

  const vertexKeys = [
    "GOOGLE_CLOUD_PROJECT",
    "VERTEX_LOCATION",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH",
  ] as const;

  for (const key of vertexKeys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      env[key] = value.trim();
    }
  }

  if (!env.VERTEX_LOCATION) {
    env.VERTEX_LOCATION = "global";
  }

  return env;
}

function createProviderWithoutBackgroundRefresh(): FlyStudioMachineProvider {
  const originalToken = process.env.FLY_API_TOKEN;
  const originalApp = process.env.FLY_STUDIO_APP;

  delete process.env.FLY_API_TOKEN;
  delete process.env.FLY_STUDIO_APP;
  const provider = new FlyStudioMachineProvider();

  if (typeof originalToken === "string") {
    process.env.FLY_API_TOKEN = originalToken;
  } else {
    delete process.env.FLY_API_TOKEN;
  }

  if (typeof originalApp === "string") {
    process.env.FLY_STUDIO_APP = originalApp;
  } else {
    delete process.env.FLY_STUDIO_APP;
  }

  return provider;
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

describe.sequential("Fly Vertex-only agent reply", () => {
  it.skipIf(!SHOULD_RUN)(
    "returns an assistant reply when only vertex auth is passed to studio machine",
    { timeout: 420_000 },
    async () => {
      if (!VERTEX_MODEL_SELECTION) {
        throw new Error("Missing vertex model selection");
      }

      const provider = createProviderWithoutBackgroundRefresh();
      const runId = `${Date.now().toString(36)}-${crypto
        .randomBytes(4)
        .toString("hex")}`;
      const organizationId = "integration";
      const projectSlug = `studio-vertex-only-reply-${runId}`;
      const version = 1;
      const marker = `vertex-only-reply-${runId}`;
      const machineEnv = buildVertexOnlyMachineEnv(VERTEX_MODEL_SELECTION);

      let machineId: string | null = null;
      try {
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

        const envProbe = await executeMachineCommand({
          machineId,
          timeoutSeconds: 60,
          command: [
            "/bin/sh",
            "-lc",
            [
              "set -eu",
              "if [ -n \"${OPENROUTER_API_KEY:-}\" ]; then echo 'openrouter=set'; else echo 'openrouter=empty'; fi",
              "if [ -n \"${GOOGLE_API_KEY:-}\" ]; then echo 'google_api=set'; else echo 'google_api=empty'; fi",
              "if [ -n \"${GOOGLE_CLOUD_PROJECT:-}\" ]; then echo 'google_project=set'; else echo 'google_project=empty'; fi",
              "echo \"home=${HOME:-}\"",
              "echo \"adc_json_len=${#GOOGLE_APPLICATION_CREDENTIALS_JSON}\"",
              "adc_file_state='missing'",
              "for adc_path in \"${GOOGLE_APPLICATION_CREDENTIALS:-}\" \"${VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH:-}\" \"${HOME:-/root}/.config/gcloud/application_default_credentials.json\" \"/root/.config/gcloud/application_default_credentials.json\"; do",
              "  if [ -z \"${adc_path}\" ]; then continue; fi",
              "  if [ -f \"${adc_path}\" ]; then",
              "    echo \"adc_path=${adc_path}:present\"",
              "    adc_file_state='present'",
              "  else",
              "    echo \"adc_path=${adc_path}:missing\"",
              "  fi",
              "done",
              "echo \"adc_file=${adc_file_state}\"",
            ].join("\n"),
          ],
        });
        expect(envProbe.stdout).toContain("openrouter=empty");
        expect(envProbe.stdout).toContain("google_api=empty");
        expect(envProbe.stdout).toContain("google_project=set");
        expect(envProbe.stdout).toContain("adc_file=present");

        const flyMachine = await (provider as any).getMachine(machineId);
        const runtimeEnv = (flyMachine?.config?.env || {}) as Record<string, string>;
        expect(runtimeEnv.OPENROUTER_API_KEY || "").toBe("");
        expect(runtimeEnv.GOOGLE_API_KEY || "").toBe("");
        expect((runtimeEnv.GOOGLE_CLOUD_PROJECT || "").trim().length).toBeGreaterThan(0);
        expect((runtimeEnv.OPENCODE_MODEL || "").trim()).toBe(
          `${VERTEX_MODEL_SELECTION.provider}/${VERTEX_MODEL_SELECTION.modelId}`,
        );

        const client = createStudioTrpcClient({
          baseUrl: start.url,
          accessToken: start.accessToken,
        });

        const runTaskRaw = await client.agent.runTask.mutate({
          projectSlug,
          version,
          task: `Reply with a short sentence that includes this token: ${marker}`,
          model: VERTEX_MODEL_SELECTION,
        });
        const runTask = unwrapTrpcResult<{ success: boolean; sessionId: string }>(runTaskRaw);
        expect(runTask.success).toBe(true);
        expect(typeof runTask.sessionId).toBe("string");

        await waitForSessionIdle({
          client,
          projectSlug,
          version,
          sessionId: runTask.sessionId,
          timeoutMs: 300_000,
        });

        const sessionContentRaw = await client.agent.getSessionContent.query({
          sessionId: runTask.sessionId,
          projectSlug,
          version,
        });
        const sessionContent = unwrapTrpcResult<any[]>(sessionContentRaw);
        const assistantMessage = [...sessionContent]
          .reverse()
          .find((m) => m?.info?.role === "assistant");

        if (!assistantMessage) {
          const roles = sessionContent
            .map((m) => (typeof m?.info?.role === "string" ? m.info.role : "unknown"))
            .join(",");
          const statusesRaw = await client.agent.getSessionsStatus.query({
            projectSlug,
            version,
          });
          const statuses = unwrapTrpcResult<Record<string, { type?: string }>>(statusesRaw);
          const sessionStatus = statuses?.[runTask.sessionId]?.type ?? "missing";
          throw new Error(
            `No assistant reply (status=${sessionStatus}, roles=${roles || "none"}, messages=${sessionContent.length})`,
          );
        }
        const assistantText = extractAssistantText(assistantMessage);
        expect(assistantText.length).toBeGreaterThan(0);
        expect(assistantText).toContain(marker);
      } finally {
        if (machineId) {
          try {
            await provider.destroyStudioMachine(machineId);
          } catch {
            // best-effort cleanup
          }
        }
      }
    },
  );

  it.skipIf(SHOULD_RUN)(
    "documents skip reason when vertex-only integration env is missing",
    () => {
      const reasons: string[] = [];
      if (!RUN_TESTS) {
        reasons.push(
          "set VIVD_RUN_FLY_VERTEX_ONLY_AGENT_REPLY_TESTS=1 (or VIVD_RUN_OPENCODE_REHYDRATE_REVERT_TESTS=1)",
        );
      }
      if (!FLY_API_TOKEN) {
        reasons.push("missing FLY_API_TOKEN");
      }
      if (!FLY_STUDIO_APP) {
        reasons.push("missing FLY_STUDIO_APP");
      }
      if (!hasVertexCredentialsConfigured()) {
        reasons.push("missing Vertex credentials/config");
      }
      if (!VERTEX_MODEL_SELECTION) {
        reasons.push("missing OPENCODE_MODEL/OPENCODE_MODELS google model");
      }
      expect(reasons.length).toBeGreaterThan(0);
    },
  );
});
