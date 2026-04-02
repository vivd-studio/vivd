import {
  isConnectedMode,
} from "@vivd/shared";
import type { WorkspaceManager } from "../../workspace/WorkspaceManager.js";
import {
  buildConnectedBackendHeaders,
  getConnectedBackendAuthConfig,
} from "../../lib/connectedBackendAuth.js";

type WorkspaceStateReporterStartOptions = {
  workspace: WorkspaceManager;
  slug: string;
  version: number;
};

const DEFAULT_REPORT_INTERVAL_MS = 5_000;

class WorkspaceStateReporter {
  private intervalHandle: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private running = false;
  private options: WorkspaceStateReporterStartOptions | null = null;

  start(options: WorkspaceStateReporterStartOptions): void {
    if (!isConnectedMode()) return;
    if (!options.slug || !Number.isFinite(options.version) || options.version < 1) return;

    this.options = options;
    if (this.running) return;
    this.startInterval();
    void this.reportNow();
  }

  async pause(): Promise<void> {
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.inflight) {
      await this.inflight.catch(() => {});
    }
  }

  resume(): void {
    if (!isConnectedMode()) return;
    if (!this.options) return;
    if (this.running) return;

    this.startInterval();
    void this.reportNow();
  }

  async shutdown(): Promise<void> {
    await this.pause();
    await this.reportNow();
    if (this.inflight) {
      await this.inflight.catch(() => {});
    }
  }

  async reportSoon(): Promise<void> {
    if (!this.running) return;
    await this.reportNow();
  }

  private async reportNow(): Promise<void> {
    if (!this.options) return;
    if (this.inflight) return;

    const config = getConnectedBackendAuthConfig();
    if (!config) return;
    if (!this.options.workspace.isInitialized()) return;

    const run = (async () => {
      let hasUnsavedChanges = false;
      let headCommitHash: string | null = null;
      let workingCommitHash: string | null = null;

      try {
        hasUnsavedChanges = await this.options!.workspace.hasChanges();
      } catch {
        hasUnsavedChanges = false;
      }

      try {
        headCommitHash = (await this.options!.workspace.getHeadCommit())?.hash ?? null;
      } catch {
        headCommitHash = null;
      }

      try {
        workingCommitHash = await this.options!.workspace.getWorkingCommit();
      } catch {
        workingCommitHash = null;
      }

      const response = await fetch(
        `${config.backendUrl}/api/trpc/studioApi.reportWorkspaceState`,
        {
          method: "POST",
          headers: buildConnectedBackendHeaders(config),
          body: JSON.stringify({
            studioId: config.studioId,
            slug: this.options!.slug,
            version: this.options!.version,
            hasUnsavedChanges,
            headCommitHash,
            workingCommitHash,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.warn(
          `[WorkspaceStateReporter] Backend state report failed ${response.status}: ${errorText}`,
        );
      }
    })()
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[WorkspaceStateReporter] Network/state report failed: ${message}`);
      })
      .finally(() => {
        if (this.inflight === run) {
          this.inflight = null;
        }
      });

    this.inflight = run;
    await run;
  }

  private startInterval(): void {
    this.running = true;
    const intervalMs = this.getIntervalMs();
    this.intervalHandle = setInterval(() => {
      void this.reportNow();
    }, intervalMs);
    this.intervalHandle.unref?.();
  }

  private getIntervalMs(): number {
    const raw = process.env.WORKSPACE_STATE_REPORT_INTERVAL_MS;
    const parsed = Number.parseInt(raw || "", 10);
    if (Number.isFinite(parsed) && parsed >= 2_000) return parsed;
    return DEFAULT_REPORT_INTERVAL_MS;
  }
}

export const workspaceStateReporter = new WorkspaceStateReporter();
