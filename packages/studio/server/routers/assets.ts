import { z } from "zod";
import { router, publicProcedure } from "../trpc/trpc.js";
import fs from "fs-extra";
import path from "path";

export const assetsRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          directory: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return { files: [], directories: [] };
      }

      const projectPath = ctx.workspace.getProjectPath();
      const targetDir = input?.directory
        ? path.join(projectPath, input.directory)
        : projectPath;

      try {
        const entries = await fs.readdir(targetDir, { withFileTypes: true });

        const files: string[] = [];
        const directories: string[] = [];

        for (const entry of entries) {
          // Skip hidden files and common non-asset directories
          if (
            entry.name.startsWith(".") ||
            entry.name === "node_modules" ||
            entry.name === "dist"
          ) {
            continue;
          }

          if (entry.isDirectory()) {
            directories.push(entry.name);
          } else {
            files.push(entry.name);
          }
        }

        return { files, directories };
      } catch {
        return { files: [], directories: [] };
      }
    }),

  read: publicProcedure
    .input(
      z.object({
        filePath: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const projectPath = ctx.workspace.getProjectPath();
      const fullPath = path.join(projectPath, input.filePath);

      // Security: ensure path is within project
      if (!fullPath.startsWith(projectPath)) {
        throw new Error("Invalid file path");
      }

      const content = await fs.readFile(fullPath, "utf-8");
      return { content };
    }),
});
