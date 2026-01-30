import { z } from "zod";
import { tracked } from "@trpc/server";
import { router, publicProcedure } from "../trpc/trpc.js";
import {
  abortSession,
  agentEventEmitter,
  deleteSession,
  getAvailableModels,
  getSessionContent,
  getSessionsStatus,
  listProjects,
  listSessions,
  revertToUserMessage,
  runTask,
  unrevertSession,
} from "../opencode/index.js";
import { validateModelSelection } from "../opencode/modelConfig.js";

function getWorkspaceDir(ctx: { workspace: { isInitialized(): boolean; getProjectPath(): string } }): string {
  if (!ctx.workspace.isInitialized()) {
    throw new Error("Workspace not initialized");
  }
  return ctx.workspace.getProjectPath();
}

export const agentRouter = router({
  getAvailableModels: publicProcedure.query(async () => {
    return getAvailableModels();
  }),

  runTask: publicProcedure
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
    .mutation(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);

      const validatedModel = input.model
        ? validateModelSelection(input.model) ?? input.model
        : undefined;

      const result = await runTask(
        input.task,
        directory,
        input.sessionId,
        validatedModel,
      );

      return { success: true, sessionId: result.sessionId, version: input.version ?? 1 };
    }),

  listSessions: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .query(async ({ ctx }) => {
      const directory = getWorkspaceDir(ctx);
      return await listSessions(directory);
    }),

  listProjects: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .query(async ({ ctx }) => {
      const directory = getWorkspaceDir(ctx);
      return await listProjects(directory);
    }),

  getSessionsStatus: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .query(async ({ ctx }) => {
      const directory = getWorkspaceDir(ctx);
      return await getSessionsStatus(directory);
    }),

  getSessionContent: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);
      return await getSessionContent(input.sessionId, directory);
    }),

  deleteSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);
      await deleteSession(input.sessionId, directory);
      return { success: true };
    }),

  revertToMessage: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        messageId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);
      const result = await revertToUserMessage(
        input.sessionId,
        input.messageId,
        directory,
      );
      return { success: true, ...result };
    }),

  unrevertSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);
      await unrevertSession(input.sessionId, directory);
      return { success: true };
    }),

  abortSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);
      await abortSession(input.sessionId, directory);
      return { success: true };
    }),

  sessionEvents: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        lastEventId: z.string().optional(),
      }),
    )
    .subscription(async function* ({ input, signal }) {
      const eventStream = agentEventEmitter.createSessionStream(
        input.sessionId,
        signal,
        input.lastEventId,
      );

      for await (const event of eventStream) {
        yield tracked(event.eventId, event);
      }
    }),
});

