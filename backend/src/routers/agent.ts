import { router, protectedProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import {
  runTask,
  listSessions,
  listProjects,
  getSessionContent,
  deleteSession as deleteSessionFn,
} from "../opencode";
import {
  getProjectDir,
  getVersionDir,
  getCurrentVersion,
} from "../generator/versionUtils";
import fs from "fs";

export const agentRouter = router({
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

  listSessions: adminProcedure
    .input(
      z.object({
        projectSlug: z.string().optional(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        let directory: string | undefined;
        if (input.projectSlug) {
          // Determine version and get version-specific path
          const targetVersion =
            input.version ?? getCurrentVersion(input.projectSlug);
          if (targetVersion > 0) {
            directory = getVersionDir(input.projectSlug, targetVersion);
          } else {
            directory = getProjectDir(input.projectSlug);
          }
        }

        const sessions = await listSessions(directory);
        return sessions;
      } catch (error: any) {
        console.error("Failed to list sessions:", error);
        throw new Error(error.message || "Failed to list sessions");
      }
    }),

  listProjects: adminProcedure.query(async () => {
    try {
      const projects = await listProjects();
      return projects;
    } catch (error: any) {
      console.error("Failed to list projects:", error);
      throw new Error(error.message || "Failed to list projects");
    }
  }),

  getSessionContent: adminProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      try {
        const content = await getSessionContent(input.sessionId);
        return content;
      } catch (error: any) {
        console.error("Failed to get session content:", error);
        throw new Error(error.message || "Failed to get session content");
      }
    }),

  deleteSession: adminProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        await deleteSessionFn(input.sessionId);
        return { success: true };
      } catch (error: any) {
        console.error("Failed to delete session:", error);
        throw new Error(error.message || "Failed to delete session");
      }
    }),
});
