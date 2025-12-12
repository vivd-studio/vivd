import { router, publicProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import {
  runTask,
  listSessions,
  listProjects,
  getSessionContent,
} from "../opencode";
import path from "path";
import fs from "fs";

// Assuming projects are stored in a standard location similar to other routers.
// I need to verify where projects are stored. Typically 'generated/<slug>'.
const GENERATED_PROJECTS_DIR = path.join(process.cwd(), "generated");

export const agentRouter = router({
  runTask: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        task: z.string(),
        sessionId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const projectPath = path.join(GENERATED_PROJECTS_DIR, input.projectSlug);

      // Basic security check to prevent directory traversal
      if (!projectPath.startsWith(GENERATED_PROJECTS_DIR)) {
        throw new Error("Invalid project path");
      }

      if (!fs.existsSync(projectPath)) {
        throw new Error("Project not found");
      }

      try {
        const { output, sessionId } = await runTask(
          input.task,
          projectPath,
          input.sessionId
        );
        return { success: true, output, sessionId };
      } catch (error: any) {
        console.error("Agent execution error:", error);
        throw new Error(error.message || "Failed to execute agent task");
      }
    }),

  listSessions: adminProcedure.query(async () => {
    try {
      const sessions = await listSessions();
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
});
