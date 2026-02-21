/**
 * Project Touch Reporter
 *
 * In connected mode, notifies the main backend that a project's workspace has changed
 * so the backend can update `project_meta.updatedAt` for UI sorting.
 *
 * In standalone mode, this is a no-op.
 */

import {
  isConnectedMode,
  getBackendUrl,
  getConnectedOrganizationId,
  getSessionToken,
  getStudioId,
} from "@vivd/shared";

const TOUCH_THROTTLE_MS = 1500;

class ProjectTouchReporter {
  private lastTouchBySlug = new Map<string, number>();
  private inflightBySlug = new Map<string, Promise<void>>();

  touch(slug: string): void {
    if (!isConnectedMode()) return;

    const backendUrl = getBackendUrl();
    const sessionToken = getSessionToken();
    const studioId = getStudioId();
    const organizationId = getConnectedOrganizationId();
    if (!backendUrl || !sessionToken || !studioId) return;

    const normalizedSlug = slug.trim();
    if (!normalizedSlug) return;

    const now = Date.now();
    const last = this.lastTouchBySlug.get(normalizedSlug) ?? 0;
    if (now - last < TOUCH_THROTTLE_MS) return;
    this.lastTouchBySlug.set(normalizedSlug, now);

    if (this.inflightBySlug.has(normalizedSlug)) return;

    const promise = fetch(
      `${backendUrl}/api/trpc/studioApi.touchProjectUpdatedAt`,
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
          slug: normalizedSlug,
        }),
      },
    )
      .then(async (response) => {
        if (response.ok) return;
        const errorText = await response.text().catch(() => "Unknown error");
        console.warn(
          `[ProjectTouchReporter] Backend touch failed ${response.status}: ${errorText}`,
        );
      })
      .catch((err) => {
        console.warn("[ProjectTouchReporter] Network error:", err);
      })
      .finally(() => {
        this.inflightBySlug.delete(normalizedSlug);
      });

    this.inflightBySlug.set(normalizedSlug, promise);
  }
}

export const projectTouchReporter = new ProjectTouchReporter();
