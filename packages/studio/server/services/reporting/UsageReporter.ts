/**
 * Usage Reporter Service
 *
 * Reports usage events from standalone studio to main backend in connected mode.
 * In standalone mode, this is a no-op.
 */

import {
  isConnectedMode,
  type StudioImageGenerationReport,
  type StudioUsageReport,
} from "@vivd/shared";
import type { UsageData } from "../../opencode/useEvents.js";
import {
  buildConnectedBackendHeaders,
  getConnectedBackendAuthConfig,
} from "../../lib/connectedBackendAuth.js";

const MAX_QUEUE_SIZE = 100;
const FLUSH_INTERVAL_MS = 5000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const STATUS_MAX_RETRY_ATTEMPTS = 3;
const STATUS_RETRY_DELAY_MS = 1000;

/**
 * Usage status returned from backend.
 */
export interface UsageStatus {
  reason?: "ok" | "backend_unavailable";
  blocked: boolean;
  imageGenBlocked: boolean;
  warnings: string[];
  usage: {
    daily: { current: number; limit: number; percentage: number };
    weekly: { current: number; limit: number; percentage: number };
    monthly: { current: number; limit: number; percentage: number };
    imageGen: { current: number; limit: number; percentage: number };
  };
  nextReset: {
    daily: Date | string;
    weekly: Date | string;
    monthly: Date | string;
  };
}

export class UsageReporter {
  private queue: StudioUsageReport[] = [];
  private flushing = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> | null = null;
  private initialized = false;
  private pausedForSuspend = false;

  /**
   * Initialize the reporter. Call this once at startup.
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (!isConnectedMode()) {
      console.log("[UsageReporter] Standalone mode - usage reporting disabled");
      return;
    }

    console.log("[UsageReporter] Connected mode - usage reporting enabled");
    this.startFlushTimer();
  }

  async pauseForSuspend(): Promise<void> {
    this.pausedForSuspend = true;
    this.stopFlushTimer();
    if (this.flushPromise) {
      await this.flushPromise.catch(() => {});
    }
  }

  resume(): void {
    if (!this.initialized) return;
    if (!isConnectedMode()) return;
    if (!this.pausedForSuspend) return;

    this.pausedForSuspend = false;
    this.startFlushTimer();
  }

  /**
   * Report a usage event. Called by OpenCode event handler.
   */
  async report(
    data: UsageData,
    sessionId: string,
    sessionTitle?: string,
    projectPath?: string
  ): Promise<void> {
    if (!isConnectedMode()) {
      return; // No-op in standalone mode
    }

    const report: StudioUsageReport = {
      sessionId,
      sessionTitle,
      cost: data.cost,
      tokens: data.tokens,
      partId: data.partId,
      projectPath,
      timestamp: new Date().toISOString(),
    };

    this.queue.push(report);

    // Prevent queue from growing too large
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue.shift();
      console.warn("[UsageReporter] Queue overflow - oldest report dropped");
    }

