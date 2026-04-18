import { z } from "zod";
import { publicProcedure } from "../../trpc/trpc.js";
import { detectProjectType } from "../../services/project/projectType.js";
import {
  buildAndUploadPreview,
  syncSourceToBucket,
} from "../../services/sync/ArtifactSyncService.js";
import {
  checkGitHubRepoExists,
  getGitHubSyncProjectInfo,
  sanitizeGitAuthFromMessage,
} from "../../services/integrations/GitHubSyncService.js";
import { withBucketSyncPaused } from "../../services/sync/SyncPauseService.js";
import { projectTouchReporter } from "../../services/reporting/ProjectTouchReporter.js";
import { thumbnailGenerationReporter } from "../../services/reporting/ThumbnailGenerationReporter.js";
import { workspaceStateReporter } from "../../services/reporting/WorkspaceStateReporter.js";
import { assertGitHubSyncAllowed, getGitHubSyncUiGate } from "./connected.js";

function buildBlockedGitHubSyncStatus(args: {
  uiAllowed: boolean;
  uiReason: string | null;
  fetchError: string | null;
  reason: string;
}) {
  return {
    uiAllowed: args.uiAllowed,
    uiReason: args.uiReason,
    enabled: false,
    configured: false,
    remoteName: "origin",
    repoFullName: null as string | null,
    remoteUrl: null as string | null,
    sshUrl: null as string | null,
    remoteRepoExists: null as boolean | null,
    remoteMainExists: null as boolean | null,
    headHash: null as string | null,
    branch: null as string | null,
    detached: true,
    hasUncommittedChanges: false,
    workingCommitPinned: false,
    ahead: null as number | null,
    behind: null as number | null,
    diverged: null as boolean | null,
    fetchError: args.fetchError,
    pull: {
      allowed: false,
      reason: args.reason,
    },
    forceSync: {
      allowed: false,
      reason: args.reason,
    },
    lastFetchedAt: null as string | null,
  };
}

async function syncRemoteArtifacts(args: {
  projectDir: string;
  slug: string;
  version: number;
  headHash: string;
  exact?: boolean;
}): Promise<boolean> {
  const config = detectProjectType(args.projectDir);

  await syncSourceToBucket({
    projectDir: args.projectDir,
    slug: args.slug,
    version: args.version,
    commitHash: args.headHash,
    exact: args.exact,
  });

  if (config.framework !== "astro") {
    return false;
  }

  await buildAndUploadPreview({
    projectDir: args.projectDir,
    slug: args.slug,
    version: args.version,
    commitHash: args.headHash,
  });

  return true;
}

