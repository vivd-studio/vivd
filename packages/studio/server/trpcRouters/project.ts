import { router, publicProcedure } from "../trpc/trpc.js";
import { z } from "zod";
import { simpleGit } from "simple-git";
import { devServerService } from "../services/project/DevServerService.js";
import { detectProjectType } from "../services/project/projectType.js";
import {
  buildAndUploadPreview,
  buildAndUploadPublished,
  syncSourceToBucket,
} from "../services/sync/ArtifactSyncService.js";
import {
  checkGitHubRepoExists,
  getGitHubSyncProjectInfo,
  sanitizeGitAuthFromMessage,
  syncPushToGitHub,
  type GitHubSyncResult,
} from "../services/integrations/GitHubSyncService.js";
import { withBucketSyncPaused } from "../services/sync/SyncPauseService.js";
import { projectTouchReporter } from "../services/reporting/ProjectTouchReporter.js";
import { thumbnailGenerationReporter } from "../services/reporting/ThumbnailGenerationReporter.js";
import { workspaceStateReporter } from "../services/reporting/WorkspaceStateReporter.js";
import { requestBucketSync } from "../services/sync/AgentTaskSyncService.js";
import type { Context } from "../trpc/context.js";
import {
  isConnectedMode,
} from "@vivd/shared";
import { previewProjectProcedures } from "./project.preview.js";
import {
  callConnectedBackendMutation,
  callConnectedBackendQuery,
} from "./project.shared.js";

function readEnabledPluginsFromEnv(): string[] {
  const raw = (process.env.VIVD_ENABLED_PLUGINS || "").trim();
  if (!raw) return [];
  const unique = new Set<string>();
  for (const entry of raw.split(",")) {
    const normalized = entry.trim();
    if (!normalized) continue;
    unique.add(normalized);
  }
  return Array.from(unique);
}

function readSupportEmailFromEnv(): string | null {
  const value = (process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL || "").trim();
  return value || null;
}

function readProjectSlugFromEnv(): string | null {
  const value = (process.env.VIVD_PROJECT_SLUG || "").trim();
  return value || null;
}

interface ConnectedProjectListRow {
  slug: string;
  status: string;
  url: string | null;
  source: "url" | "scratch";
  title: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  totalVersions: number;
  versions: Array<{ version: number; status: string }>;
  publishedDomain: string | null;
  publishedVersion: number | null;
  thumbnailUrl: string | null;
  publicPreviewEnabled?: boolean;
  enabledPlugins?: string[];
}

type ConnectedPublishState = {
  storageEnabled: boolean;
  readiness: "ready" | "build_in_progress" | "artifact_not_ready" | string;
  sourceKind: string;
  framework: string;
  publishableCommitHash: string | null;
  lastSyncedCommitHash: string | null;
  builtAt: string | null;
  sourceBuiltAt: string | null;
  previewBuiltAt: string | null;
  error: string | null;
  studioRunning: boolean;
  studioStateAvailable: boolean;
  studioHasUnsavedChanges: boolean;
  studioHeadCommitHash: string | null;
  studioWorkingCommitHash: string | null;
  studioStateReportedAt: string | null;
};

type ConnectedPublishChecklist = {
  checklist: {
    summary: {
      passed: number;
      failed: number;
      warnings: number;
      skipped: number;
      fixed?: number;
    };
    items: Array<unknown>;
  } | null;
  stale: boolean;
  reason: "missing" | "project_updated" | "hash_mismatch" | null;
};

type ConnectedCheckDomainResult = {
  available: boolean;
  normalizedDomain: string;
  error?: string;
};

type ConnectedPublishTargetsResult = {
  projectSlug: string;
  currentPublishedDomain: string | null;
  recommendedDomain: string | null;
  targets: Array<{
    domain: string;
    usage: "tenant_host" | "publish_target";
    type: "managed_subdomain" | "custom_domain" | "implicit_primary_host";
    status: "active" | "disabled" | "pending_verification" | "implicit";
    current: boolean;
    primaryHost: boolean;
    available: boolean;
    blockedReason?: string;
    url: string;
    recommended: boolean;
  }>;
};

