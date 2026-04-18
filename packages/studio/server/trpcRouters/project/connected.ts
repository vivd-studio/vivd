import { isConnectedMode } from "@vivd/shared";
import type { Context } from "../../trpc/context.js";
import { callConnectedBackendQuery } from "../project.shared.js";

const GITHUB_SYNC_DISABLED_REASON = "GitHub sync is super-admin only.";

export async function getGitHubSyncUiGate(
  ctx: Context,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!isConnectedMode()) return { allowed: true };

  try {
    const config = await callConnectedBackendQuery<{
      isSuperAdminUser?: boolean;
    }>(ctx, "config.getAppConfig", {});
    if (config?.isSuperAdminUser) return { allowed: true };
    return { allowed: false, reason: GITHUB_SYNC_DISABLED_REASON };
  } catch {
    return { allowed: false, reason: GITHUB_SYNC_DISABLED_REASON };
  }
}

export async function getConnectedSupportEmail(
  ctx: Context,
): Promise<string | null> {
  if (!isConnectedMode()) return null;

  try {
    const config = await callConnectedBackendQuery<{
      supportEmail?: string | null;
    }>(ctx, "config.getAppConfig", {});
    return config.supportEmail?.trim() || null;
  } catch {
    return null;
  }
}

export async function assertGitHubSyncAllowed(ctx: Context): Promise<void> {
  const gate = await getGitHubSyncUiGate(ctx);
  if (!gate.allowed) {
    throw new Error(gate.reason || GITHUB_SYNC_DISABLED_REASON);
  }
}
