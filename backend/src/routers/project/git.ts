import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { getVersionDir } from "../../generator/versionUtils";
import { gitService } from "../../services/GitService";
import fs from "fs";

export const projectGitProcedures = {
  /**
   * Save current changes as a git commit.
   */
  gitSave: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        message: z.string().min(1, "Commit message is required"),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, message } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      const result = await gitService.save(versionDir, message);
      const github = await gitService.syncPushToGitHub({
        cwd: versionDir,
        slug,
        version,
      });

      if (result.noChanges) {
        return {
          success: true,
          hash: result.hash,
          noChanges: true,
          github,
          message: "No changes to save",
        };
      }

      return {
        success: result.success,
        hash: result.hash,
        noChanges: false,
        github,
        message: `Saved version with commit ${result.hash.substring(0, 7)}`,
      };
    }),

  /**
   * Get git commit history for a project version.
   */
  gitHistory: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        return { commits: [] };
      }

      const commits = await gitService.getHistory(versionDir);
      return { commits };
    }),

  /**
   * Load/restore files from a specific git commit.
   */
  gitLoadVersion: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        commitHash: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, commitHash } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      await gitService.loadVersion(versionDir, commitHash);
      return {
        success: true,
        message: `Restored to commit ${commitHash.substring(0, 7)}`,
      };
    }),

  /**
   * Check if there are uncommitted changes in a project version.
   */
  gitHasChanges: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        return { hasChanges: false };
      }

      const hasChanges = await gitService.hasUncommittedChanges(versionDir);
      return { hasChanges };
    }),

  /**
   * Get the current HEAD commit hash for a project version.
   */
  gitCurrentCommit: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        return { hash: null };
      }

      const hash = await gitService.getCurrentCommit(versionDir);
      return { hash };
    }),

  /**
   * Get the working commit (the commit whose files are in the working directory).
   * This may differ from HEAD if an older version was loaded.
   */
  gitWorkingCommit: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        return { hash: null };
      }

      // Get the working commit (from marker file if set, otherwise null)
      const workingHash = gitService.getWorkingCommit(versionDir);

      // If no marker, fall back to HEAD (current commit)
      if (!workingHash) {
        const headHash = await gitService.getCurrentCommit(versionDir);
        return { hash: headHash };
      }

      return { hash: workingHash };
    }),

  /**
   * Discard all uncommitted changes for a project version.
   */
  gitDiscardChanges: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      await gitService.discardChanges(versionDir);
      return {
        success: true,
        message: "All changes discarded",
      };
    }),
};
