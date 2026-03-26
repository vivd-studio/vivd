import { afterEach, describe, expect, it, vi } from "vitest";
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

function studioMachine(options: {
  id: string;
  state: FlyMachine["state"];
  image: string;
  metadataImage?: string;
  env?: Record<string, string>;
}): FlyMachine {
  const accessToken = "token-1";
  return {
    id: options.id,
    state: options.state,
    config: {
      image: options.image,
      kill_timeout: 180,
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
      env: {
        STUDIO_ID: "studio-1",
        STUDIO_ACCESS_TOKEN: accessToken,
        VIVD_TENANT_ID: "org-1",
        VIVD_PROJECT_SLUG: "site-1",
        VIVD_PROJECT_VERSION: "1",
        ...(options.env || {}),
      },
      services: [{ autostop: "suspend", autostart: false, ports: [{ port: 4100 }] }],
      metadata: {
        vivd_organization_id: "org-1",
        vivd_project_slug: "site-1",
        vivd_project_version: "1",
        vivd_external_port: "4100",
        vivd_studio_id: "studio-1",
        vivd_studio_access_token: accessToken,
        ...(options.metadataImage ? { vivd_image: options.metadataImage } : {}),
      },
    },
  };
}

describe("FlyStudioMachineProvider orchestration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("stopIdleMachines swallows list-machines failures", async () => {
    const provider = new FlyStudioMachineProvider();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (provider as any).apiClient.listMachines = async () => {
      throw new Error("fetch failed");
    };

    await expect((provider as any).stopIdleMachines()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[FlyMachines] Idle cleanup failed: fetch failed"),
    );

    warnSpy.mockRestore();
  });

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

    (provider as any).apiClient.listMachines = async (): Promise<FlyMachine[]> => [];
    (provider as any).allocatePort = () => 4100;
    (provider as any).getDesiredImage = async () => "ghcr.io/vivd-studio/vivd-studio:v1.2.3";
    (provider as any).config.generateStudioAccessToken = () => "token-generated";
    (provider as any).buildStudioEnv = ({ studioId, accessToken }: any) => ({
      PORT: "3100",
      STUDIO_ID: studioId,
      STUDIO_ACCESS_TOKEN: accessToken,
      VIVD_TENANT_ID: "org-1",
      VIVD_PROJECT_SLUG: "site-1",
      VIVD_PROJECT_VERSION: "1",
    });

    let createPayload: any = null;
    (provider as any).apiClient.createMachine = async ({ machineName, config }: any) => {
      expect(machineName).toContain("site-1");
      createPayload = { config };
      return { id: "machine-1" } as FlyMachine;
    };

    (provider as any).config.getPublicUrlForPort = (port: number) =>
      `https://studio.test:${port}`;
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
    (provider as any).getMachine = async () =>
      studioMachine({
        id: "m1",
        state: "destroyed",
        image: "ghcr.io/vivd-studio/vivd-studio:v1.0.0",
      });

    const result = await provider.warmReconcileStudioMachine("m1");
    expect(result).toEqual({ desiredImage: "ghcr.io/vivd-studio/vivd-studio:v2.0.0" });
  });

  it("warmReconcileStudioMachine refuses running machines when drift exists", async () => {
    const provider = new FlyStudioMachineProvider();
    (provider as any).getDesiredImage = async () => "ghcr.io/vivd-studio/vivd-studio:v2.0.0";
    (provider as any).getMachine = async () =>
      studioMachine({
        id: "m2",
        state: "started",
        image: "ghcr.io/vivd-studio/vivd-studio:v1.0.0",
      });

    await expect(provider.warmReconcileStudioMachine("m2")).rejects.toThrow(
      "Refusing to warm reconcile running machine m2",
    );
  });

  it("ensureRunning refreshes passthrough model env drift", async () => {
    vi.stubEnv(
      "OPENCODE_MODEL_STANDARD",
      "openrouter/google/gemini-3-flash-preview",
    );

    const provider = new FlyStudioMachineProvider();
    const desiredImage = "ghcr.io/vivd-studio/vivd-studio:v2.0.0";
    const machine = studioMachine({
      id: "m4",
      state: "started",
      image: desiredImage,
      metadataImage: desiredImage,
      env: {
        OPENCODE_MODEL_STANDARD: "openrouter/google/gemini-2.5-flash",
      },
    });

    (provider as any).apiClient.listMachines = async () => [machine];
    (provider as any).getDesiredImage = async () => desiredImage;
    (provider as any).getMachine = async () => ({
      ...machine,
      state: "stopped",
    });
    const stopMachineMock = vi
      .spyOn((provider as any).apiClient, "stopMachine")
      .mockResolvedValue(undefined);
    (provider as any).waitForState = async () => {};

    let updatedConfig: any = null;
    (provider as any).apiClient.updateMachineConfig = async ({ config }: any) => {
      updatedConfig = config;
      return { ...machine, config, state: "stopped" };
    };
    (provider as any).startMachineHandlingReplacement = async () => {};
    (provider as any).waitForReady = async () => {};
    (provider as any).config.getPublicUrlForPort = (port: number) =>
      `https://studio.test:${port}`;

    await provider.ensureRunning(args);

    expect(stopMachineMock).toHaveBeenCalledWith("m4");
    expect(updatedConfig?.env?.OPENCODE_MODEL_STANDARD).toBe(
      "openrouter/google/gemini-3-flash-preview",
    );
  });

  it("warmReconcileStudioMachine refreshes passthrough model env drift", async () => {
    vi.stubEnv(
      "OPENCODE_MODEL_STANDARD",
      "openrouter/google/gemini-3-flash-preview",
    );

    const provider = new FlyStudioMachineProvider();
    const desiredImage = "ghcr.io/vivd-studio/vivd-studio:v2.0.0";
    const machine = studioMachine({
      id: "m5",
      state: "stopped",
      image: desiredImage,
      metadataImage: desiredImage,
      env: {
        OPENCODE_MODEL_STANDARD: "openrouter/google/gemini-2.5-flash",
        SESSION_TOKEN: "old-session-token",
      },
    });

    (provider as any).getDesiredImage = async () => desiredImage;
    (provider as any).getMachine = async () => machine;
    let updatedConfig: any = null;
    (provider as any).apiClient.updateMachineConfig = async ({ config }: any) => {
      updatedConfig = config;
      return { ...machine, config };
    };
    (provider as any).waitForReconcileDriftToClear = async () => null;
    (provider as any).startMachineHandlingReplacement = async () => {};
    (provider as any).waitForReady = async () => {};
    (provider as any).suspendOrStopMachine = async () => "suspended";
    (provider as any).config.getPublicUrlForPort = (port: number) =>
      `https://studio.test:${port}`;

    await provider.warmReconcileStudioMachine("m5");

    expect(updatedConfig?.env?.OPENCODE_MODEL_STANDARD).toBe(
      "openrouter/google/gemini-3-flash-preview",
    );
    expect(updatedConfig?.env?.SESSION_TOKEN).toBe("old-session-token");
  });

  it("warmReconcileStudioMachine returns desired image when no drift exists", async () => {
    const provider = new FlyStudioMachineProvider();
    const desiredImage = "ghcr.io/vivd-studio/vivd-studio:v2.0.0";
    (provider as any).getDesiredImage = async () => desiredImage;
    (provider as any).getMachine = async () =>
      studioMachine({
        id: "m3",
        state: "stopped",
        image: desiredImage,
        metadataImage: desiredImage,
      });
    (provider as any).resolveMachineReconcileState = () => ({
      accessToken: "token-1",
      needs: {
        image: false,
        services: false,
        guest: false,
        accessToken: false,
        env: false,
      },
    });

    const result = await provider.warmReconcileStudioMachine("m3");
    expect(result).toEqual({ desiredImage });
  });
});
