/**
 * Fly warm wake + auth integration test
 *
 * Flow:
 * - optionally pin a specific Studio image/tag for this run
 * - create/start a real Fly Studio machine and wait for readiness
 * - verify direct runtime auth and the bootstrap cookie handoff
 * - park the machine and require it to end up suspended
 * - start it again from the suspended state
 * - measure cold-start and wake-to-ready timings
 * - verify auth surfaces again after the wake
 * - print machine-event timing summaries, with optional Fly log capture
 *
 * Run with:
 *   npm run test:integration -w @vivd/backend -- test/integration/fly_warm_wake_auth.test.ts
 *
 * Requires:
 *   VIVD_RUN_FLY_WARM_WAKE_AUTH_TESTS=1
 *   FLY_API_TOKEN
 *   FLY_STUDIO_APP
 *
 * Optional:
 *   VIVD_FLY_TEST_IMAGE=ghcr.io/vivd-studio/vivd-studio:dev-...
 *   VIVD_FLY_TEST_IMAGE_TAG=dev-...
 *   VIVD_FLY_WAKE_EXPECT_MAX_MS=5000
 *   VIVD_FLY_COLD_EXPECT_MAX_MS=45000
 *   VIVD_FLY_WAKE_PRINT_LOGS=1
 *   VIVD_FLY_WAKE_VERIFY_BACKEND_CALLBACKS=1
 *   VIVD_FLY_TEST_ORGANIZATION_ID=<existing org id>
 *   VIVD_FLY_TEST_MAIN_BACKEND_URL=https://vivd.studio/vivd-studio
 */
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createStudioBootstrapToken } from "@vivd/shared/studio";
import { FlyStudioMachineProvider } from "../../src/services/studioMachines/fly/provider";
import type { FlyMachine } from "../../src/services/studioMachines/fly/types";

const RUN_TESTS = process.env.VIVD_RUN_FLY_WARM_WAKE_AUTH_TESTS === "1";
const FLY_API_TOKEN = (process.env.FLY_API_TOKEN || "").trim();
const FLY_STUDIO_APP = (process.env.FLY_STUDIO_APP || "").trim();
const TEST_IMAGE = (process.env.VIVD_FLY_TEST_IMAGE || "").trim();
const TEST_IMAGE_TAG = (process.env.VIVD_FLY_TEST_IMAGE_TAG || "").trim();
const PRINT_LOGS = process.env.VIVD_FLY_WAKE_PRINT_LOGS === "1";
const VERIFY_BACKEND_CALLBACKS =
  process.env.VIVD_FLY_WAKE_VERIFY_BACKEND_CALLBACKS === "1";
const TEST_ORGANIZATION_ID =
  (process.env.VIVD_FLY_TEST_ORGANIZATION_ID || "").trim() || "integration";
const TEST_MAIN_BACKEND_URL =
  (process.env.VIVD_FLY_TEST_MAIN_BACKEND_URL || "").trim();
const SHOULD_RUN =
  RUN_TESTS && FLY_API_TOKEN.length > 0 && FLY_STUDIO_APP.length > 0;

const STUDIO_AUTH_HEADER = "x-vivd-studio-token";
const STUDIO_AUTH_COOKIE = "vivd_studio_token";
const STUDIO_USER_ACTION_TOKEN_COOKIE = "vivd_studio_user_action_token";

type FlyExecResponse = {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  exit_signal?: number;
};

