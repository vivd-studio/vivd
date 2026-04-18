import { z } from "zod";
import { simpleGit } from "simple-git";
import { publicProcedure } from "../../trpc/trpc.js";
import { devServerService } from "../../services/project/DevServerService.js";
import { detectProjectType } from "../../services/project/projectType.js";
import {
  buildAndUploadPreview,
  buildAndUploadPublished,
  syncSourceToBucket,
} from "../../services/sync/ArtifactSyncService.js";
import {
  syncPushToGitHub,
  type GitHubSyncResult,
} from "../../services/integrations/GitHubSyncService.js";
import { projectTouchReporter } from "../../services/reporting/ProjectTouchReporter.js";
import { thumbnailGenerationReporter } from "../../services/reporting/ThumbnailGenerationReporter.js";
import { workspaceStateReporter } from "../../services/reporting/WorkspaceStateReporter.js";
import { requestBucketSync } from "../../services/sync/AgentTaskSyncService.js";
import type { Context } from "../../trpc/context.js";

function warnArtifacts(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[Artifacts] ${message}: ${detail}`);
}

function warnDevServer(action: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[DevServer] Failed to restart after ${action}: ${detail}`);
}

function queueSavedArtifacts(args: {
  projectDir: string;
  slug: string;
  version: number;
  commitHash: string;
  framework: string;
}): void {
  const sourceSyncPromise = syncSourceToBucket({
    projectDir: args.projectDir,
    slug: args.slug,
    version: args.version,
    commitHash: args.commitHash,
  });

  if (args.framework === "astro") {
    void sourceSyncPromise.catch((error) => {
      warnArtifacts("Source sync failed", error);
    });

    void (async () => {
      try {
        await sourceSyncPromise;
      } catch {
        return;
      }

      await buildAndUploadPreview({
        projectDir: args.projectDir,
        slug: args.slug,
        version: args.version,
        commitHash: args.commitHash,
      });
      thumbnailGenerationReporter.request(args.slug, args.version);
    })()
      .then(() => {
        // no-op: local build path already requested thumbnail
      })
      .catch((error) => {
        warnArtifacts("Preview build/upload failed", error);
      });

    return;
  }

  void sourceSyncPromise
    .then(() => {
      thumbnailGenerationReporter.request(args.slug, args.version);
    })
    .catch((error) => {
      warnArtifacts("Source sync failed", error);
    });
}

async function loadWorkspaceSnapshot(args: {
  ctx: Context;
  slug: string;
  stopReason: string;
  load: () => Promise<void>;
  successMessage: string;
  restartLabel: "loadVersion" | "loadLatest";
}): Promise<{ success: true; message: string }> {
  if (!args.ctx.workspace.isInitialized()) {
    throw new Error("Workspace not initialized");
  }

  const projectDir = args.ctx.workspace.getProjectPath();
  const config = detectProjectType(projectDir);
  const hadDevServer =
    config.mode === "devserver" && devServerService.hasServer();

  if (hadDevServer) {
    try {
      await devServerService.stopDevServer({ reason: args.stopReason });
    } catch {
      // Best-effort only.
    }
  }

  await args.load();
  projectTouchReporter.touch(args.slug);
  void workspaceStateReporter.reportSoon();

  if (hadDevServer) {
    try {
      await devServerService.restartDevServer(projectDir, "/", {
        resetCaches: true,
      });
    } catch (error) {
      warnDevServer(args.restartLabel, error);
    }
  }

  return {
    success: true,
    message: args.successMessage,
  };
}

export const projectGitProcedures = {
  gitHasChanges: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
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
      }),
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
      queueSavedArtifacts({
        projectDir,
        slug: input.slug,
        version: input.version,
        commitHash: effectiveCommitHash,
        framework: config.framework,
      });

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

  gitWorkingCommit: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const shortHash = input.commitHash.substring(0, 7);

      return await loadWorkspaceSnapshot({
        ctx,
        slug: input.slug,
        stopReason: "git-load-version",
        load: async () => {
          await ctx.workspace.loadVersion(input.commitHash);
        },
        successMessage: `Loaded version ${shortHash}`,
        restartLabel: "loadVersion",
      });
    }),

  gitLoadLatest: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return await loadWorkspaceSnapshot({
        ctx,
        slug: input.slug,
        stopReason: "git-load-latest",
        load: async () => {
          await ctx.workspace.loadLatest();
        },
        successMessage: "Returned to the latest snapshot",
        restartLabel: "loadLatest",
      });
    }),

  setCurrentVersion: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async () => ({
      success: true,
    })),

  createTag: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        tagName: z.string(),
        message: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const projectDir = ctx.workspace.getProjectPath();
        const git = simpleGit(projectDir);

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
        })().catch((error) => {
          warnArtifacts("Published build/upload failed", error);
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
};
