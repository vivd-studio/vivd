/**
 * Fly Reconciliation Integration Test
 *
 * This test makes real Fly Machines API calls to verify the warm reconciliation flow:
 * - Create/start a studio machine
 * - Suspend it
 * - Introduce image drift
 * - Run reconciliation
 * - Verify the machine is warmed and ends up suspended again with updated image config
 *
 * Signal note:
 * - This is a strict warm-reconcile regression smoke, not the primary
 *   prod-likeness release signal.
 * - It still starts from a freshly created drift machine and asks that machine
 *   to park before the real warm-reconcile phase, so it can fail even while
 *   production mostly parks existing machines successfully.
 * - Use `fly_prod_shape_reconcile_wake_auth.test.ts` for the more realistic
 *   release signal.
 *
 * Run with:
 *   npm run test:integration -w @vivd/backend -- test/integration/fly_reconcile_flow.test.ts
 *
 * Requires:
 *   VIVD_RUN_FLY_RECONCILE_FLOW_TESTS=1
 *   FLY_API_TOKEN, FLY_STUDIO_APP
 *
 * Optional:
 *   VIVD_FLY_TEST_IMAGE=ghcr.io/vivd-studio/vivd-studio:dev-...
 *   VIVD_FLY_TEST_IMAGE_TAG=dev-...
 *   VIVD_FLY_TEST_DRIFT_IMAGE=ghcr.io/vivd-studio/vivd-studio:1.1.27
 *   VIVD_FLY_RECONCILE_WAKE_EXPECT_MAX_MS=6000
 *
 * Note:
 *   If your local env pins FLY_STUDIO_IMAGE to an older dev tag, pass
 *   VIVD_FLY_TEST_IMAGE or VIVD_FLY_TEST_IMAGE_TAG explicitly so this
 *   smoke validates the current Studio image instead of that stale pin.
 */
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import {
  getMachineDriftLabels,
  getStudioAccessTokenFromMachine,
  hasMachineDrift,
  resolveStudioIdFromMachine,
} from "../../src/services/studioMachines/fly/machineModel";
import { FlyStudioMachineProvider } from "../../src/services/studioMachines/fly/provider";
import { buildStudioEnvDriftSubsetFromDesiredEnv } from "../../src/services/studioMachines/fly/runtimeWorkflow";
import { resolveStableStudioMachineEnv } from "../../src/services/studioMachines/stableRuntimeEnv";
import type { FlyMachine } from "../../src/services/studioMachines/fly/types";
import {
  cleanupStaleFlyTestMachines,
  runWithFlyCapacityContext,
} from "./flyTestMachineCleanup";

const STUDIO_AUTH_HEADER = "x-vivd-studio-token";
const RUN_TESTS = process.env.VIVD_RUN_FLY_RECONCILE_FLOW_TESTS === "1";
const FLY_API_TOKEN = (process.env.FLY_API_TOKEN || "").trim();
const FLY_STUDIO_APP = (process.env.FLY_STUDIO_APP || "").trim();
const TEST_IMAGE = (process.env.VIVD_FLY_TEST_IMAGE || "").trim();
const TEST_IMAGE_TAG = (process.env.VIVD_FLY_TEST_IMAGE_TAG || "").trim();
const TEST_DRIFT_IMAGE = (process.env.VIVD_FLY_TEST_DRIFT_IMAGE || "").trim();
const SHOULD_RUN = RUN_TESTS && FLY_API_TOKEN.length > 0 && FLY_STUDIO_APP.length > 0;

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

const MAX_WAKE_MS = parseOptionalPositiveIntEnv(
  "VIVD_FLY_RECONCILE_WAKE_EXPECT_MAX_MS",
);
const POST_START_PARK_DRAIN_MS =
  parseOptionalPositiveIntEnv("VIVD_FLY_RECONCILE_PARK_DRAIN_MS") ?? 8_000;

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

