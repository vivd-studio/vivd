import { adminProcedure } from "../../trpc";
import { z } from "zod";
import { tracked } from "@trpc/server";
import { agentEventEmitter } from "../../opencode";
import { debugLog } from "./debug";

export const agentSubscriptionProcedures = {
  /**
   * SSE subscription for real-time agent session events.
   * Uses tRPC's async generator pattern for SSE support.
   * Clients can reconnect using lastEventId to resume from where they left off.
   */
  sessionEvents: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        // Optional: last event ID for resumable streams
        lastEventId: z.string().optional(),
      })
    )
    .subscription(async function* ({ input, signal }) {
      debugLog(
        `[SessionEvents] Client subscribed to session: ${input.sessionId}`
      );

      // Use the event emitter's async generator to yield events
      const eventStream = agentEventEmitter.createSessionStream(
        input.sessionId,
        signal,
        input.lastEventId
      );

      try {
        for await (const event of eventStream) {
          // Use tracked() to enable resumable streams with event IDs
          yield tracked(event.eventId, event);
        }
      } finally {
        debugLog(
          `[SessionEvents] Client unsubscribed from session: ${input.sessionId}`
        );
      }
    }),
};
