import { protectedProcedure } from "../../trpc";
import { z } from "zod";
import {
  runTask,
  listSessions,
  listProjects,
  getSessionContent,
  deleteSession as deleteSessionFn,
  revertToUserMessage,
  unrevertSession,
  getSessionsStatus,
} from "../../opencode";
import {
  getProjectDir,
  getVersionDir,
  getCurrentVersion,
} from "../../generator/versionUtils";
import fs from "fs";
import { debugLog } from "./debug";

export const agentSessionProcedures = {
  runTask: protectedProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        task: z.string(),
        sessionId: z.string().optional(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const projectDir = getProjectDir(input.projectSlug);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      // Determine version and get version-specific path
      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);
      if (targetVersion === 0) {
        throw new Error("No versions found for this project");
      }

      const versionPath = getVersionDir(input.projectSlug, targetVersion);

      if (!fs.existsSync(versionPath)) {
        throw new Error(`Version ${targetVersion} not found for project`);
      }

      try {
        const { sessionId } = await runTask(
          input.task,
          versionPath,
          input.sessionId
        );
        return { success: true, sessionId, version: targetVersion };
      } catch (error: any) {
        console.error("Agent execution error:", error);
        throw new Error(error.message || "Failed to execute agent task");
      }
    }),

  listSessions: protectedProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Determine version and get version-specific path
        const targetVersion =
          input.version ?? getCurrentVersion(input.projectSlug);
        let directory: string;
        if (targetVersion > 0) {
          directory = getVersionDir(input.projectSlug, targetVersion);
        } else {
          directory = getProjectDir(input.projectSlug);
        }

        const sessions = await listSessions(directory);
        return sessions;
      } catch (error: any) {
        console.error("Failed to list sessions:", error);
        throw new Error(error.message || "Failed to list sessions");
      }
    }),

  listProjects: protectedProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const targetVersion =
          input.version ?? getCurrentVersion(input.projectSlug);
        let directory: string;
        if (targetVersion > 0) {
          directory = getVersionDir(input.projectSlug, targetVersion);
        } else {
          directory = getProjectDir(input.projectSlug);
        }
        const projects = await listProjects(directory);
        return projects;
      } catch (error: any) {
        console.error("Failed to list projects:", error);
        throw new Error(error.message || "Failed to list projects");
      }
    }),

  /**
   * Get the status of all sessions.
   * Returns a map of sessionId -> SessionStatus (idle/busy/retry)
   * Used by frontend to determine if a session is actively processing.
   */
  getSessionsStatus: protectedProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Compute the directory for this project/version
        const targetVersion =
          input.version ?? getCurrentVersion(input.projectSlug);
        let directory: string | undefined;
        if (targetVersion > 0) {
          directory = getVersionDir(input.projectSlug, targetVersion);
        } else {
          directory = getProjectDir(input.projectSlug);
        }

        debugLog(
          "[getSessionsStatus] Fetching status for directory:",
          directory
        );
        const statuses = await getSessionsStatus(directory);
        debugLog(
          "[getSessionsStatus] Statuses:",
          JSON.stringify(statuses, null, 2)
        );
        return statuses;
      } catch (error: any) {
        console.error("Failed to get sessions status:", error);
        throw new Error(error.message || "Failed to get sessions status");
      }
    }),

  getSessionContent: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const targetVersion =
          input.version ?? getCurrentVersion(input.projectSlug);
        let directory: string;
        if (targetVersion > 0) {
          directory = getVersionDir(input.projectSlug, targetVersion);
        } else {
          directory = getProjectDir(input.projectSlug);
        }
        const content = await getSessionContent(input.sessionId, directory);
        return content;
      } catch (error: any) {
        console.error("Failed to get session content:", error);
        throw new Error(error.message || "Failed to get session content");
      }
    }),

  deleteSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);
      let directory: string;
      if (targetVersion > 0) {
        directory = getVersionDir(input.projectSlug, targetVersion);
      } else {
        directory = getProjectDir(input.projectSlug);
      }

      try {
        await deleteSessionFn(input.sessionId, directory);
        return { success: true };
      } catch (error: any) {
        console.error("Failed to delete session:", error);
        throw new Error(error.message || "Failed to delete session");
      }
    }),

  revertToMessage: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        messageId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      console.log("[Revert] Attempting to revert to user message:", {
        sessionId: input.sessionId,
        userMessageId: input.messageId,
        projectSlug: input.projectSlug,
      });

      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);
      let directory: string;
      if (targetVersion > 0) {
        directory = getVersionDir(input.projectSlug, targetVersion);
      } else {
        directory = getProjectDir(input.projectSlug);
      }

      try {
        const result = await revertToUserMessage(
          input.sessionId,
          input.messageId,
          directory
        );
        console.log("[Revert] Revert completed:", result);
        return { success: true, ...result };
      } catch (error: any) {
        console.error("[Revert] Failed to revert session:", error);
        throw new Error(error.message || "Failed to revert session");
      }
    }),

  unrevertSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      console.log(
        "[Unrevert] Attempting to unrevert session:",
        input.sessionId
      );

      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);
      let directory: string;
      if (targetVersion > 0) {
        directory = getVersionDir(input.projectSlug, targetVersion);
      } else {
        directory = getProjectDir(input.projectSlug);
      }

      try {
        const result = await unrevertSession(input.sessionId, directory);
        console.log("[Unrevert] Unrevert successful, result:", result);
        return { success: true };
      } catch (error: any) {
        console.error("[Unrevert] Failed to unrevert session:", error);
        throw new Error(error.message || "Failed to unrevert session");
      }
    }),
};
