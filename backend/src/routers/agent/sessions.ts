import { adminProcedure } from "../../trpc";
import { z } from "zod";
import {
  runTask,
  listSessions,
  listProjects,
  getSessionContent,
  deleteSession as deleteSessionFn,
  abortSession as abortSessionFn,
  revertToUserMessage,
  unrevertSession,
  getSessionsStatus,
  getAvailableModels,
} from "../../opencode";
import {
  getProjectDir,
  getVersionDir,
  getCurrentVersion,
} from "../../generator/versionUtils";
import fs from "fs";
import { debugLog } from "./debug";
import { limitsService } from "../../services/LimitsService";

export const agentSessionProcedures = {
  runTask: adminProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        task: z.string(),
        sessionId: z.string().optional(),
        version: z.number().optional(),
        model: z
          .object({
            provider: z.string(),
            modelId: z.string(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Check usage limits before allowing agent task to run
      await limitsService.assertNotBlocked();

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
          input.sessionId,
          input.model,
        );
        return { success: true, sessionId, version: targetVersion };
      } catch (error: any) {
        console.error("Agent execution error:", error);
        throw new Error(error.message || "Failed to execute agent task");
      }
    }),

  listSessions: adminProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
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

  listProjects: adminProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
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
  getSessionsStatus: adminProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
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
          directory,
        );
        const statuses = await getSessionsStatus(directory);
        debugLog(
          "[getSessionsStatus] Statuses:",
          JSON.stringify(statuses, null, 2),
        );
        return statuses;
      } catch (error: any) {
        console.error("Failed to get sessions status:", error);
        throw new Error(error.message || "Failed to get sessions status");
      }
    }),

  getSessionContent: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
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

  deleteSession: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
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

  revertToMessage: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        messageId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
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
          directory,
        );
        console.log("[Revert] Revert completed:", result);
        return { success: true, ...result };
      } catch (error: any) {
        console.error("[Revert] Failed to revert session:", error);
        throw new Error(error.message || "Failed to revert session");
      }
    }),

  unrevertSession: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      console.log(
        "[Unrevert] Attempting to unrevert session:",
        input.sessionId,
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

  /**
   * Get available OpenCode models for the model selector.
   * Returns an empty array if only one model is configured (no selection needed).
   */
  getAvailableModels: adminProcedure.query(async () => {
    const models = getAvailableModels();
    // Only return models if there are multiple to choose from
    return models.length > 1 ? models : [];
  }),

  /**
   * Abort/stop an active session's generation.
   */
  abortSession: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
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
        await abortSessionFn(input.sessionId, directory);
        return { success: true };
      } catch (error: any) {
        console.error("Failed to abort session:", error);
        throw new Error(error.message || "Failed to abort session");
      }
    }),
};
