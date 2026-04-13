/**
 * Fly production-shaped reconcile + wake + auth integration test
 *
 * Flow:
 * - boot a real Fly Studio machine on a drift image
 * - stop that drifted machine so the next phase starts from a non-running machine
 * - warm reconcile the stopped machine to the candidate image and require `suspended`
 * - wake the same machine again and verify runtime auth + bootstrap auth
 *
 * This is intentionally closer to the production rollout story than the older
 * fresh-machine smokes: production typically reconciles existing non-running
 * machines instead of asking a just-created machine to suspend immediately after
 * its own startup/bootstrap traffic.
 *
 * Run with:
 *   npm run test:integration -w @vivd/backend -- test/integration/fly_prod_shape_reconcile_wake_auth.test.ts
 *
 * Requires:
 *   VIVD_RUN_FLY_PROD_SHAPE_SMOKE_TESTS=1
 *   FLY_API_TOKEN
 *   FLY_STUDIO_APP
 *
 * Optional:
 *   VIVD_FLY_TEST_IMAGE=ghcr.io/vivd-studio/vivd-studio:dev-...
 *   VIVD_FLY_TEST_IMAGE_TAG=dev-...
 *   VIVD_FLY_TEST_DRIFT_IMAGE=ghcr.io/vivd-studio/vivd-studio:v1.1.51-repro.2
 *   VIVD_FLY_PROD_SHAPE_WAKE_EXPECT_MAX_MS=6000
 *   VIVD_FLY_PROD_SHAPE_STOP_DRAIN_MS=3000
 *   VIVD_FLY_KEEP_MACHINE=1
 */
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import type { IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import { createStudioBootstrapToken } from "@vivd/shared/studio";
import {
  getMachineDriftLabels,
  getStudioAccessTokenFromMachine,
  hasMachineDrift,
  resolveStudioIdFromMachine,
} from "../../src/services/studioMachines/fly/machineModel";
import { FlyStudioMachineProvider } from "../../src/services/studioMachines/fly/provider";
import { requestRuntime } from "../../src/services/studioMachines/fly/runtimeHttp";
import type {
  FlyMachine,
  FlyMachineService,
  FlyStudioMachineSummary,
} from "../../src/services/studioMachines/fly/types";
import { buildStudioEnvDriftSubsetFromDesiredEnv } from "../../src/services/studioMachines/fly/runtimeWorkflow";
import { resolveStableStudioMachineEnv } from "../../src/services/studioMachines/stableRuntimeEnv";
import {
  cleanupStaleFlyTestMachines,
  runWithFlyCapacityContext,
} from "./flyTestMachineCleanup";

const RUN_TESTS = process.env.VIVD_RUN_FLY_PROD_SHAPE_SMOKE_TESTS === "1";
const FLY_API_TOKEN = (process.env.FLY_API_TOKEN || "").trim();
const FLY_STUDIO_APP = (process.env.FLY_STUDIO_APP || "").trim();
const TEST_IMAGE = (process.env.VIVD_FLY_TEST_IMAGE || "").trim();
const TEST_IMAGE_TAG = (process.env.VIVD_FLY_TEST_IMAGE_TAG || "").trim();
const TEST_DRIFT_IMAGE = (process.env.VIVD_FLY_TEST_DRIFT_IMAGE || "").trim();
const KEEP_MACHINE = process.env.VIVD_FLY_KEEP_MACHINE === "1";
const SHOULD_RUN =
  RUN_TESTS && FLY_API_TOKEN.length > 0 && FLY_STUDIO_APP.length > 0;

const STUDIO_AUTH_HEADER = "x-vivd-studio-token";
const STUDIO_AUTH_COOKIE = "vivd_studio_token";
const STUDIO_USER_ACTION_TOKEN_COOKIE = "vivd_studio_user_action_token";
const MAX_WAKE_MS =
  parseOptionalPositiveIntEnv("VIVD_FLY_PROD_SHAPE_WAKE_EXPECT_MAX_MS") ??
  parseOptionalPositiveIntEnv("VIVD_FLY_WAKE_EXPECT_MAX_MS");
const POST_START_STOP_DRAIN_MS =
  parseOptionalPositiveIntEnv("VIVD_FLY_PROD_SHAPE_STOP_DRAIN_MS") ?? 3_000;

type FlyMachineEvent = {
  id?: string;
  type?: string;
  status?: string;
  source?: string;
  timestamp?: string | number;
};

type ReconcileFailureDiagnostics = {
  machineId: string;
  organizationId: string;
  projectSlug: string;
  version: number;
  driftImage: string;
  desiredImage: string;
  reconcileDurationMs: number;
  error: unknown;
  provider: FlyStudioMachineProvider;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getHeaderValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | null {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : null;
}

function readSetCookieHeader(headers: IncomingHttpHeaders): string {
  const value = headers["set-cookie"];
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}

function extractCookie(setCookieHeader: string, cookieName: string): string {
  const match = setCookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
  if (!match?.[1]) {
    throw new Error(`Expected ${cookieName} cookie in bootstrap response`);
  }
  return `${cookieName}=${match[1]}`;
}

function imageManifestExists(image: string): boolean {
  const result = spawnSync("docker", ["manifest", "inspect", image], {
    stdio: "ignore",
  });
  return result.status === 0;
}

type ParsedSemverImage = {
  repository: string;
  prefix: string;
  major: number;
  minor: number;
  patch: number;
};

function parseSemverImage(image: string): ParsedSemverImage | null {
  const normalized = stripDigest(image) || image;
  const lastSlash = normalized.lastIndexOf("/");
  const lastColon = normalized.lastIndexOf(":");
  if (lastColon <= lastSlash) return null;
  const repository = normalized.slice(0, lastColon);
  const tag = normalized.slice(lastColon + 1);
  const match = tag.match(/^(v?)(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    repository,
    prefix: match[1] || "",
    major: Number.parseInt(match[2] || "0", 10),
    minor: Number.parseInt(match[3] || "0", 10),
    patch: Number.parseInt(match[4] || "0", 10),
  };
}

function resolvePreviousExistingSemverImage(image: string): string | null {
  const parsed = parseSemverImage(image);
  if (!parsed) return null;

  for (let patch = parsed.patch - 1; patch >= 0; patch -= 1) {
    const candidate = `${parsed.repository}:${parsed.prefix}${parsed.major}.${parsed.minor}.${patch}`;
    if (imageManifestExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isManifestUnknownError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to get manifest") &&
    normalized.includes("manifest unknown")
  );
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

async function resolveFallbackDriftImage(
  provider: FlyStudioMachineProvider,
  requestedDriftImage: string,
  desiredImage: string,
): Promise<string | null> {
  const semverFallback = resolvePreviousExistingSemverImage(requestedDriftImage);
  if (semverFallback && semverFallback !== stripDigest(desiredImage)) {
    return semverFallback;
  }

  const desiredSemver = parseSemverImage(desiredImage);
  const summaries = await provider.listStudioMachines();
  for (const summary of summaries) {
    const state = (summary.state || "").toLowerCase();
    if (state === "destroyed" || state === "destroying") continue;
    const image = stripDigest(summary.image);
    if (!image || image === stripDigest(desiredImage)) continue;
    const candidateSemver = parseSemverImage(image);
    if (candidateSemver) {
      if (candidateSemver.major < 1) continue;
      if (
        desiredSemver &&
        (candidateSemver.major !== desiredSemver.major ||
          candidateSemver.minor !== desiredSemver.minor)
      ) {
        continue;
      }
    }
    return image;
  }
  return null;
}

async function getMachine(
  provider: FlyStudioMachineProvider,
  machineId: string,
): Promise<FlyMachine> {
  return (provider as any).getMachine(machineId) as Promise<FlyMachine>;
}

async function waitForState(
  provider: FlyStudioMachineProvider,
  machineId: string,
  state: string,
  timeoutMs: number,
): Promise<void> {
  await (provider as any).waitForState({ machineId, state, timeoutMs });
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

async function stopMachine(
  provider: FlyStudioMachineProvider,
  machineId: string,
): Promise<void> {
  await ((provider as any).apiClient.stopMachine(machineId) as Promise<void>);
  await waitForState(provider, machineId, "stopped", 60_000);
}

async function getMachineEvents(machineId: string): Promise<FlyMachineEvent[]> {
  try {
    const response = await fetch(
      `https://api.machines.dev/v1/apps/${FLY_STUDIO_APP}/machines/${machineId}/events`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${FLY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) return [];
    const events = (await response.json()) as FlyMachineEvent[];
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
  return `${iso} ${event.source || "unknown-source"} ${event.type || "unknown-type"} ${
    event.status || "unknown-status"
  }`;
}

function summarizeEvents(events: FlyMachineEvent[], limit = 12): string {
  if (events.length === 0) return "none";
  return events
    .slice(-limit)
    .map((event) => `- ${formatEvent(event)}`)
    .join("\n");
}

function summarizeServices(
  services: FlyMachineService[] | undefined,
): Array<Record<string, unknown>> {
  return (services || []).map((service) => ({
    protocol: service.protocol ?? null,
    internal_port: service.internal_port ?? null,
    autostop: service.autostop ?? null,
    autostart: service.autostart ?? null,
    min_machines_running: service.min_machines_running ?? null,
    ports: (service.ports || []).map((port) => ({
      port: port.port ?? null,
      handlers: port.handlers ?? null,
    })),
  }));
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatMachineSnapshot(machine: FlyMachine | null): string {
  if (!machine) return "none";
  const metadata = (machine.config?.metadata || machine.metadata || {}) as Record<
    string,
    string | undefined
  >;

  return formatJson({
    id: machine.id,
    name: machine.name ?? null,
    state: machine.state ?? null,
    region: machine.region ?? null,
    instanceId: machine.instance_id ?? null,
    createdAt: machine.created_at ?? null,
    updatedAt: machine.updated_at ?? null,
    image: stripDigest(
      typeof machine.config?.image === "string" ? machine.config.image : null,
    ),
    guest: machine.config?.guest ?? null,
    services: summarizeServices(machine.config?.services),
    metadata: {
      vivd_image: metadata.vivd_image ?? null,
      vivd_external_port: metadata.vivd_external_port ?? null,
      vivd_organization_id: metadata.vivd_organization_id ?? null,
      vivd_project_slug: metadata.vivd_project_slug ?? null,
      vivd_project_version: metadata.vivd_project_version ?? null,
      vivd_studio_id: metadata.vivd_studio_id ?? null,
    },
  });
}

function formatMachineSummary(summary: FlyStudioMachineSummary | null): string {
  if (!summary) return "none";
  return formatJson({
    id: summary.id,
    state: summary.state ?? null,
    region: summary.region ?? null,
    cpuKind: summary.cpuKind ?? null,
    cpus: summary.cpus ?? null,
    memoryMb: summary.memoryMb ?? null,
    image: summary.image ?? null,
    desiredImage: summary.desiredImage ?? null,
    externalPort: summary.externalPort ?? null,
    routePath: summary.routePath ?? null,
    url: summary.url ?? null,
    runtimeUrl: summary.runtimeUrl ?? null,
    compatibilityUrl: summary.compatibilityUrl ?? null,
    createdAt: summary.createdAt ?? null,
    updatedAt: summary.updatedAt ?? null,
  });
}

function tailLines(text: string, maxLines = 200): string {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(-maxLines).join("\n");
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

    if (result.error) continue;
    if (result.status !== 0) continue;

    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    return output ? tailLines(output) : null;
  }

  return null;
}

async function findMachineSummary(options: {
  provider: FlyStudioMachineProvider;
  organizationId: string;
  projectSlug: string;
  version: number;
}): Promise<FlyStudioMachineSummary | null> {
  const summaries = await options.provider.listStudioMachines();
  return (
    summaries.find(
      (machine) =>
        machine.organizationId === options.organizationId &&
        machine.projectSlug === options.projectSlug &&
        machine.version === options.version,
    ) || null
  );
}

async function bestEffortGetMachine(options: {
  provider: FlyStudioMachineProvider;
  machineId: string;
}): Promise<FlyMachine | null> {
  try {
    return await getMachine(options.provider, options.machineId);
  } catch {
    return null;
  }
}

async function bestEffortFindMachineSummary(options: {
  provider: FlyStudioMachineProvider;
  organizationId: string;
  projectSlug: string;
  version: number;
}): Promise<FlyStudioMachineSummary | null> {
  try {
    return await findMachineSummary(options);
  } catch {
    return null;
  }
}

async function bestEffortReadCleanupStatus(options: {
  baseUrl: string;
  accessToken: string;
}): Promise<string> {
  try {
    const response = await requestRuntime({
      url: `${options.baseUrl}/vivd-studio/api/cleanup/status`,
      method: "GET",
      headers: {
        [STUDIO_AUTH_HEADER]: options.accessToken,
        Accept: "application/json",
      },
      timeoutMs: 5_000,
    });

    let body: unknown = response.body;
    try {
      body = JSON.parse(response.body || "{}");
    } catch {
      body = response.body || "";
    }

    return formatJson({
      status: response.status,
      body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `error: ${message}`;
  }
}

async function collectReconcileFailureDiagnostics(
  options: ReconcileFailureDiagnostics,
): Promise<string> {
  const machine = await bestEffortGetMachine({
    provider: options.provider,
    machineId: options.machineId,
  });
  const summary = await bestEffortFindMachineSummary({
    provider: options.provider,
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    version: options.version,
  });
  const events = await getMachineEvents(options.machineId);
  const accessToken = machine ? getStudioAccessTokenFromMachine(machine) : null;
  const baseUrl =
    summary?.runtimeUrl || summary?.compatibilityUrl || summary?.url || null;
  const cleanupStatus =
    accessToken && baseUrl
      ? await bestEffortReadCleanupStatus({ baseUrl, accessToken })
      : "skipped (missing runtime URL or access token)";
  const logs = tryReadFlyLogs(options.machineId);
  const message =
    options.error instanceof Error ? options.error.message : String(options.error);

  return [
    `machine=${options.machineId}`,
    `project=${options.organizationId}:${options.projectSlug}/v${options.version}`,
    `driftImage=${stripDigest(options.driftImage)}`,
    `desiredImage=${stripDigest(options.desiredImage)}`,
    `reconcileDuration=${formatDuration(options.reconcileDurationMs)}`,
    `originalError=${message}`,
    `machine snapshot:\n${formatMachineSnapshot(machine)}`,
    `machine summary:\n${formatMachineSummary(summary)}`,
    `cleanup status:\n${cleanupStatus}`,
    `events:\n${summarizeEvents(events, 20)}`,
    logs ? `fly logs:\n${logs}` : "fly logs:\nnone",
  ].join("\n\n");
}

async function notifyPreviewLeave(options: {
  baseUrl: string;
  accessToken: string;
}): Promise<void> {
  const response = await requestRuntime({
    url: `${options.baseUrl}/vivd-studio/api/cleanup/preview-leave`,
    method: "POST",
    headers: {
      [STUDIO_AUTH_HEADER]: options.accessToken,
    },
  });

  expect(response.status).toBe(200);
}

async function verifyDirectRuntimeAuth(options: {
  baseUrl: string;
  accessToken: string;
}): Promise<void> {
  const unauthorized = await requestRuntime({
    url: `${options.baseUrl}/vivd-studio`,
  });
  expect(unauthorized.status).toBe(401);

  const authorized = await requestRuntime({
    url: `${options.baseUrl}/vivd-studio`,
    headers: {
      [STUDIO_AUTH_HEADER]: options.accessToken,
    },
  });
  expect(authorized.status).toBe(200);
  expect(authorized.body).toMatch(/<html/i);
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

  const response = await requestRuntime({
    url: `${options.baseUrl}/vivd-studio/api/bootstrap`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      bootstrapToken,
      next: `${options.baseUrl}/vivd-studio?embedded=1`,
      userActionToken: "prod-shape-smoke-user-action-token",
    }),
  });

  expect(response.status).toBe(303);
  expect(getHeaderValue(response.headers, "location")).toBe(
    "/vivd-studio?embedded=1",
  );

  const setCookieHeader = readSetCookieHeader(response.headers);
  expect(setCookieHeader).toContain(`${STUDIO_AUTH_COOKIE}=`);
  expect(setCookieHeader).toContain(`${STUDIO_USER_ACTION_TOKEN_COOKIE}=`);

  const followUp = await requestRuntime({
    url: `${options.baseUrl}/vivd-studio?embedded=1`,
    headers: {
      Cookie: [
        extractCookie(setCookieHeader, STUDIO_AUTH_COOKIE),
        extractCookie(setCookieHeader, STUDIO_USER_ACTION_TOKEN_COOKIE),
      ].join("; "),
    },
  });

  expect(followUp.status).toBe(200);
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

describe("Fly production-shaped reconcile + wake + auth", () => {
  it.skipIf(!SHOULD_RUN)(
    "warm reconciles a stopped drifted machine, re-parks it suspended, and wakes with working auth",
    { timeout: 600_000 },
    async () => {
      const provider = new FlyStudioMachineProvider();
      await cleanupStaleFlyTestMachines({
        provider,
        logPrefix: "[Fly prod-shape smoke][stale GC]",
      });
      const originalConfiguredImage = process.env.FLY_STUDIO_IMAGE;
      const requestedImage = await resolveRequestedImage(provider);

      const organizationId = "integration";
      const projectSlug = `prod-shape-${Date.now().toString(36)}-${crypto
        .randomBytes(2)
        .toString("hex")}`;
      const version = 1;
      const startEnv = await resolveStableStudioMachineEnv({
        providerKind: "fly",
        organizationId,
        projectSlug,
      });

      let machineId: string | null = null;
      let latestEvents: FlyMachineEvent[] = [];

      try {
        if (requestedImage) {
          process.env.FLY_STUDIO_IMAGE = requestedImage;
        } else {
          delete process.env.FLY_STUDIO_IMAGE;
        }
        const desiredImage = await provider.getDesiredImage({
          forceRefresh: true,
        });

        let driftImage =
          TEST_DRIFT_IMAGE || `${imageBaseWithoutTag(desiredImage)}:latest`;
        process.env.FLY_STUDIO_IMAGE = driftImage;

        try {
          const coldStart = await runWithFlyCapacityContext({
            context: `starting prod-shape drift image for ${organizationId}:${projectSlug}/v${version}`,
            run: () =>
              provider.ensureRunning({
                organizationId,
                projectSlug,
                version,
                env: startEnv,
              }),
          });
          await notifyPreviewLeave({
            baseUrl: coldStart.url,
            accessToken: coldStart.accessToken!,
          });
        } catch (error) {
          if (!isManifestUnknownError(error)) {
            throw error;
          }
          const fallbackDriftImage = await resolveFallbackDriftImage(
            provider,
            driftImage,
            desiredImage,
          );
          if (!fallbackDriftImage) {
            throw error;
          }
          driftImage = fallbackDriftImage;
          process.env.FLY_STUDIO_IMAGE = driftImage;
          const coldStart = await runWithFlyCapacityContext({
            context: `starting fallback prod-shape drift image for ${organizationId}:${projectSlug}/v${version}`,
            run: () =>
              provider.ensureRunning({
                organizationId,
                projectSlug,
                version,
                env: startEnv,
              }),
          });
          await notifyPreviewLeave({
            baseUrl: coldStart.url,
            accessToken: coldStart.accessToken!,
          });
        }

        machineId = await findMachineId({
          provider,
          organizationId,
          projectSlug,
          version,
        });

        if (POST_START_STOP_DRAIN_MS > 0) {
          await sleep(POST_START_STOP_DRAIN_MS);
        }

        await stopMachine(provider, machineId);

        const driftedStopped = await getMachine(provider, machineId);
        const driftedConfiguredImage = stripDigest(
          typeof driftedStopped.config?.image === "string"
            ? driftedStopped.config.image
            : null,
        );
        expect(driftedStopped.state).toBe("stopped");
        expect(driftedConfiguredImage).toBe(stripDigest(driftImage));

        process.env.FLY_STUDIO_IMAGE = desiredImage;
        const reconcileStartedAt = Date.now();
        let reconciledDesiredImage: string;
        try {
          const reconcileResult = await runWithFlyCapacityContext({
            context: `warm reconciling stopped prod-shape machine ${organizationId}:${projectSlug}/v${version}`,
            run: () => provider.warmReconcileStudioMachine(machineId),
          });
          reconciledDesiredImage = reconcileResult.desiredImage;
        } catch (error) {
          const reconcileDurationMs = Date.now() - reconcileStartedAt;
          const diagnostics = await collectReconcileFailureDiagnostics({
            machineId,
            organizationId,
            projectSlug,
            version,
            driftImage,
            desiredImage,
            reconcileDurationMs,
            error,
            provider,
          });
          throw new Error(
            `[Fly prod-shape smoke] warm reconcile failed\n\n${diagnostics}`,
          );
        }
        const reconcileDurationMs = Date.now() - reconcileStartedAt;

        const afterReconcile = await getMachine(provider, machineId);
        latestEvents = await getMachineEvents(machineId);

        if (afterReconcile.state !== "suspended") {
          const diagnostics = await collectReconcileFailureDiagnostics({
            machineId,
            organizationId,
            projectSlug,
            version,
            driftImage,
            desiredImage: reconciledDesiredImage,
            reconcileDurationMs,
            error: new Error(
              `Expected reconciled machine to be suspended after warm reconcile, got ${afterReconcile.state || "unknown"}`,
            ),
            provider,
          });
          throw new Error(
            `[Fly prod-shape smoke] reconciled machine did not end suspended\n\n${diagnostics}`,
          );
        }

        const configuredImage = stripDigest(
          typeof afterReconcile.config?.image === "string"
            ? afterReconcile.config.image
            : null,
        );
        expect(configuredImage).toBe(stripDigest(reconciledDesiredImage));

        const vivdImage = (afterReconcile.config?.metadata as any)?.vivd_image ?? null;
        expect(vivdImage).toBe(reconciledDesiredImage);

        const reconciledAccessToken = getStudioAccessTokenFromMachine(afterReconcile);
        expect(reconciledAccessToken).toBeTruthy();
        const reconciledStudioId = resolveStudioIdFromMachine(afterReconcile);
        const envForDrift = (provider as any).buildStudioEnv({
          organizationId,
          projectSlug,
          version,
          env: startEnv,
          studioId: reconciledStudioId,
          accessToken: reconciledAccessToken!,
        }) as Record<string, string>;
        const desiredEnvSubset = buildStudioEnvDriftSubsetFromDesiredEnv(
          envForDrift,
          Object.keys(startEnv),
        );
        const postReconcileState = (provider as any).resolveMachineReconcileState({
          machine: afterReconcile,
          desiredImage: reconciledDesiredImage,
          preferredAccessToken: reconciledAccessToken,
          desiredEnvSubset,
        }) as { accessToken: string; needs: Record<string, boolean> };
        expect(
          hasMachineDrift(postReconcileState.needs as any),
          `Warm reconcile left machine drift before wake: ${getMachineDriftLabels(
            postReconcileState.needs as any,
          ).join(",") || "<none>"}`,
        ).toBe(false);

        const wakeStartedAt = Date.now();
        const wake = await runWithFlyCapacityContext({
          context: `waking reconciled prod-shape machine ${organizationId}:${projectSlug}/v${version}`,
          run: () =>
            provider.ensureRunning({
              organizationId,
              projectSlug,
              version,
              env: startEnv,
            }),
        });
        const wakeReadyMs = Date.now() - wakeStartedAt;

        const wokeMachineId = await findMachineId({
          provider,
          organizationId,
          projectSlug,
          version,
        });
        expect(wokeMachineId).toBe(machineId);

        const afterWake = await getMachine(provider, machineId);
        latestEvents = await getMachineEvents(machineId);

        expect(afterWake.state).toBe("started");
        expect(wake.accessToken).toBeTruthy();

        await verifyDirectRuntimeAuth({
          baseUrl: wake.url,
          accessToken: wake.accessToken!,
        });
        await verifyBootstrapAuth({
          baseUrl: wake.url,
          accessToken: wake.accessToken!,
          studioId: wake.studioId,
        });

        const diagnostics = [
          `machine=${machineId}`,
          `driftImage=${stripDigest(driftImage)}`,
          `candidateImage=${stripDigest(
            typeof afterWake.config?.image === "string" ? afterWake.config.image : null,
          )}`,
          `reconcileDuration=${formatDuration(reconcileDurationMs)}`,
          `wakeReady=${formatDuration(wakeReadyMs)}`,
          `events:\n${summarizeEvents(latestEvents)}`,
        ];
        console.log(
          [
            `[Fly prod-shape smoke] machine=${machineId}`,
            `[Fly prod-shape smoke] driftImage=${stripDigest(driftImage)} candidateImage=${stripDigest(
              typeof afterWake.config?.image === "string" ? afterWake.config.image : null,
            )}`,
            `[Fly prod-shape smoke] reconcileDuration=${formatDuration(
              reconcileDurationMs,
            )} wakeReady=${formatDuration(wakeReadyMs)}`,
            `[Fly prod-shape smoke] events:\n${summarizeEvents(latestEvents)}`,
          ].join("\n"),
        );

        assertDurationWithin({
          phase: "prod-shape warm wake",
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

        if (machineId && KEEP_MACHINE) {
          console.warn(`[Fly prod-shape smoke] keeping machine for debugging: ${machineId}`);
        } else if (machineId) {
          try {
            await provider.destroyStudioMachine(machineId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(
              `[Fly prod-shape smoke] best-effort cleanup failed for ${machineId}: ${message}`,
            );
            if (latestEvents.length > 0) {
              console.warn(
                `[Fly prod-shape smoke] latest events before cleanup failure:\n${summarizeEvents(
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
    if (!RUN_TESTS) reasons.push("VIVD_RUN_FLY_PROD_SHAPE_SMOKE_TESTS!=1");
    if (!FLY_API_TOKEN) reasons.push("missing FLY_API_TOKEN");
    if (!FLY_STUDIO_APP) reasons.push("missing FLY_STUDIO_APP");
    expect(reasons.length).toBeGreaterThan(0);
  });
});
