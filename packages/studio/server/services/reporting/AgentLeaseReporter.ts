import {
  isConnectedMode,
} from "@vivd/shared";
import {
  buildConnectedBackendHeaders,
  getConnectedBackendAuthConfig,
} from "../../lib/connectedBackendAuth.js";

type StartRunInput = {
  runId: string;
  sessionId: string;
  projectSlug: string;
  version: number;
};

type ActiveRun = StartRunInput & {
  startedAtMs: number;
};

const DEFAULT_HEARTBEAT_MS = 20_000;
const MIN_HEARTBEAT_MS = 5_000;

class AgentLeaseReporter {
  private activeRuns = new Map<string, ActiveRun>();
  private runIdsBySession = new Map<string, Set<string>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatInFlight: Promise<void> | null = null;

  startRun(input: StartRunInput): void {
    if (!isConnectedMode()) return;
    if (!input.projectSlug) return;
    if (!Number.isFinite(input.version) || input.version < 1) return;

    const run: ActiveRun = {
      ...input,
      startedAtMs: Date.now(),
    };

    this.activeRuns.set(input.runId, run);

    const sessionRuns = this.runIdsBySession.get(input.sessionId) || new Set<string>();
    sessionRuns.add(input.runId);
    this.runIdsBySession.set(input.sessionId, sessionRuns);

    this.ensureHeartbeatTimer();
    void this.reportActive(run);
  }

  finishRun(runId: string): void {
    const run = this.activeRuns.get(runId);
    if (!run) return;

    this.activeRuns.delete(runId);
    const sessionRuns = this.runIdsBySession.get(run.sessionId);
    if (sessionRuns) {
      sessionRuns.delete(runId);
      if (sessionRuns.size === 0) {
        this.runIdsBySession.delete(run.sessionId);
      }
    }

    this.stopHeartbeatTimerIfIdle();
    void this.reportIdle(run);
  }

  finishSession(sessionId: string): void {
    const runIds = this.runIdsBySession.get(sessionId);
    if (!runIds || runIds.size === 0) return;
    for (const runId of Array.from(runIds)) {
      this.finishRun(runId);
    }
  }

  private ensureHeartbeatTimer(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.flushHeartbeats();
    }, this.getHeartbeatMs());
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeatTimerIfIdle(): void {
    if (this.activeRuns.size > 0) return;
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async flushHeartbeats(): Promise<void> {
    if (this.activeRuns.size === 0) {
      this.stopHeartbeatTimerIfIdle();
      return;
    }
    if (this.heartbeatInFlight) return;

    const run = (async () => {
      const runs = Array.from(this.activeRuns.values());
      for (const activeRun of runs) {
        const leaseState = await this.reportActive(activeRun);
        if (leaseState === "max_exceeded") {
          console.warn(
            `[AgentLeaseReporter] Lease max exceeded for run ${activeRun.runId} (session ${activeRun.sessionId}); stopping keepalive heartbeats for this run.`,
          );
          this.finishRun(activeRun.runId);
        }
      }
    })().finally(() => {
      if (this.heartbeatInFlight === run) {
        this.heartbeatInFlight = null;
      }
    });

    this.heartbeatInFlight = run;
    await run;
  }

  private async reportActive(run: ActiveRun): Promise<"active" | "max_exceeded" | "error"> {
    const config = this.getBackendConfig();
    if (!config) return "error";

    try {
      const response = await fetch(
        `${config.backendUrl}/api/trpc/studioApi.reportAgentTaskLease`,
        {
          method: "POST",
          headers: buildConnectedBackendHeaders(config),
          body: JSON.stringify({
            studioId: config.studioId,
            slug: run.projectSlug,
            version: run.version,
            sessionId: run.sessionId,
            runId: run.runId,
            state: "active",
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.warn(
          `[AgentLeaseReporter] Active lease report failed ${response.status}: ${errorText}`,
        );
        return "error";
      }

      const body = (await response.json().catch(() => null)) as any;
      const payload =
        body?.result?.data?.json ??
        body?.result?.data ??
        body;
      const leaseState = payload?.leaseState;
      if (leaseState === "max_exceeded") return "max_exceeded";
      return "active";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[AgentLeaseReporter] Active lease network failure: ${message}`);
      return "error";
    }
  }

  private async reportIdle(run: ActiveRun): Promise<void> {
    const config = this.getBackendConfig();
    if (!config) return;

    try {
      const response = await fetch(
        `${config.backendUrl}/api/trpc/studioApi.reportAgentTaskLease`,
        {
          method: "POST",
          headers: buildConnectedBackendHeaders(config),
          body: JSON.stringify({
            studioId: config.studioId,
            slug: run.projectSlug,
            version: run.version,
            sessionId: run.sessionId,
            runId: run.runId,
            state: "idle",
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.warn(
          `[AgentLeaseReporter] Idle lease report failed ${response.status}: ${errorText}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[AgentLeaseReporter] Idle lease network failure: ${message}`);
    }
  }

  private getBackendConfig():
    | {
        backendUrl: string;
        studioId: string;
        organizationId?: string;
        studioAccessToken?: string;
      }
    | null {
    if (!isConnectedMode()) return null;
    return getConnectedBackendAuthConfig();
  }

  private getHeartbeatMs(): number {
    const parsed = Number.parseInt(process.env.AGENT_LEASE_HEARTBEAT_MS || "", 10);
    if (!Number.isFinite(parsed)) return DEFAULT_HEARTBEAT_MS;
    return Math.max(MIN_HEARTBEAT_MS, parsed);
  }
}

export const agentLeaseReporter = new AgentLeaseReporter();