type FlyMachineEvent = {
  id?: string;
  type?: string;
  status?: string;
  source?: string;
  timestamp?: string | number;
  request?: Record<string, unknown>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripDigest(image: string | null): string | null {
  if (!image) return null;
  const idx = image.indexOf("@");
  return idx === -1 ? image : image.slice(0, idx);
}

function imageBaseWithoutTag(image: string): string {
  const noDigest = stripDigest(image) || image;
  const lastSlash = noDigest.lastIndexOf("/");
  const lastColon = noDigest.lastIndexOf(":");
  return lastColon > lastSlash ? noDigest.slice(0, lastColon) : noDigest;
}

function parseOptionalPositiveIntEnv(name: string): number | null {
  const raw = (process.env[name] || "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when set`);
  }
  return parsed;
}

const MAX_WAKE_MS = parseOptionalPositiveIntEnv("VIVD_FLY_WAKE_EXPECT_MAX_MS");
const MAX_COLD_MS = parseOptionalPositiveIntEnv("VIVD_FLY_COLD_EXPECT_MAX_MS");

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

async function getMachineEvents(machineId: string): Promise<FlyMachineEvent[]> {
  try {
    const events = await flyApiFetch<FlyMachineEvent[]>(
      `/machines/${machineId}/events`,
      { method: "GET" },
      30_000,
    );
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

function normalizeEventTimestamp(event: FlyMachineEvent): number | null {
  const raw = event.timestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1_000_000_000_000 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatEvent(event: FlyMachineEvent): string {
  const timestamp = normalizeEventTimestamp(event);
  const iso = timestamp ? new Date(timestamp).toISOString() : "unknown-time";
  const type = event.type || "unknown-type";
  const status = event.status || "unknown-status";
  const source = event.source || "unknown-source";
  return `${iso} ${source} ${type} ${status}`.trim();
}

function summarizeEvents(events: FlyMachineEvent[], limit = 12): string {
  if (events.length === 0) return "none";
  return events
    .slice(-limit)
    .map((event) => `- ${formatEvent(event)}`)
    .join("\n");
}

function readSetCookieHeader(response: Response): string {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    const cookies = headers.getSetCookie();
    if (cookies.length > 0) {
      return cookies.join(", ");
    }
  }
  return response.headers.get("set-cookie") || "";
}

function extractCookie(setCookieHeader: string, cookieName: string): string {
  const match = setCookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
  if (!match?.[1]) {
    throw new Error(`Expected ${cookieName} cookie in bootstrap response`);
  }
  return `${cookieName}=${match[1]}`;
}

async function verifyDirectRuntimeAuth(options: {
  baseUrl: string;
  accessToken: string;
}): Promise<void> {
  const unauthorized = await fetch(`${options.baseUrl}/vivd-studio`, {
    redirect: "manual",
  });
  expect(unauthorized.status).toBe(401);

  const authorized = await fetch(`${options.baseUrl}/vivd-studio`, {
    headers: {
      [STUDIO_AUTH_HEADER]: options.accessToken,
    },
  });
  expect(authorized.status).toBe(200);
  const html = await authorized.text();
  expect(html).toMatch(/<html/i);
}

async function verifyBootstrapAuth(options: {
  baseUrl: string;
  accessToken: string;
  studioId: string;
}): Promise<void> {
  const bootstrapToken = createStudioBootstrapToken({
    accessToken: options.accessToken,
    studioId: options.studioId,
  });

  const response = await fetch(`${options.baseUrl}/vivd-studio/api/bootstrap`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      bootstrapToken,
      next: `${options.baseUrl}/vivd-studio?embedded=1`,
      userActionToken: "smoke-user-action-token",
    }),
  });

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/vivd-studio?embedded=1");

  const setCookieHeader = readSetCookieHeader(response);
  expect(setCookieHeader).toContain(`${STUDIO_AUTH_COOKIE}=`);
  expect(setCookieHeader).toContain(`${STUDIO_USER_ACTION_TOKEN_COOKIE}=`);

  const followUp = await fetch(`${options.baseUrl}/vivd-studio?embedded=1`, {
    headers: {
      Cookie: [
        extractCookie(setCookieHeader, STUDIO_AUTH_COOKIE),
        extractCookie(setCookieHeader, STUDIO_USER_ACTION_TOKEN_COOKIE),
      ].join("; "),
    },
  });

  expect(followUp.status).toBe(200);
}