export const projectGitHubSyncProcedures = {
  gitHubSyncStatus: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const gate = await getGitHubSyncUiGate(ctx);
      if (!gate.allowed) {
        return buildBlockedGitHubSyncStatus({
          uiAllowed: false,
          uiReason: gate.reason ?? "GitHub sync is super-admin only.",
          fetchError: null,
          reason: gate.reason ?? "GitHub sync is super-admin only.",
        });
      }

      if (!ctx.workspace.isInitialized()) {
        return buildBlockedGitHubSyncStatus({
          uiAllowed: true,
          uiReason: null,
          fetchError: "Workspace not initialized",
          reason: "Workspace not initialized",
        });
      }

      const info = getGitHubSyncProjectInfo({
        slug: input.slug,
        version: input.version,
      });
      const configuredInfo = info.enabled && info.configured ? info : null;
      const remoteBranch = "main";

      const status = await ctx.workspace.getRemoteSyncStatus({
        remoteName: info.remoteName,
        remoteUrl: configuredInfo?.remoteUrl,
        remoteBranch: configuredInfo ? remoteBranch : "",
        authHeader: configuredInfo?.httpAuthHeader,
        fetch: Boolean(configuredInfo),
      });

      let remoteRepoExists: boolean | null = null;
      if (configuredInfo) {
        try {
          remoteRepoExists = await checkGitHubRepoExists(configuredInfo);
        } catch {
          remoteRepoExists = null;
        }
      }

      const fetchError = status.fetchError
        ? sanitizeGitAuthFromMessage(status.fetchError)
        : null;

      const pullEligibility = (() => {
        if (!info.enabled) {
          return { allowed: false, reason: "GitHub sync is disabled." };
        }
        if (!info.configured) {
          return { allowed: false, reason: info.error };
        }
        if (remoteRepoExists === false) {
          return { allowed: false, reason: "GitHub repo not found." };
        }
        if (fetchError) {
          return { allowed: false, reason: `Fetch failed: ${fetchError}` };
        }
        if (status.hasUncommittedChanges) {
          return { allowed: false, reason: "You have uncommitted changes." };
        }
        if (status.workingCommitPinned) {
          return { allowed: false, reason: "You're viewing an older snapshot." };
        }
        if (status.detached) {
          return { allowed: false, reason: "You're in a detached HEAD state." };
        }
        if (status.branch !== remoteBranch) {
          return {
            allowed: false,
            reason: `You're on '${status.branch ?? "detached"}'. Switch to '${remoteBranch}'.`,
          };
        }
        if (status.remoteBranchExists === false) {
          return { allowed: false, reason: "Remote main branch not found." };
        }
        if (status.ahead === null || status.behind === null) {
          return { allowed: false, reason: "Unable to compare local vs GitHub." };
        }
        if (status.ahead > 0 && status.behind > 0) {
          return {
            allowed: false,
            reason: "Your local branch has diverged from GitHub.",
          };
        }
        if (status.ahead > 0) {
          return { allowed: false, reason: "Your local branch is ahead of GitHub." };
        }
        if (status.behind === 0) {
          return { allowed: false, reason: "Already up to date." };
        }
        return { allowed: true };
      })();

      const forceEligibility = (() => {
        if (!info.enabled) {
          return { allowed: false, reason: "GitHub sync is disabled." };
        }
        if (!info.configured) {
          return { allowed: false, reason: info.error };
        }
        if (remoteRepoExists === false) {
          return { allowed: false, reason: "GitHub repo not found." };
        }
        if (fetchError) {
          return { allowed: false, reason: `Fetch failed: ${fetchError}` };
        }
        if (status.remoteBranchExists === false) {
          return { allowed: false, reason: "Remote main branch not found." };
        }
        return { allowed: true };
      })();

      const lastFetchedAt =
        configuredInfo && !fetchError ? new Date().toISOString() : null;

      return {
        uiAllowed: true,
        uiReason: null as string | null,
        enabled: info.enabled,
        configured: info.configured,
        remoteName: info.remoteName,
        repoFullName: configuredInfo ? configuredInfo.repoFullName : null,
        remoteUrl: configuredInfo ? configuredInfo.remoteUrl : status.remoteUrl,
        sshUrl: configuredInfo ? configuredInfo.sshUrl : null,
        remoteRepoExists,
        remoteMainExists: status.remoteBranchExists,
        headHash: status.headHash,
        branch: status.branch,
        detached: status.detached,
        hasUncommittedChanges: status.hasUncommittedChanges,
        workingCommitPinned: status.workingCommitPinned,
        ahead: status.ahead,
        behind: status.behind,
        diverged: status.diverged,
        fetchError,
        pull: pullEligibility,
        forceSync: forceEligibility,
        lastFetchedAt,
      };
    }),

  gitHubPullFastForward: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGitHubSyncAllowed(ctx);
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const info = getGitHubSyncProjectInfo({
        slug: input.slug,
        version: input.version,
      });
      if (!info.enabled) {
        throw new Error("GitHub sync is disabled.");
      }
      if (!info.configured) {
        throw new Error(info.error);
      }

      const projectDir = ctx.workspace.getProjectPath();
      let shouldTriggerThumbnail = false;

      try {
        const result = await withBucketSyncPaused(async () => {
          const pull = await ctx.workspace.pullFastForwardFromRemote({
            remoteName: info.remoteName,
            remoteUrl: info.remoteUrl,
            remoteBranch: "main",
            authHeader: info.httpAuthHeader,
          });

          shouldTriggerThumbnail = await syncRemoteArtifacts({
            projectDir,
            slug: input.slug,
            version: input.version,
            headHash: pull.headHash,
          });

          return pull;
        });

        projectTouchReporter.touch(input.slug);
        void workspaceStateReporter.reportSoon();
        if (shouldTriggerThumbnail) {
          thumbnailGenerationReporter.request(input.slug, input.version);
        }

        return {
          success: true,
          headHash: result.headHash,
          previousHeadHash: result.previousHeadHash,
          message: `Pulled latest from GitHub (${result.headHash.slice(0, 7)})`,
        };
      } catch (err) {
        const message = sanitizeGitAuthFromMessage(
          err instanceof Error ? err.message : String(err),
        );
        throw new Error(message);
      }
    }),

  gitHubForceSync: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGitHubSyncAllowed(ctx);
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const info = getGitHubSyncProjectInfo({
        slug: input.slug,
        version: input.version,
      });
      if (!info.enabled) {
        throw new Error("GitHub sync is disabled.");
      }
      if (!info.configured) {
        throw new Error(info.error);
      }

      const projectDir = ctx.workspace.getProjectPath();
      let shouldTriggerThumbnail = false;

      try {
        const result = await withBucketSyncPaused(async () => {
          const sync = await ctx.workspace.forceSyncFromRemote({
            remoteName: info.remoteName,
            remoteUrl: info.remoteUrl,
            remoteBranch: "main",
            authHeader: info.httpAuthHeader,
          });

          shouldTriggerThumbnail = await syncRemoteArtifacts({
            projectDir,
            slug: input.slug,
            version: input.version,
            headHash: sync.headHash,
            exact: true,
          });

          return sync;
        });

        projectTouchReporter.touch(input.slug);
        void workspaceStateReporter.reportSoon();
        if (shouldTriggerThumbnail) {
          thumbnailGenerationReporter.request(input.slug, input.version);
        }

        return {
          success: true,
          headHash: result.headHash,
          backupTag: result.backupTag,
          backupCommitHash: result.backupCommitHash,
          message: `Force-synced from GitHub (${result.headHash.slice(0, 7)})`,
        };
      } catch (err) {
        const message = sanitizeGitAuthFromMessage(
          err instanceof Error ? err.message : String(err),
        );
        throw new Error(message);
      }
    }),
};