async function getGitHubSyncUiGate(
  ctx: Context,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!isConnectedMode()) return { allowed: true };
  try {
    const config = await callConnectedBackendQuery<{
      isSuperAdminUser?: boolean;
    }>(ctx, "config.getAppConfig", {});
    if (config?.isSuperAdminUser) return { allowed: true };
    return { allowed: false, reason: "GitHub sync is super-admin only." };
  } catch {
    return { allowed: false, reason: "GitHub sync is super-admin only." };
  }
}

async function getConnectedSupportEmail(ctx: Context): Promise<string | null> {
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

async function assertGitHubSyncAllowed(ctx: Context): Promise<void> {
  const gate = await getGitHubSyncUiGate(ctx);
  if (!gate.allowed) {
    throw new Error(gate.reason || "GitHub sync is super-admin only.");
  }
}

export const projectRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    let supportEmail = readSupportEmailFromEnv();
    const runtimeProjectSlug = readProjectSlugFromEnv() ?? "studio";
    if (!ctx.workspace.isInitialized()) {
      return { projects: [], supportEmail };
    }

    const connectedProjectSlug = readProjectSlugFromEnv();
    if (isConnectedMode() && connectedProjectSlug) {
      supportEmail = (await getConnectedSupportEmail(ctx)) ?? supportEmail;
      try {
        const connectedProjects = await callConnectedBackendQuery<{
          projects?: ConnectedProjectListRow[];
        }>(ctx, "project.list", {});
        const connectedProject = connectedProjects.projects?.find(
          (project) => project.slug === connectedProjectSlug,
        );

        if (connectedProject) {
          return {
            supportEmail,
            projects: [connectedProject],
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[Studio project.list] Falling back to runtime env plugins for ${connectedProjectSlug}: ${message}`,
        );
      }
    }

    const enabledPlugins = readEnabledPluginsFromEnv();

    return {
      supportEmail,
      projects: [
        {
          slug: runtimeProjectSlug,
          status: "completed",
          url: null,
          source: "scratch",
          title: runtimeProjectSlug,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentVersion: 1,
          totalVersions: 1,
          versions: [{ version: 1, status: "completed" }],
          publishedDomain: null,
          publishedVersion: null,
          thumbnailUrl: null,
          enabledPlugins,
        },
      ],
    };
  }),
  ...previewProjectProcedures,

  getVersions: publicProcedure.query(async () => ({
    versions: [
      {
        version: 0,
        status: "current",
        description: "Working copy",
      },
    ],
    totalVersions: 1,
  })),

  gitHasChanges: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ ctx }) => {
      try {
        const changedFiles = await ctx.workspace.getChangedFiles();
        return {
          hasChanges: changedFiles.length > 0,
          changedFiles,
        };
      } catch (err) {
        console.error("Error checking git status:", err);
        return { hasChanges: false, changedFiles: [] as string[] };
      }
    }),

  gitHistory: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ ctx }) => {
      try {
        const [history, totalCommits] = await Promise.all([
          ctx.workspace.getHistory(),
          ctx.workspace.getCommitCount(),
        ]);
        return {
          commits: history ?? [],
          totalCommits,
        };
      } catch (err) {
        console.error("Error fetching git history:", err);
        return { commits: [], totalCommits: 0 };
      }
    }),

  gitSave: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        message: z.string().min(1, "Commit message is required"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const hash = await ctx.workspace.commit(input.message);
      const projectDir = ctx.workspace.getProjectPath();
      const headCommit = await ctx.workspace.getHeadCommit();
      const effectiveCommitHash = hash || headCommit?.hash || "";

      // Report state even on no-op saves so connected publish/history UIs can
      // observe cleared working-commit markers immediately.
      void workspaceStateReporter.reportSoon();

      if (!effectiveCommitHash) {
        return {
          success: true,
          hash: "",
          noChanges: true,
          github: { attempted: false, success: true } as const,
          message: "No changes to save",
        };
      }

      let github: GitHubSyncResult = { attempted: false, success: true };

      if (hash) {
        projectTouchReporter.touch(input.slug);

        github = await ctx.workspace.runExclusive("githubPush", async ({ cwd }) => {
          return await syncPushToGitHub({
            cwd,
            slug: input.slug,
            version: input.version,
          });
        });
      }

      const config = detectProjectType(projectDir);
      // Keep bucket-backed preview up to date (best-effort, async).
      if (config.framework === "astro") {
        const sourceSyncPromise = syncSourceToBucket({
          projectDir,
          slug: input.slug,
          version: input.version,
          commitHash: effectiveCommitHash,
        });

        void sourceSyncPromise.catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Artifacts] Source sync failed: ${msg}`);
        });

        void (async () => {
          try {
            await sourceSyncPromise;
          } catch {
            return;
          }

          await buildAndUploadPreview({
            projectDir,
            slug: input.slug,
            version: input.version,
            commitHash: effectiveCommitHash,
          });
          thumbnailGenerationReporter.request(input.slug, input.version);
        })()
          .then(() => {
            // no-op: local build path already requested thumbnail
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Artifacts] Preview build/upload failed: ${msg}`);
          });
      } else {
        void syncSourceToBucket({
          projectDir,
          slug: input.slug,
          version: input.version,
          commitHash: effectiveCommitHash,
        })
          .then(() => {
            thumbnailGenerationReporter.request(input.slug, input.version);
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Artifacts] Source sync failed: ${msg}`);
          });
      }

      return {
        success: true,
        hash: hash || "",
        noChanges: !hash,
        github,
        message: hash
          ? `Saved version with commit ${hash.substring(0, 7)}`
          : `No changes to save. Preparing artifacts for ${effectiveCommitHash.substring(0, 7)}`,
      };
    }),

  gitDiscardChanges: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      await ctx.workspace.discardChanges();
      projectTouchReporter.touch(input.slug);
      void workspaceStateReporter.reportSoon();
      requestBucketSync("project-discard-changes", {
        slug: input.slug,
        version: input.version,
      });

      return {
        success: true,
        message: "All changes discarded",
      };
    }),

  publishStatus: publicProcedure
    .input(
      z.object({
        slug: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (isConnectedMode()) {
        try {
          const result = await callConnectedBackendQuery<{
            isPublished: boolean;
            domain: string | null;
            commitHash: string | null;
            publishedAt: string | null;
            url: string | null;
            projectVersion?: number | null;
          }>(ctx, "project.publishStatus", { slug: input.slug });

          return {
            mode: "connected" as const,
            ...result,
            lastTag: null,
          };
        } catch (err) {
          console.error("Connected publish status failed:", err);
        }
      }

      try {
        const tags = await ctx.workspace.getTags?.();
        const lastTag = tags?.[0] || null;
        return {
          mode: "standalone" as const,
          isPublished: tags && tags.length > 0,
          lastTag: lastTag,
          domain: null,
          commitHash: null,
          publishedAt: null,
          url: null,
        };
      } catch (err) {
        console.error("Error fetching publish status:", err);
        return {
          mode: "standalone" as const,
          isPublished: false,
          lastTag: null,
          domain: null,
          commitHash: null,
          publishedAt: null,
          url: null,
        };
      }
    }),

  publishState: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (isConnectedMode()) {
        return await callConnectedBackendQuery<ConnectedPublishState>(ctx, "project.publishState", {
          slug: input.slug,
          version: input.version,
        });
      }

      const head = await ctx.workspace.getHeadCommit();
      return {
        storageEnabled: false,
        readiness: "ready" as const,
        sourceKind: "source" as const,
        framework: "generic" as const,
        publishableCommitHash: head?.hash || null,
        lastSyncedCommitHash: head?.hash || null,
        builtAt: null,
        sourceBuiltAt: null,
        previewBuiltAt: null,
        error: null,
        studioRunning: true,
        studioStateAvailable: true,
        studioHasUnsavedChanges: false,
        studioHeadCommitHash: head?.hash || null,
        studioWorkingCommitHash: null,
        studioStateReportedAt: new Date().toISOString(),
      };
    }),

  publishChecklist: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (isConnectedMode()) {
        return await callConnectedBackendQuery<ConnectedPublishChecklist>(
          ctx,
          "project.publishChecklist",
          {
            slug: input.slug,
            version: input.version,
          },
        );
      }

      return {
        checklist: null,
        stale: true,
        reason: "missing" as const,
      };
    }),

  publishTargets: publicProcedure
    .input(
      z.object({
        slug: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (isConnectedMode()) {
        return await callConnectedBackendQuery<ConnectedPublishTargetsResult>(
          ctx,
          "project.publishTargets",
          {
            slug: input.slug,
          },
        );
      }

      return {
        projectSlug: input.slug,
        currentPublishedDomain: null,
        recommendedDomain: null,
        targets: [],
      };
    }),

  checkDomain: publicProcedure
    .input(
      z.object({
        domain: z.string(),
        slug: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (isConnectedMode()) {
        return await callConnectedBackendQuery<ConnectedCheckDomainResult>(
          ctx,
          "project.checkDomain",
          {
            ...input,
            slug: input.slug ?? readProjectSlugFromEnv() ?? undefined,
          },
        );
      }

      const normalizedDomain = input.domain.toLowerCase().trim();
      return {
        available: true,
        normalizedDomain,
      };
    }),

  publish: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        domain: z.string(),
        expectedCommitHash: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isConnectedMode()) {
        throw new Error("Publishing via domain is available in connected mode only.");
      }

      return await callConnectedBackendMutation(ctx, "project.publish", input);
    }),

  unpublish: publicProcedure
    .input(
      z.object({
        slug: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isConnectedMode()) {
        throw new Error("Unpublish is available in connected mode only.");
      }
      return await callConnectedBackendMutation(ctx, "project.unpublish", input);
    }),

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
        return {
          uiAllowed: false,
          uiReason: gate.reason ?? "GitHub sync is super-admin only.",
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
          fetchError: null as string | null,
          pull: {
            allowed: false,
            reason: gate.reason ?? "GitHub sync is super-admin only.",
          },
          forceSync: {
            allowed: false,
            reason: gate.reason ?? "GitHub sync is super-admin only.",
          },
          lastFetchedAt: null as string | null,
        };
      }

      if (!ctx.workspace.isInitialized()) {
        return {
          uiAllowed: true,
          uiReason: null as string | null,
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
          fetchError: "Workspace not initialized",
          pull: {
            allowed: false,
            reason: "Workspace not initialized",
          },
          forceSync: {
            allowed: false,
            reason: "Workspace not initialized",
          },
          lastFetchedAt: null as string | null,
        };
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
          return { allowed: false, reason: "Your local branch has diverged from GitHub." };
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
      const config = detectProjectType(projectDir);
      let shouldTriggerThumbnail = false;

      try {
        const result = await withBucketSyncPaused(async () => {
          const pull = await ctx.workspace.pullFastForwardFromRemote({
            remoteName: info.remoteName,
            remoteUrl: info.remoteUrl,
            remoteBranch: "main",
            authHeader: info.httpAuthHeader,
          });

          await syncSourceToBucket({
            projectDir,
            slug: input.slug,
            version: input.version,
            commitHash: pull.headHash,
          });

          if (config.framework === "astro") {
            await buildAndUploadPreview({
              projectDir,
              slug: input.slug,
              version: input.version,
              commitHash: pull.headHash,
            });
            shouldTriggerThumbnail = true;
          }

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
      const config = detectProjectType(projectDir);
      let shouldTriggerThumbnail = false;

      try {
        const result = await withBucketSyncPaused(async () => {
          const sync = await ctx.workspace.forceSyncFromRemote({
            remoteName: info.remoteName,
            remoteUrl: info.remoteUrl,
            remoteBranch: "main",
            authHeader: info.httpAuthHeader,
          });

          await syncSourceToBucket({
            projectDir,
            slug: input.slug,
            version: input.version,
            commitHash: sync.headHash,
            exact: true,
          });

          if (config.framework === "astro") {
            await buildAndUploadPreview({
              projectDir,
              slug: input.slug,
              version: input.version,
              commitHash: sync.headHash,
            });
            shouldTriggerThumbnail = true;
          }

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

  gitWorkingCommit: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ ctx }) => {
      try {
        const workingHash = await ctx.workspace.getWorkingCommit();
        return { hash: workingHash };
      } catch (err) {
        console.error("Error fetching head commit:", err);
        return {
          hash: null,
        };
      }
    }),

  gitLoadVersion: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        commitHash: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const projectDir = ctx.workspace.getProjectPath();
      const config = detectProjectType(projectDir);
      const hadDevServer = config.mode === "devserver" && devServerService.hasServer();

      if (hadDevServer) {
        try {
          await devServerService.stopDevServer({ reason: "git-load-version" });
        } catch {
          // Best-effort only.
        }
      }

      await ctx.workspace.loadVersion(input.commitHash);
      projectTouchReporter.touch(input.slug);
      // Report state ASAP so connected publish checks see the loaded snapshot quickly.
      void workspaceStateReporter.reportSoon();

      if (hadDevServer) {
        try {
          await devServerService.restartDevServer(projectDir, "/", {
            resetCaches: true,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[DevServer] Failed to restart after loadVersion: ${msg}`);
        }
      }

      const shortHash = input.commitHash.substring(0, 7);
      return {
        success: true,
        message: `Loaded version ${shortHash}`,
      };
    }),

  gitLoadLatest: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const projectDir = ctx.workspace.getProjectPath();
      const config = detectProjectType(projectDir);
      const hadDevServer = config.mode === "devserver" && devServerService.hasServer();

      if (hadDevServer) {
        try {
          await devServerService.stopDevServer({ reason: "git-load-latest" });
        } catch {
          // Best-effort only.
        }
      }

      await ctx.workspace.loadLatest();
      projectTouchReporter.touch(input.slug);
      void workspaceStateReporter.reportSoon();

      if (hadDevServer) {
        try {
          await devServerService.restartDevServer(projectDir, "/", {
            resetCaches: true,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[DevServer] Failed to restart after loadLatest: ${msg}`);
        }
      }

      return {
        success: true,
        message: "Returned to the latest snapshot",
      };
    }),

  setCurrentVersion: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async () => ({
      success: true,
    })),

  setPublicPreviewEnabled: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isConnectedMode()) {
        throw new Error("Not available in standalone mode");
      }
      return await callConnectedBackendMutation<{
        publicPreviewEnabled: boolean;
      }>(ctx, "project.setPublicPreviewEnabled", input);
    }),

  regenerateThumbnail: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isConnectedMode()) {
        throw new Error("Not available in standalone mode");
      }
      return await callConnectedBackendMutation(ctx, "project.regenerateThumbnail", input);
    }),

  deleteProject: publicProcedure
    .input(
      z.object({
        slug: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isConnectedMode()) {
        throw new Error("Not available in standalone mode");
      }
      return await callConnectedBackendMutation(ctx, "project.delete", input);
    }),

  createTag: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        tagName: z.string(),
        message: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Create annotated git tag with optional message
        const git = simpleGit(ctx.workspace.getProjectPath());

        if (input.message) {
          await git.tag(["-a", input.tagName, "-m", input.message]);
        } else {
          await git.tag([input.tagName]);
        }

        const version = Math.max(
          1,
          Number.parseInt(process.env.VIVD_PROJECT_VERSION || "1", 10) || 1,
        );
        const commitHash = (await git.raw(["rev-parse", "HEAD"])).trim();
        const projectDir = ctx.workspace.getProjectPath();

        // Keep bucket-backed published artifacts up to date (best-effort, async).
        const sourceSyncPromise = syncSourceToBucket({
          projectDir,
          slug: input.slug,
          version,
          commitHash,
        });
        void sourceSyncPromise.catch(() => {});
        void (async () => {
          try {
            await sourceSyncPromise;
          } catch {
            return;
          }

          await buildAndUploadPublished({
            projectDir,
            slug: input.slug,
            version,
            commitHash,
          });
        })().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Artifacts] Published build/upload failed: ${msg}`);
        });

        projectTouchReporter.touch(input.slug);

        return {
          success: true,
          tag: input.tagName,
          message: `Created tag: ${input.tagName}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        throw new Error(`Failed to create tag: ${msg}`);
      }
    }),
});
