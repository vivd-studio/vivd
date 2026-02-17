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
 *   VIVD_RUN_INTEGRATION_TESTS=1
 *   FLY_API_TOKEN, FLY_STUDIO_APP
 */
import { describe, it, expect } from "vitest";
import { FlyStudioMachineProvider } from "../../src/services/studioMachines/fly/provider";
import type { FlyMachine } from "../../src/services/studioMachines/fly/types";

const RUN_INTEGRATION = process.env.VIVD_RUN_INTEGRATION_TESTS === "1";
const FLY_API_TOKEN = (process.env.FLY_API_TOKEN || "").trim();
const FLY_STUDIO_APP = (process.env.FLY_STUDIO_APP || "").trim();

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
  it.skipIf(!RUN_INTEGRATION || !FLY_API_TOKEN || !FLY_STUDIO_APP)(
    "updates drifted machine and leaves it suspended",
    { timeout: 420_000 },
    async () => {
      const provider = new FlyStudioMachineProvider();
      const originalConfiguredImage = process.env.FLY_STUDIO_IMAGE;

      const organizationId = "integration";
      const projectSlug = `reconcile-e2e-${Date.now().toString(36)}`;
      const version = 1;

      let machineId: string | null = null;

      try {
        delete process.env.FLY_STUDIO_IMAGE;
        const desiredImage = (await (provider as any).getDesiredImage()) as string;
        const driftImage = `${imageBaseWithoutTag(desiredImage)}:latest`;
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