    // If queue is getting large, trigger immediate flush
    if (!this.pausedForSuspend && this.queue.length >= 10) {
      this.flush().catch((err) => {
        console.error("[UsageReporter] Immediate flush error:", err);
      });
    }
  }

  /**
   * Report a successful image generation event from Studio tools.
   */
  async reportImageGeneration(
    projectPath?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    if (!isConnectedMode()) return;

    const config = getConnectedBackendAuthConfig();
    if (!config) {
      console.error("[UsageReporter] Missing backend configuration for image generation");
      return;
    }

    const report: StudioImageGenerationReport = {
      projectPath,
      idempotencyKey,
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await fetch(
        `${config.backendUrl}/api/trpc/studioApi.reportImageGeneration`,
        {
          method: "POST",
          headers: buildConnectedBackendHeaders(config),
          body: JSON.stringify({
            studioId: config.studioId,
            report,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error(
          `[UsageReporter] Image generation report failed ${response.status}: ${errorText}`,
        );
      }
    } catch (err) {
      console.error("[UsageReporter] Image generation report network error:", err);
    }
  }

  /**
   * Send the latest session title to the backend (connected mode).
   * This is used to update UI labels after OpenCode renames a session.
   */
  async updateSessionTitle(
    sessionId: string,
    sessionTitle: string,
    projectSlug?: string,
  ): Promise<void> {
    if (!isConnectedMode()) return;

    const config = getConnectedBackendAuthConfig();
    if (!config) return;

    const title = sessionTitle.trim();
    if (!title) return;
    if (/^new session\b/i.test(title)) return;

    try {
      const response = await fetch(
        `${config.backendUrl}/api/trpc/studioApi.updateSessionTitle`,
        {
          method: "POST",
          headers: buildConnectedBackendHeaders(config),
          body: JSON.stringify({
            studioId: config.studioId,
            sessionId,
            sessionTitle: title,
            projectSlug,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error(
          `[UsageReporter] Session title update failed ${response.status}: ${errorText}`,
        );
      }
    } catch (err) {
      console.error("[UsageReporter] Session title update network error:", err);
    }
  }

  /**
   * Fetch current usage status from backend.
   * Returns null in standalone mode or on error.
   */
  async fetchStatus(): Promise<UsageStatus | null> {
    if (!isConnectedMode()) {
      return null;
    }

    const config = getConnectedBackendAuthConfig();
    if (!config) {
      console.error("[UsageReporter] Missing backend configuration for status fetch");
      return null;
    }

    let attempt = 0;
    while (attempt < STATUS_MAX_RETRY_ATTEMPTS) {
      attempt++;
      try {
        // `studioApi.getStatus` is a tRPC query procedure, which expects GET requests.
        // The `input` querystring should be the raw JSON input (no `{ json: ... }` wrapper).
        const response = await fetch(
          `${config.backendUrl}/api/trpc/studioApi.getStatus?input=${encodeURIComponent(
            JSON.stringify({ studioId: config.studioId })
          )}`,
          {
            method: "GET",
            headers: buildConnectedBackendHeaders(config),
          }
        );

        if (response.ok) {
          const data = await response.json();
          return data.result?.data?.json ?? data.result?.data ?? null;
        }

        const errorText = await response.text().catch(() => "Unknown error");
        console.error(
          `[UsageReporter] Status fetch failed ${response.status}: ${errorText}`
        );

        // Don't retry auth errors.
        if (response.status === 401 || response.status === 403) {
          return null;
        }
      } catch (err) {
        console.error(`[UsageReporter] Failed to fetch status (attempt ${attempt}):`, err);
      }

      if (attempt < STATUS_MAX_RETRY_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, STATUS_RETRY_DELAY_MS * attempt)
        );
      }
    }

    return null;
  }

  /**
   * Shutdown the reporter. Call on process exit.
   */
  async shutdown(): Promise<void> {
    this.stopFlushTimer();
    this.pausedForSuspend = false;

    // Final flush
    if (this.queue.length > 0) {
      await this.flush();
    } else if (this.flushPromise) {
      await this.flushPromise.catch(() => {});
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer || this.pausedForSuspend) return;

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error("[UsageReporter] Flush error:", err);
      });
    }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  private stopFlushTimer(): void {
    if (!this.flushTimer) return;
    clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  /**
   * Flush queued reports to backend.
   */
  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return this.flushPromise ?? Promise.resolve();
    }

    let run: Promise<void> | null = null;
    run = (async () => {
      this.flushing = true;

      try {
        const reportsToSend = [...this.queue];
        this.queue = [];

        const success = await this.sendToBackend(reportsToSend);

        if (!success) {
          // Re-queue failed reports (at the front)
          this.queue = [...reportsToSend, ...this.queue];
          // Trim if too large
          while (this.queue.length > MAX_QUEUE_SIZE) {
            this.queue.shift();
          }
        }
      } finally {
        this.flushing = false;
        if (run && this.flushPromise === run) {
          this.flushPromise = null;
        }
      }
    })();

    this.flushPromise = run;
    await run;
  }

  /**
   * Send reports to the main backend.
   */
  private async sendToBackend(reports: StudioUsageReport[]): Promise<boolean> {
    const config = getConnectedBackendAuthConfig();
    if (!config) {
      console.error("[UsageReporter] Missing backend configuration");
      return false;
    }

    let attempt = 0;
    while (attempt < MAX_RETRY_ATTEMPTS) {
      attempt++;

      try {
        // `studioApi.reportUsage` is a tRPC mutation procedure.
        // The Express adapter expects the raw JSON input body (no `{ json: ... }` wrapper).
        const response = await fetch(`${config.backendUrl}/api/trpc/studioApi.reportUsage`, {
          method: "POST",
          headers: buildConnectedBackendHeaders(config),
          body: JSON.stringify({
            studioId: config.studioId,
            reports,
          }),
        });

        if (response.ok) {
          console.log(`[UsageReporter] Sent ${reports.length} reports to backend`);
          return true;
        }

        const errorText = await response.text().catch(() => "Unknown error");
        console.error(
          `[UsageReporter] Backend returned ${response.status}: ${errorText}`
        );

        // Don't retry on auth errors
        if (response.status === 401 || response.status === 403) {
          console.error("[UsageReporter] Authentication failed - check studio/backend auth");
          return false;
        }
      } catch (err) {
        console.error(`[UsageReporter] Network error (attempt ${attempt}):`, err);
      }

      // Wait before retry
      if (attempt < MAX_RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    }

    console.error(
      `[UsageReporter] Failed to send reports after ${MAX_RETRY_ATTEMPTS} attempts`
    );
    return false;
  }
}

export const usageReporter = new UsageReporter();