async function verifyConnectedBackendCallbacks(machineId: string): Promise<void> {
  const script = `
const backendUrl = (process.env.MAIN_BACKEND_URL || "").trim();
const studioId = (process.env.STUDIO_ID || "").trim();
const accessToken = (process.env.STUDIO_ACCESS_TOKEN || "").trim();
const organizationId = (process.env.VIVD_TENANT_ID || "").trim();
const projectSlug = (process.env.VIVD_PROJECT_SLUG || "").trim();
const version = Number.parseInt((process.env.VIVD_PROJECT_VERSION || "").trim(), 10);

if (!backendUrl || !studioId || !accessToken || !organizationId || !projectSlug || !Number.isFinite(version)) {
  throw new Error("missing connected-mode env");
}

const statusUrl = new URL("/api/trpc/studioApi.getStatus", backendUrl);
statusUrl.searchParams.set("input", JSON.stringify({ studioId }));

const headers = {
  "x-vivd-studio-token": accessToken,
  "x-vivd-studio-id": studioId,
  "x-vivd-organization-id": organizationId,
  "content-type": "application/json",
};

const statusResponse = await fetch(statusUrl, { headers });
const statusText = await statusResponse.text();
if (!statusResponse.ok) {
  throw new Error(\`getStatus \${statusResponse.status}: \${statusText}\`);
}

const workspaceResponse = await fetch(new URL("/api/trpc/studioApi.reportWorkspaceState", backendUrl), {
  method: "POST",
  headers,
  body: JSON.stringify({
    studioId,
    slug: projectSlug,
    version,
    hasUnsavedChanges: false,
    headCommitHash: null,
    workingCommitHash: null,
  }),
});
const workspaceText = await workspaceResponse.text();
if (!workspaceResponse.ok) {
  throw new Error(\`reportWorkspaceState \${workspaceResponse.status}: \${workspaceText}\`);
}

console.log(JSON.stringify({
  getStatus: statusText,
  reportWorkspaceState: workspaceText,
}));
`.trim();

  const result = await executeMachineCommand({
    machineId,
    timeoutSeconds: 30,
    command: ["/usr/bin/env", "node", "--input-type=module", "--eval", script],
  });
  expect(result.stdout.trim()).toContain("getStatus");
  expect(result.stdout.trim()).toContain("reportWorkspaceState");
}

function tryReadFlyLogs(machineId: string): string | null {
  for (const command of ["flyctl", "fly"]) {
    const result = spawnSync(
      command,
      [
        "logs",
        "-a",
        FLY_STUDIO_APP,
        "--machine",
        machineId,
        "--no-tail",
        "--access-token",
        FLY_API_TOKEN,
      ],
      {
        encoding: "utf8",
      },
    );

    if (result.error) {
      continue;
    }

    if (result.status === 0) {
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      return output || null;
    }
  }

  return null;
}

async function bestEffortReadStartupProbe(machineId: string): Promise<string | null> {
  try {
    const result = await executeMachineCommand({
      machineId,
      timeoutSeconds: 20,
      command: [
        "/bin/sh",
        "-lc",
        [
          "set -eu",
          "printf 'pwd=%s\\n' \"$PWD\"",
          "printf 'workspace=%s\\n' \"${VIVD_WORKSPACE_DIR:-}\"",
          "printf 'listening='",
          "(command -v ss >/dev/null 2>&1 && ss -ltnp) || (command -v netstat >/dev/null 2>&1 && netstat -ltn) || true",
        ].join("\n"),
      ],
    });
    return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  } catch {
    return null;
  }
}

