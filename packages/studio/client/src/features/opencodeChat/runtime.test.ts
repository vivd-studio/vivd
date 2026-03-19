import { describe, expect, it } from "vitest";
import {
  buildDerivedSessionError,
  deriveChatActivityState,
  selectSessionActivitySummary,
  selectMostRecentActiveSessionId,
  selectMostRecentAttentionSessionId,
} from "./runtime";
import type { OpenCodeSessionMessageRecord, OpenCodeSessionStatus } from "./types";

function createMessage(
  input: Partial<OpenCodeSessionMessageRecord["info"]> & {
    id: string;
    role: string;
  },
): OpenCodeSessionMessageRecord {
  return {
    info: {
      id: input.id,
      sessionID: input.sessionID ?? "sess-1",
      role: input.role,
      time: input.time,
    },
    parts: [],
  };
}

describe("opencodeChat runtime", () => {
  it("derives streaming from pending assistant output even if the session status already looks terminal", () => {
    const state = deriveChatActivityState({
      messages: [
        createMessage({ id: "u1", role: "user" }),
        createMessage({ id: "a1", role: "assistant" }),
      ],
      sessionStatus: { type: "done" },
      hasOptimisticUserMessage: false,
      isSubmitting: false,
    });

    expect(state.isStreaming).toBe(true);
    expect(state.isWaiting).toBe(false);
    expect(state.isThinking).toBe(true);
  });

  it("derives waiting while the session is active but no assistant message has arrived yet", () => {
    const state = deriveChatActivityState({
      messages: [createMessage({ id: "u1", role: "user" })],
      sessionStatus: { type: "busy" },
      hasOptimisticUserMessage: false,
      isSubmitting: false,
    });

    expect(state.isStreaming).toBe(false);
    expect(state.isWaiting).toBe(true);
    expect(state.isThinking).toBe(true);
  });

  it("derives a safe stream error when the canonical connection fails during an active session", () => {
    const error = buildDerivedSessionError({
      selectedSessionId: "sess-1",
      messages: [],
      sessionMessagesIsError: false,
      sessionMessagesError: null,
      sessionStatus: { type: "busy" },
      connectionState: "error",
      connectionMessage: "socket gone",
    });

    expect(error?.error.type).toBe("stream");
    expect(error?.error.message).toContain("Live updates were interrupted");
  });

  it("derives a safe stream error when a pending assistant message exists after the session status has already gone terminal", () => {
    const error = buildDerivedSessionError({
      selectedSessionId: "sess-1",
      messages: [
        createMessage({ id: "u1", role: "user" }),
        createMessage({ id: "a1", role: "assistant" }),
      ],
      sessionMessagesIsError: false,
      sessionMessagesError: null,
      sessionStatus: { type: "done" },
      connectionState: "error",
      connectionMessage: "socket gone",
    });

    expect(error?.error.type).toBe("stream");
    expect(error?.error.message).toContain("Live updates were interrupted");
  });

  it("selects the most recent active session", () => {
    const sessionStatusById: Record<string, OpenCodeSessionStatus> = {
      "sess-1": { type: "done" },
      "sess-2": { type: "busy" },
      "sess-3": { type: "retry", attempt: 2 },
    };

    const selected = selectMostRecentActiveSessionId({
      sessions: [
        { id: "sess-1", time: { updated: 10 } },
        { id: "sess-2", time: { updated: 20 } },
        { id: "sess-3", time: { updated: 30 } },
      ],
      sessionStatusById,
    });

    expect(selected).toBe("sess-3");
  });

  it("builds a shared activity summary from active session statuses", () => {
    const summary = selectSessionActivitySummary({
      sessions: [
        { id: "sess-1", time: { updated: 30 } },
        { id: "sess-2", time: { updated: 20 } },
        { id: "sess-3", time: { updated: 10 } },
      ],
      sessionStatusById: {
        "sess-1": { type: "busy" },
        "sess-2": { type: "retry", attempt: 2 },
        "sess-3": { type: "done" },
      },
      selectedSessionId: "sess-1",
    });

    expect(summary.activeSessionIds).toEqual(["sess-1", "sess-2"]);
    expect(summary.selectedSessionIsActive).toBe(true);
    expect(summary.otherActiveSessionIds).toEqual(["sess-2"]);
    expect(summary.otherActiveSessionCount).toBe(1);
    expect(summary.hasAnyActiveSession).toBe(true);
    expect(summary.hasOtherActiveSessions).toBe(true);
  });

  it("excludes the selected session from other-active state and ignores idle/done sessions", () => {
    const summary = selectSessionActivitySummary({
      sessions: [
        { id: "sess-1", time: { updated: 20 } },
        { id: "sess-2", time: { updated: 10 } },
      ],
      sessionStatusById: {
        "sess-1": { type: "busy" },
        "sess-2": { type: "idle" },
      },
      selectedSessionId: "sess-1",
    });

    expect(summary.activeSessionIds).toEqual(["sess-1"]);
    expect(summary.selectedSessionIsActive).toBe(true);
    expect(summary.otherActiveSessionIds).toEqual([]);
    expect(summary.otherActiveSessionCount).toBe(0);
    expect(summary.hasOtherActiveSessions).toBe(false);
  });

  it("selects the most recent session needing attention when a question is pending", () => {
    const selected = selectMostRecentAttentionSessionId({
      sessions: [
        { id: "sess-1", time: { updated: 10 } },
        { id: "sess-2", time: { updated: 20 } },
      ],
      sessionStatusById: {
        "sess-1": { type: "done" },
        "sess-2": { type: "idle" },
      },
      questionRequestsBySessionId: {
        "sess-2": [{ id: "que-1", sessionID: "sess-2", questions: [] }],
      },
    });

    expect(selected).toBe("sess-2");
  });
});
