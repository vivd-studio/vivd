import { serverManager as opencodeServerManager } from "../../opencode/serverManager.js";
import { usageReporter } from "../reporting/UsageReporter.js";
import { workspaceStateReporter } from "../reporting/WorkspaceStateReporter.js";
import {
  acquireBucketSyncPause,
  type BucketSyncPauseLease,
} from "../sync/SyncPauseService.js";

export type RuntimeQuiesceSubsystemState = "active" | "quiescing" | "idle";

export type RuntimeQuiesceStatus = {
  state: RuntimeQuiesceSubsystemState;
  subsystems: Record<string, RuntimeQuiesceSubsystemState>;
  lastQuiescedAt: string | null;
};

type RuntimeQuiesceContext = {
  projectDir: string | null;
};

type RuntimeQuiesceAdapter = {
  name: string;
  quiesce: (context: RuntimeQuiesceContext) => Promise<void>;
  resume?: () => Promise<void> | void;
};

export class RuntimeQuiesceCoordinator {
  private readonly adapters: RuntimeQuiesceAdapter[];
  private status: RuntimeQuiesceStatus;
  private inflightQuiesce: Promise<RuntimeQuiesceStatus> | null = null;
  private resumeRequested = false;

  constructor(adapters: RuntimeQuiesceAdapter[]) {
    this.adapters = adapters;
    this.status = {
      state: "active",
      subsystems: Object.fromEntries(
        adapters.map((adapter) => [adapter.name, "active" satisfies RuntimeQuiesceSubsystemState]),
      ),
      lastQuiescedAt: null,
    };
  }

  getQuiesceStatus(): RuntimeQuiesceStatus {
    return {
      state: this.status.state,
      subsystems: { ...this.status.subsystems },
      lastQuiescedAt: this.status.lastQuiescedAt,
    };
  }

  async quiesceForSuspend(context: RuntimeQuiesceContext): Promise<RuntimeQuiesceStatus> {
    if (this.inflightQuiesce) {
      return this.inflightQuiesce;
    }

    const run = (async () => {
      this.resumeRequested = false;
      this.status.state = "quiescing";

      const results = await Promise.allSettled(
        this.adapters.map(async (adapter) => {
          this.status.subsystems[adapter.name] = "quiescing";
          await adapter.quiesce(context);
          this.status.subsystems[adapter.name] = "idle";
        }),
      );

      const failures = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              `${this.adapters[index]?.name || `adapter-${index}`}: ${
                result.reason instanceof Error ? result.reason.message : String(result.reason)
              }`,
            ]
          : [],
      );

      if (failures.length > 0) {
        this.status.state = "active";
        for (const adapter of this.adapters) {
          if (this.status.subsystems[adapter.name] !== "idle") {
            this.status.subsystems[adapter.name] = "active";
          }
        }
        throw new Error(
          `[RuntimeQuiesce] Failed to quiesce runtime for suspend: ${failures.join("; ")}`,
        );
      }

      this.status.state = "idle";
      this.status.lastQuiescedAt = new Date().toISOString();
      return this.getQuiesceStatus();
    })().finally(async () => {
      this.inflightQuiesce = null;
      if (this.resumeRequested) {
        this.resumeRequested = false;
        await this.resumeAfterActivity();
      }
    });

    this.inflightQuiesce = run;
    return run;
  }

  async resumeAfterActivity(): Promise<void> {
    if (this.inflightQuiesce) {
      this.resumeRequested = true;
      return;
    }

    const results = await Promise.allSettled(
      this.adapters.map(async (adapter) => {
        await adapter.resume?.();
        this.status.subsystems[adapter.name] = "active";
      }),
    );

    const failures = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            `${this.adapters[index]?.name || `adapter-${index}`}: ${
              result.reason instanceof Error ? result.reason.message : String(result.reason)
            }`,
          ]
        : [],
    );

    this.status.state = "active";

    if (failures.length > 0) {
      console.warn(
        `[RuntimeQuiesce] Failed to resume one or more runtime subsystems: ${failures.join("; ")}`,
      );
    }
  }
}

let bucketSyncPauseLease: BucketSyncPauseLease | null = null;

export const runtimeQuiesceCoordinator = new RuntimeQuiesceCoordinator([
  {
    name: "bucket_sync",
    quiesce: async () => {
      if (!bucketSyncPauseLease) {
        bucketSyncPauseLease = acquireBucketSyncPause();
      }
    },
    resume: () => {
      bucketSyncPauseLease?.release();
      bucketSyncPauseLease = null;
    },
  },
  {
    name: "workspace_state_reporter",
    quiesce: async () => {
      await workspaceStateReporter.pause();
    },
    resume: () => {
      workspaceStateReporter.resume();
    },
  },
  {
    name: "usage_reporter",
    quiesce: async () => {
      await usageReporter.pauseForSuspend();
    },
    resume: () => {
      usageReporter.resume();
    },
  },
  {
    name: "opencode_runtime",
    quiesce: async ({ projectDir }) => {
      if (!projectDir) return;
      await opencodeServerManager.stopServer(projectDir);
    },
  },
]);
