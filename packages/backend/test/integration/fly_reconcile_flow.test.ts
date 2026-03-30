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
 *   VIVD_FLY_RECONCILE_WAKE_EXPECT_MAX_MS=5000
 */
import { describe, it, expect } from "vitest";
import { FlyStudioMachineProvider } from "../../src/services/studioMachines/fly/provider";
import type { FlyMachine } from "../../src/services/studioMachines/fly/types";

const RUN_TESTS = process.env.VIVD_RUN_FLY_RECONCILE_FLOW_TESTS === "1";
const FLY_API_TOKEN = (process.env.FLY_API_TOKEN || "").trim();
const FLY_STUDIO_APP = (process.env.FLY_STUDIO_APP || "").trim();
const TEST_IMAGE = (process.env.VIVD_FLY_TEST_IMAGE || "").trim();
const TEST_IMAGE_TAG = (process.env.VIVD_FLY_TEST_IMAGE_TAG || "").trim();
const TEST_DRIFT_IMAGE = (process.env.VIVD_FLY_TEST_DRIFT_IMAGE || "").trim();
const SHOULD_RUN = RUN_TESTS && FLY_API_TOKEN.length > 0 && FLY_STUDIO_APP.length > 0;

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

describe("Fly warm reconciliation flow", () => {
  it.skipIf(!SHOULD_RUN)(
    "updates a drifted machine, leaves it suspended, and wakes it quickly",
    { timeout: 420_000 },
    async () => {
      const provider = new FlyStudioMachineProvider();
      const originalConfiguredImage = process.env.FLY_STUDIO_IMAGE;
      const requestedImage = await resolveRequestedImage(provider);

      const organizationId = "integration";
      const projectSlug = `reconcile-e2e-${Date.now().toString(36)}`;
      const version = 1;

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
        const driftImage =
          TEST_DRIFT_IMAGE || `${imageBaseWithoutTag(desiredImage)}:latest`;
        process.env.FLY_STUDIO_IMAGE = driftImage;

        await provider.ensureRunning({
          organizationId,
          projectSlug,
          version,
          env: {},
        });

        const summaries = await provider.listStudioMachines();
        const summary = summaries.find(
          (m) =>
            m.organizationId === organizationId &&
            m.projectSlug === projectSlug &&
            m.version === version,
        );
        expect(summary).toBeDefined();
        machineId = summary!.id;

        // Suspend the machine first (matches production warm reconciliation path).
        await provider.stop(organizationId, projectSlug, version);
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
          await provider.warmReconcileStudioMachine(machineId);

        const after = await getMachine(provider, machineId);
        expect(after.state).toBe("suspended");

        const configuredImage = stripDigest(
          typeof after.config?.image === "string" ? after.config.image : null,
        );
        expect(configuredImage).toBe(stripDigest(reconciledDesiredImage));

        const vivdImage = (after.config?.metadata as any)?.vivd_image ?? null;
        expect(vivdImage).toBe(reconciledDesiredImage);

        const wakeStartedAt = Date.now();
        const wake = await provider.ensureRunning({
          organizationId,
          projectSlug,
          version,
          env: {},
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