async function resolveRequestedImage(
  provider: FlyStudioMachineProvider,
): Promise<string | null> {
  if (TEST_IMAGE) return TEST_IMAGE;
  if (!TEST_IMAGE_TAG) return null;

  const originalConfiguredImage = process.env.FLY_STUDIO_IMAGE;
  try {
    delete process.env.FLY_STUDIO_IMAGE;
    const desiredImage = await provider.getDesiredImage({ forceRefresh: true });
    return `${imageBaseWithoutTag(desiredImage)}:${TEST_IMAGE_TAG}`;
  } finally {
    if (typeof originalConfiguredImage === "string") {
      process.env.FLY_STUDIO_IMAGE = originalConfiguredImage;
    } else {
      delete process.env.FLY_STUDIO_IMAGE;
    }
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function assertDurationWithin(options: {
  phase: string;
  actualMs: number;
  maxMs: number | null;
  diagnostics: string;
}): void {
  if (options.maxMs === null) return;
  if (options.actualMs <= options.maxMs) return;

  throw new Error(
    `${options.phase} exceeded expectation: ${formatDuration(options.actualMs)} > ${formatDuration(
      options.maxMs,
    )}\n${options.diagnostics}`,
  );
}

describe.sequential("Fly warm wake + auth", () => {
  it.skipIf(!SHOULD_RUN)(
    "boots, suspends, wakes, and verifies runtime auth on the warmed machine",
    { timeout: 900_000 },
    async () => {
      const provider = new FlyStudioMachineProvider();
      const requestedImage = await resolveRequestedImage(provider);
      const originalConfiguredImage = process.env.FLY_STUDIO_IMAGE;

      const runId = `${Date.now().toString(36)}-${crypto
        .randomBytes(4)
        .toString("hex")}`;
      const organizationId = TEST_ORGANIZATION_ID;
      const projectSlug = `warm-wake-${runId}`;
      const version = 1;
      const startEnv =
        VERIFY_BACKEND_CALLBACKS && TEST_MAIN_BACKEND_URL
          ? {
              MAIN_BACKEND_URL: TEST_MAIN_BACKEND_URL,
            }
          : {};

      let machineId: string | null = null;
      let latestEvents: FlyMachineEvent[] = [];

      try {
        if (requestedImage) {
          process.env.FLY_STUDIO_IMAGE = requestedImage;
        }

        const coldStartedAt = Date.now();
        const coldStart = await provider.ensureRunning({
          organizationId,
          projectSlug,
          version,
          env: startEnv,
        });
        const coldReadyMs = Date.now() - coldStartedAt;

        machineId = await findMachineId({
          provider,
          organizationId,
          projectSlug,
          version,
        });

        const machineAfterColdStart = await getMachine(provider, machineId);
        latestEvents = await getMachineEvents(machineId);
        const coldProbe = await bestEffortReadStartupProbe(machineId);

        if (requestedImage) {
          const configuredImage = stripDigest(
            typeof machineAfterColdStart.config?.image === "string"
              ? machineAfterColdStart.config.image
              : null,
          );
          expect(configuredImage).toBe(stripDigest(requestedImage));
        }

        expect(coldStart.accessToken).toBeTruthy();
        await verifyDirectRuntimeAuth({
          baseUrl: coldStart.url,
          accessToken: coldStart.accessToken!,
        });
        await verifyBootstrapAuth({
          baseUrl: coldStart.url,
          accessToken: coldStart.accessToken!,
          studioId: coldStart.studioId,
        });
        if (VERIFY_BACKEND_CALLBACKS) {
          if (!process.env.VIVD_FLY_TEST_ORGANIZATION_ID?.trim()) {
            throw new Error(
              "VIVD_FLY_TEST_ORGANIZATION_ID is required when VIVD_FLY_WAKE_VERIFY_BACKEND_CALLBACKS=1",
            );
          }
          if (!TEST_MAIN_BACKEND_URL) {
            throw new Error(
              "VIVD_FLY_TEST_MAIN_BACKEND_URL is required when VIVD_FLY_WAKE_VERIFY_BACKEND_CALLBACKS=1",
            );
          }
          await verifyConnectedBackendCallbacks(machineId);
        }

        const parked = await provider.parkStudioMachine(machineId);
        expect(parked).toBe("suspended");

        const machineAfterPark = await getMachine(provider, machineId);
        expect(machineAfterPark.state).toBe("suspended");

        const wakeStartedAt = Date.now();
        const woke = await provider.ensureRunning({
          organizationId,
          projectSlug,
          version,
          env: startEnv,
        });
        const wakeReadyMs = Date.now() - wakeStartedAt;

        const wokeMachineId = await findMachineId({
          provider,
          organizationId,
          projectSlug,
          version,
        });
        expect(wokeMachineId).toBe(machineId);

        const machineAfterWake = await getMachine(provider, machineId);
        latestEvents = await getMachineEvents(machineId);

        expect(machineAfterWake.state).toBe("started");
        expect(woke.accessToken).toBeTruthy();

        await verifyDirectRuntimeAuth({
          baseUrl: woke.url,
          accessToken: woke.accessToken!,
        });
        await verifyBootstrapAuth({
          baseUrl: woke.url,
          accessToken: woke.accessToken!,
          studioId: woke.studioId,
        });
        if (VERIFY_BACKEND_CALLBACKS) {
          await verifyConnectedBackendCallbacks(machineId);
        }

        const summaryLines = [
          `[Fly warm wake smoke] image=${stripDigest(
            typeof machineAfterWake.config?.image === "string"
              ? machineAfterWake.config.image
              : null,
          )}`,
          `[Fly warm wake smoke] coldReady=${formatDuration(coldReadyMs)} wakeReady=${formatDuration(
            wakeReadyMs,
          )} stateAfterPark=${machineAfterPark.state}`,
          `[Fly warm wake smoke] machine=${machineId} coldUrl=${coldStart.url} wakeUrl=${woke.url}`,
          `[Fly warm wake smoke] events:\n${summarizeEvents(latestEvents)}`,
        ];
        if (coldProbe) {
          summaryLines.push(`[Fly warm wake smoke] probe:\n${coldProbe}`);
        }
        console.log(summaryLines.join("\n"));

        if (PRINT_LOGS) {
          const logs = tryReadFlyLogs(machineId);
          if (logs) {
            console.log(`[Fly warm wake smoke] fly logs:\n${logs}`);
          }
        }

        const diagnostics = [
          `machine=${machineId}`,
          `image=${stripDigest(
            typeof machineAfterWake.config?.image === "string"
              ? machineAfterWake.config.image
              : null,
          )}`,
          `coldReady=${formatDuration(coldReadyMs)}`,
          `wakeReady=${formatDuration(wakeReadyMs)}`,
          `events:\n${summarizeEvents(latestEvents)}`,
        ];
        const logs = tryReadFlyLogs(machineId);
        if (logs) {
          diagnostics.push(`fly logs:\n${logs}`);
        }

        assertDurationWithin({
          phase: "cold start",
          actualMs: coldReadyMs,
          maxMs: MAX_COLD_MS,
          diagnostics: diagnostics.join("\n"),
        });
        assertDurationWithin({
          phase: "warm wake",
          actualMs: wakeReadyMs,
          maxMs: MAX_WAKE_MS,
          diagnostics: diagnostics.join("\n"),
        });
      } finally {
        if (typeof originalConfiguredImage === "string" && originalConfiguredImage.trim()) {
          process.env.FLY_STUDIO_IMAGE = originalConfiguredImage;
        } else {
          delete process.env.FLY_STUDIO_IMAGE;
        }

        if (machineId) {
          try {
            await provider.destroyStudioMachine(machineId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(
              `[Fly warm wake smoke] best-effort cleanup failed for ${machineId}: ${message}`,
            );
            if (latestEvents.length > 0) {
              console.warn(
                `[Fly warm wake smoke] latest events before cleanup failure:\n${summarizeEvents(
                  latestEvents,
                )}`,
              );
            }
          }
        }
      }
    },
  );

  it.skipIf(SHOULD_RUN)("documents skip reason when integration env is missing", () => {
    const reasons: string[] = [];
    if (!RUN_TESTS) {
      reasons.push("VIVD_RUN_FLY_WARM_WAKE_AUTH_TESTS!=1");
    }
    if (!FLY_API_TOKEN) {
      reasons.push("missing FLY_API_TOKEN");
    }
    if (!FLY_STUDIO_APP) {
      reasons.push("missing FLY_STUDIO_APP");
    }
    expect(reasons.length).toBeGreaterThan(0);
  });
});
