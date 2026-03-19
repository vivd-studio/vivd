import { tracked } from "@trpc/server";
import { z } from "zod";
import {
  getSessionContent,
  getMessageDiff,
  getSessionsStatus,
  listQuestions,
  listSessions,
  rejectQuestion,
  replyQuestion,
} from "../opencode/index.js";
import { canonicalEventBridge } from "../opencode/events/canonicalEventBridge.js";
import { workspaceEventPump } from "../opencode/events/workspaceEventPump.js";
import { router, publicProcedure } from "../trpc/trpc.js";
import { getWorkspaceDir } from "./workspaceDir.js";

export const agentChatRouter = router({
  bootstrap: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
        sessionId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const directory = getWorkspaceDir(ctx);
      const [sessions, statuses, questions, messages] = await Promise.all([
        listSessions(directory),
        getSessionsStatus(directory),
        listQuestions(directory),
        input.sessionId
          ? getSessionContent(input.sessionId, directory)
          : Promise.resolve([]),
      ]);

      return {
        sessions,
        statuses,
        questions,
        messages,
      };
    }),

  replyQuestion: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
        requestId: z.string(),
        answers: z.array(z.array(z.string())),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const directory = getWorkspaceDir(ctx);
      await replyQuestion(input.requestId, input.answers, directory);
      return true;
    }),

  rejectQuestion: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
        requestId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const directory = getWorkspaceDir(ctx);
      await rejectQuestion(input.requestId, directory);
      return true;
    }),

  sessionMessages: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
        sessionId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const directory = getWorkspaceDir(ctx);
      return getSessionContent(input.sessionId, directory);
    }),

  messageDiff: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
        sessionId: z.string(),
        messageId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const directory = getWorkspaceDir(ctx);
      return getMessageDiff(input.sessionId, input.messageId, directory);
    }),

  events: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
        lastEventId: z.string().optional(),
      }),
    )
    .subscription(async function* ({ ctx, input, signal }) {
      const directory = getWorkspaceDir(ctx);
      const release = await workspaceEventPump.acquire(directory);

      try {
        const eventStream = canonicalEventBridge.createWorkspaceStream(
          directory,
          signal,
          input.lastEventId,
        );

        for await (const event of eventStream) {
          yield tracked(event.eventId, event);
        }
      } finally {
        release();
      }
    }),
});