function imageManifestExists(image: string): boolean {
  const result = spawnSync("docker", ["manifest", "inspect", image], {
    stdio: "ignore",
  });
  return result.status === 0;
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

async function waitForState(
  provider: FlyStudioMachineProvider,
  machineId: string,
  state: string,
  timeoutMs: number,
): Promise<void> {
  await (provider as any).waitForState({ machineId, state, timeoutMs });
}

async function getMachine(
  provider: FlyStudioMachineProvider,
  machineId: string,
): Promise<FlyMachine> {
  return (provider as any).getMachine(machineId) as Promise<FlyMachine>;
}

async function notifyPreviewLeave(options: {
  baseUrl: string;
  accessToken: string;
}): Promise<void> {
  const response = await fetch(`${options.baseUrl}/vivd-studio/api/cleanup/preview-leave`, {
    method: "POST",
    headers: {
      [STUDIO_AUTH_HEADER]: options.accessToken,
    },
  });

  expect(response.status).toBe(200);
}

describe("Fly warm reconciliation flow", () => {
  it.skipIf(!SHOULD_RUN)(
    "updates a drifted machine, leaves it suspended, and wakes it quickly",
    { timeout: 420_000 },
    async () => {
      const provider = new FlyStudioMachineProvider();
      await cleanupStaleFlyTestMachines({
        provider,
        logPrefix: "[Fly reconcile smoke][stale GC]",
      });
      const originalConfiguredImage = process.env.FLY_STUDIO_IMAGE;
      const requestedImage = await resolveRequestedImage(provider);

      const organizationId = "integration";
      const projectSlug = `reconcile-e2e-${Date.now().toString(36)}`;
      const version = 1;
      // Use the same stable env surface as the real control-plane start flow so the
      // wake assertion does not create synthetic env drift after warm reconcile.
      const startEnv = await resolveStableStudioMachineEnv({
        providerKind: "fly",
        organizationId,
        projectSlug,
      });

      let machineId: string | null = null;

      try {
        if (requestedImage) {
          process.env.FLY_STUDIO_IMAGE = requestedImage;
        } else {
          delete process.env.FLY_STUDIO_IMAGE;
        }
        const desiredImage = (await provider.getDesiredImage({
          forceRefresh: true,
        })) as string;
        let driftImage =
          TEST_DRIFT_IMAGE || `${imageBaseWithoutTag(desiredImage)}:latest`;
        process.env.FLY_STUDIO_IMAGE = driftImage;
        try {
          const coldStart = await runWithFlyCapacityContext({
            context: `starting drift image for ${organizationId}:${projectSlug}/v${version}`,
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
            context: `starting fallback drift image for ${organizationId}:${projectSlug}/v${version}`,
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

        const summaries = await provider.listStudioMachines();
        const summary = summaries.find(
          (m) =>
            m.organizationId === organizationId &&
            m.projectSlug === projectSlug &&
            m.version === version,
        );
        expect(summary).toBeDefined();
        machineId = summary!.id;

        // Let the provider's own readiness traffic drain before parking the
        // just-started drift image; otherwise Fly can reject/ignore suspend
        // even though the same machine parks cleanly once that startup traffic
        // has gone quiet.
        await sleep(POST_START_PARK_DRAIN_MS);

        // Suspend the machine first (matches production warm reconciliation path).
        const parked = await provider.parkStudioMachine(machineId);
        expect(parked).toBe("suspended");
        await waitForState(provider, machineId, "suspended", 90_000);

        const drifted = await getMachine(provider, machineId);
        const driftedConfiguredImage = stripDigest(
          typeof drifted.config?.image === "string" ? drifted.config.image : null,
        );
        expect(driftedConfiguredImage).toBe(stripDigest(driftImage));
        const driftedVivdImage = (drifted.config?.metadata as any)?.vivd_image ?? null;
        expect(driftedVivdImage).toBe(driftImage);

        process.env.FLY_STUDIO_IMAGE = desiredImage;
        const { desiredImage: reconciledDesiredImage } =
          await runWithFlyCapacityContext({
            context: `warm reconciling ${organizationId}:${projectSlug}/v${version}`,
            run: () => provider.warmReconcileStudioMachine(machineId),
          });

        const after = await getMachine(provider, machineId);
        expect(after.state).toBe("suspended");

        const configuredImage = stripDigest(
          typeof after.config?.image === "string" ? after.config.image : null,
        );
        expect(configuredImage).toBe(stripDigest(reconciledDesiredImage));

        const vivdImage = (after.config?.metadata as any)?.vivd_image ?? null;
        expect(vivdImage).toBe(reconciledDesiredImage);

        const reconciledAccessToken = getStudioAccessTokenFromMachine(after);
        expect(reconciledAccessToken).toBeTruthy();
        const reconciledStudioId = resolveStudioIdFromMachine(after);
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
          machine: after,
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
          context: `waking reconciled machine for ${organizationId}:${projectSlug}/v${version}`,
          run: () =>
            provider.ensureRunning({
              organizationId,
              projectSlug,
              version,
              env: startEnv,
            }),
        });
        const wakeReadyMs = Date.now() - wakeStartedAt;

        const afterWake = await getMachine(provider, machineId);
        expect(afterWake.state).toBe("started");
        expect(wake.accessToken).toBeTruthy();

        if (MAX_WAKE_MS !== null) {
          expect(
            wakeReadyMs,
            `Warm reconcile wake exceeded ${formatDuration(
              MAX_WAKE_MS,
            )}; actual=${formatDuration(wakeReadyMs)} machine=${machineId} image=${stripDigest(
              typeof afterWake.config?.image === "string"
                ? afterWake.config.image
                : null,
            )}`,
          ).toBeLessThanOrEqual(MAX_WAKE_MS);
        }
      } finally {
        if (typeof originalConfiguredImage === "string" && originalConfiguredImage.trim()) {
          process.env.FLY_STUDIO_IMAGE = originalConfiguredImage;
        } else {
          delete process.env.FLY_STUDIO_IMAGE;
        }
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
});
