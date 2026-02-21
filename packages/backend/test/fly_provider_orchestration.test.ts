import { describe, expect, it } from "vitest";
import { FlyStudioMachineProvider } from "../src/services/studioMachines/fly/provider";
import type {
  StudioMachineStartArgs,
  StudioMachineStartResult,
} from "../src/services/studioMachines/types";
import type { FlyMachine } from "../src/services/studioMachines/fly/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const args: StudioMachineStartArgs = {
  organizationId: "org-1",
  projectSlug: "site-1",
  version: 1,
  env: {},
};

describe("FlyStudioMachineProvider orchestration", () => {
  it("deduplicates concurrent ensureRunning calls for the same studio key", async () => {
    const provider = new FlyStudioMachineProvider();
    const result: StudioMachineStartResult = {
      studioId: "studio-1",
      url: "https://example.test",
      port: 3100,
      accessToken: "token-1",
    };

    let calls = 0;
    (provider as any).ensureRunningInner = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return result;
    };

    const [first, second] = await Promise.all([
      provider.ensureRunning(args),
      provider.ensureRunning(args),
    ]);

    expect(calls).toBe(1);
    expect(first).toEqual(result);
    expect(second).toEqual(result);
  });

  it("deduplicates concurrent reconcile runs", async () => {
    const provider = new FlyStudioMachineProvider();
    const reconcileResult = {
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:v1.2.3",
      scanned: 1,
      warmedOutdatedImages: 0,
      destroyedOldMachines: 0,
      skippedRunningMachines: 0,
      dryRun: false,
      errors: [],
    };

    let calls = 0;
    (provider as any).reconcileStudioMachinesInner = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return reconcileResult;
    };

    const [first, second] = await Promise.all([
      provider.reconcileStudioMachines(),
      provider.reconcileStudioMachines(),
    ]);

    expect(calls).toBe(1);
    expect(first).toEqual(reconcileResult);
    expect(second).toEqual(reconcileResult);
  });

  it("hard restart waits for existing inflight startup before restartInner", async () => {
    const provider = new FlyStudioMachineProvider();
    const key = "org-1:site-1:v1";

    const inflight = deferred<StudioMachineStartResult>();
    (provider as any).inflight.set(key, inflight.promise);

    const restarted: StudioMachineStartResult = {
      studioId: "studio-restarted",
      url: "https://example.test",
      port: 3101,
      accessToken: "token-2",
    };

    let restartCalls = 0;
    (provider as any).restartInner = async () => {
      restartCalls++;
      return restarted;
    };

    const restartPromise = provider.restart({ ...args, mode: "hard" });
    expect(restartCalls).toBe(0);

    inflight.resolve({
      studioId: "studio-old",
      url: "https://old.test",
      port: 3100,
      accessToken: "token-old",
    });

    const result = await restartPromise;
    expect(restartCalls).toBe(1);
    expect(result).toEqual(restarted);
  });

  it("ensureRunningInner creates a machine with expected metadata and returns start result", async () => {
    const provider = new FlyStudioMachineProvider();

    (provider as any).listMachines = async (): Promise<FlyMachine[]> => [];
    (provider as any).findMachineByName = () => null;
    (provider as any).findMachine = () => null;
    (provider as any).allocatePort = () => 4100;
    (provider as any).getDesiredImage = async () => "ghcr.io/vivd-studio/vivd-studio:v1.2.3";
    (provider as any).generateStudioAccessToken = () => "token-generated";
    (provider as any).buildStudioEnv = ({ studioId, accessToken }: any) => ({
      PORT: "3100",
      STUDIO_ID: studioId,
      STUDIO_ACCESS_TOKEN: accessToken,
      VIVD_TENANT_ID: "org-1",
      VIVD_PROJECT_SLUG: "site-1",
      VIVD_PROJECT_VERSION: "1",
    });

    let createPayload: any = null;
    (provider as any).flyFetch = async (path: string, init: RequestInit = {}) => {
      expect(path).toBe("/machines");
      expect(init.method).toBe("POST");
      createPayload = JSON.parse(String(init.body));
      return { id: "machine-1" } as FlyMachine;
    };

    (provider as any).getPublicUrlForPort = (port: number) => `https://studio.test:${port}`;
    (provider as any).waitForReady = async () => {};

    let touchedKey: string | null = null;
    (provider as any).touchKey = (studioKey: string) => {
      touchedKey = studioKey;
    };

    const result = await (provider as any).ensureRunningInner(args);

    expect(createPayload?.config?.metadata?.vivd_organization_id).toBe("org-1");
    expect(createPayload?.config?.metadata?.vivd_project_slug).toBe("site-1");
    expect(createPayload?.config?.metadata?.vivd_project_version).toBe("1");
    expect(createPayload?.config?.metadata?.vivd_external_port).toBe("4100");
    expect(createPayload?.config?.metadata?.vivd_image).toBe(
      "ghcr.io/vivd-studio/vivd-studio:v1.2.3",
    );
    expect(createPayload?.config?.metadata?.vivd_studio_access_token).toBe(
      "token-generated",
    );

    expect(touchedKey).toBe("org-1:site-1:v1");
    expect(result).toEqual({
      studioId: createPayload.config.metadata.vivd_studio_id,
      url: "https://studio.test:4100",
      port: 4100,
      accessToken: "token-generated",
    });
  });

  it("warmReconcileStudioMachine returns desired image immediately for destroyed machines", async () => {
    const provider = new FlyStudioMachineProvider();
    (provider as any).getDesiredImage = async () => "ghcr.io/vivd-studio/vivd-studio:v2.0.0";
    (provider as any).getMachine = async () => ({ id: "m1", state: "destroyed" });
    (provider as any).getStudioIdentityFromMachine = () => ({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
    });

    const result = await provider.warmReconcileStudioMachine("m1");
    expect(result).toEqual({ desiredImage: "ghcr.io/vivd-studio/vivd-studio:v2.0.0" });
  });

  it("warmReconcileStudioMachine refuses running machines when drift exists", async () => {
    const provider = new FlyStudioMachineProvider();
    (provider as any).getDesiredImage = async () => "ghcr.io/vivd-studio/vivd-studio:v2.0.0";
    (provider as any).getMachine = async () => ({ id: "m2", state: "started", config: {} });
    (provider as any).getStudioIdentityFromMachine = () => ({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
    });
    (provider as any).resolveMachineReconcileState = () => ({
      accessToken: "token-1",
      needs: { image: true, services: false, guest: false, accessToken: false },
    });
    (provider as any).hasMachineDrift = () => true;

    await expect(provider.warmReconcileStudioMachine("m2")).rejects.toThrow(
      "Refusing to warm reconcile running machine m2",
    );
  });

  it("warmReconcileStudioMachine returns desired image when no drift exists", async () => {
    const provider = new FlyStudioMachineProvider();
    (provider as any).getDesiredImage = async () => "ghcr.io/vivd-studio/vivd-studio:v2.0.0";
    (provider as any).getMachine = async () => ({ id: "m3", state: "stopped", config: {} });
    (provider as any).getStudioIdentityFromMachine = () => ({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
    });
    (provider as any).resolveMachineReconcileState = () => ({
      accessToken: "token-1",
      needs: { image: false, services: false, guest: false, accessToken: false },
    });
    (provider as any).hasMachineDrift = () => false;

    const result = await provider.warmReconcileStudioMachine("m3");
    expect(result).toEqual({ desiredImage: "ghcr.io/vivd-studio/vivd-studio:v2.0.0" });
  });
});
