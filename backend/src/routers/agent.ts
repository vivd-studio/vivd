import { router, publicProcedure } from "../trpc";
import { z } from "zod";
import { runTask } from "../opencode";
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
});
