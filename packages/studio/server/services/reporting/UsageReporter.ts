/**
 * Usage Reporter Service
 *
 * Reports usage events from standalone studio to main backend in connected mode.
 * In standalone mode, this is a no-op.
 */

import {
  isConnectedMode,
  getBackendUrl,
  getConnectedOrganizationId,
  getSessionToken,
  getStudioId,
  type StudioImageGenerationReport,
  type StudioUsageReport,
} from "@vivd/shared";
import type { UsageData } from "../../opencode/useEvents.js";

const MAX_QUEUE_SIZE = 100;
const FLUSH_INTERVAL_MS = 5000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const STATUS_MAX_RETRY_ATTEMPTS = 3;
const STATUS_RETRY_DELAY_MS = 1000;

class UsageReporter {
  private queue: StudioUsageReport[] = [];
  private flushing = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

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

    // Start periodic flush
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error("[UsageReporter] Flush error:", err);
      });
    }, FLUSH_INTERVAL_MS);
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
    if (this.queue.length >= 10) {
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

    const backendUrl = getBackendUrl();
    const sessionToken = getSessionToken();
    const studioId = getStudioId();
    const organizationId = getConnectedOrganizationId();
    if (!backendUrl || !sessionToken || !studioId) {
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
        `${backendUrl}/api/trpc/studioApi.reportImageGeneration`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
            ...(organizationId
              ? { "x-vivd-organization-id": organizationId }
              : {}),
          },
          body: JSON.stringify({
            studioId,
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

    const backendUrl = getBackendUrl();
    const sessionToken = getSessionToken();
    const studioId = getStudioId();
    const organizationId = getConnectedOrganizationId();
    if (!backendUrl || !sessionToken || !studioId) return;

    const title = sessionTitle.trim();
    if (!title) return;
    if (/^new session\b/i.test(title)) return;

    try {
      const response = await fetch(
        `${backendUrl}/api/trpc/studioApi.updateSessionTitle`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
            ...(organizationId
              ? { "x-vivd-organization-id": organizationId }
              : {}),
          },
          body: JSON.stringify({
            studioId,
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
   * Flush queued reports to backend.
   */
  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return;
    }

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
    }
  }

  /**
   * Send reports to the main backend.
   */
  private async sendToBackend(reports: StudioUsageReport[]): Promise<boolean> {
    const backendUrl = getBackendUrl();
    const sessionToken = getSessionToken();
    const studioId = getStudioId();
    const organizationId = getConnectedOrganizationId();

    if (!backendUrl || !sessionToken || !studioId) {
      console.error("[UsageReporter] Missing backend configuration");
      return false;
    }

    let attempt = 0;
    while (attempt < MAX_RETRY_ATTEMPTS) {
      attempt++;

      try {
        // `studioApi.reportUsage` is a tRPC mutation procedure.
        // The Express adapter expects the raw JSON input body (no `{ json: ... }` wrapper).
        const response = await fetch(`${backendUrl}/api/trpc/studioApi.reportUsage`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
            ...(organizationId
              ? { "x-vivd-organization-id": organizationId }
              : {}),
          },
          body: JSON.stringify({
            studioId,
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
          console.error("[UsageReporter] Authentication failed - check SESSION_TOKEN");
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

  /**
   * Fetch current usage status from backend.
   * Returns null in standalone mode or on error.
   */
  async fetchStatus(): Promise<UsageStatus | null> {
    if (!isConnectedMode()) {
      return null;
    }

    const backendUrl = getBackendUrl();
    const sessionToken = getSessionToken();
    const studioId = getStudioId();
    const organizationId = getConnectedOrganizationId();

    if (!backendUrl || !sessionToken || !studioId) {
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
          `${backendUrl}/api/trpc/studioApi.getStatus?input=${encodeURIComponent(
            JSON.stringify({ studioId })
          )}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionToken}`,
              ...(organizationId
                ? { "x-vivd-organization-id": organizationId }
                : {}),
            },
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
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    if (this.queue.length > 0) {
      await this.flush();
    }
  }
}

/**
 * Usage status returned from backend.
 */
export interface UsageStatus {
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

export const usageReporter = new UsageReporter();
