import { describe, expect, it } from "vitest";
import {
  buildDerivedSessionError,
  deriveChatActivityState,
  findStaleRunningToolState,
  selectLikelyActiveSessionIds,
  selectSessionActivitySummary,
  selectMostRecentActiveSessionId,
  selectMostRecentAttentionSessionId,
} from "./runtime";
import type { OpenCodeSessionMessageRecord, OpenCodeSessionStatus } from "./types";

function createMessage(
  input: Partial<OpenCodeSessionMessageRecord["info"]> & {
    id: string;
    role: string;
    parts?: any[];
  },
): OpenCodeSessionMessageRecord {
  return {
    info: {
      id: input.id,
      sessionID: input.sessionID ?? "sess-1",
      role: input.role,
      time: input.time,
    },
    parts: input.parts ?? [],
  };
}

describe("opencodeChat runtime", () => {
  it("does not keep a stale pending assistant shell streaming once the session status is terminal and the grace window has expired", () => {
    const now = Date.UTC(2026, 3, 1, 12, 0, 20);
    const state = deriveChatActivityState({
      messages: [
        createMessage({ id: "u1", role: "user", time: { created: now - 40_000 } }),
        createMessage({
          id: "a1",
          role: "assistant",
          time: { created: now - 30_000 },
        }),
      ],
      sessionStatus: { type: "done" },
      hasOptimisticUserMessage: false,
      isSubmitting: false,
      now,
    });

    expect(state.isStreaming).toBe(false);
    expect(state.isWaiting).toBe(false);
    expect(state.isThinking).toBe(false);
  });

  it("keeps streaming during the grace window when a pending assistant message is still fresh", () => {
    const now = Date.UTC(2026, 3, 1, 12, 0, 20);
    const state = deriveChatActivityState({
      messages: [
        createMessage({ id: "u1", role: "user", time: { created: now - 5_000 } }),
        createMessage({
          id: "a1",
          role: "assistant",
          time: { created: now - 3_000 },
        }),
      ],
      sessionStatus: { type: "done" },
      hasOptimisticUserMessage: false,
      isSubmitting: false,
      now,
    });

    expect(state.isStreaming).toBe(true);
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

  it("does not surface a stream error for a stale pending assistant shell after the session has already gone terminal", () => {
    const now = Date.UTC(2026, 3, 1, 12, 0, 20);
    const error = buildDerivedSessionError({
      selectedSessionId: "sess-1",
      messages: [
        createMessage({ id: "u1", role: "user", time: { created: now - 30_000 } }),
        createMessage({
          id: "a1",
          role: "assistant",
          time: { created: now - 20_000 },
        }),
      ],
      sessionMessagesIsError: false,
      sessionMessagesError: null,
      sessionStatus: { type: "done" },
      connectionState: "error",
      connectionMessage: "socket gone",
      now,
    });

    expect(error).toBeNull();
  });

  it("does not surface a load error when cached messages are already visible during a background refresh failure", () => {
    const error = buildDerivedSessionError({
      selectedSessionId: "sess-1",
      messages: [createMessage({ id: "a1", role: "assistant" })],
      sessionMessagesIsError: true,
      sessionMessagesError: new Error("Failed to load session"),
      sessionStatus: { type: "busy" },
      connectionState: "connected",
      connectionMessage: undefined,
    });

    expect(error).toBeNull();
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
      messagesById: {},
      messagesBySessionId: {},
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
      messagesById: {},
      messagesBySessionId: {},
      selectedSessionId: "sess-1",
    });

    expect(summary.activeSessionIds).toEqual(["sess-1"]);
    expect(summary.selectedSessionIsActive).toBe(true);
    expect(summary.otherActiveSessionIds).toEqual([]);
    expect(summary.otherActiveSessionCount).toBe(0);
    expect(summary.hasOtherActiveSessions).toBe(false);
  });

  it("treats a session with a cached pending assistant message as active even when its status looks idle", () => {
    const now = Date.UTC(2026, 3, 1, 12, 0, 20);
    const activeSessionIds = selectLikelyActiveSessionIds({
      sessions: [
        { id: "sess-1", time: { updated: 20 } },
        { id: "sess-2", time: { updated: 10 } },
      ],
      sessionStatusById: {
        "sess-1": { type: "idle" },
        "sess-2": { type: "done" },
      },
      messagesById: {
        "msg-1": {
          id: "msg-1",
          sessionID: "sess-1",
          role: "assistant",
          time: { created: now - 5_000 },
        },
      },
      messagesBySessionId: {
        "sess-1": ["msg-1"],
      },
    }, { now });

    expect(activeSessionIds).toEqual(["sess-1"]);
  });

  it("does not keep a stale cached pending assistant message active forever once it ages past the grace window", () => {
    const now = Date.UTC(2026, 3, 1, 12, 0, 20);
    const activeSessionIds = selectLikelyActiveSessionIds(
      {
        sessions: [{ id: "sess-1", time: { updated: 20 } }],
        sessionStatusById: {
          "sess-1": { type: "idle" },
        },
        messagesById: {
          "msg-1": {
            id: "msg-1",
            sessionID: "sess-1",
            role: "assistant",
            time: { created: now - 30_000 },
          },
        },
        messagesBySessionId: {
          "sess-1": ["msg-1"],
        },
      },
      { now },
    );

    expect(activeSessionIds).toEqual([]);
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

  it("detects a running tool on a completed assistant message as stale", () => {
    const stale = findStaleRunningToolState([
      createMessage({ id: "u1", role: "user" }),
      createMessage({
        id: "a1",
        role: "assistant",
        time: { created: 1, completed: 2 },
        parts: [{ id: "tool-1", type: "tool", status: "running" }],
      }),
    ]);

    expect(stale).toEqual({
      messageId: "a1",
      reason: "completed_message",
    });
  });

  it("detects a running tool on an older assistant message as stale once newer assistant activity exists", () => {
    const stale = findStaleRunningToolState([
      createMessage({ id: "u1", role: "user" }),
      createMessage({
        id: "a1",
        role: "assistant",
        time: { created: 1 },
        parts: [{ id: "tool-1", type: "tool", status: "running" }],
      }),
      createMessage({
        id: "a2",
        role: "assistant",
        time: { created: 2, completed: 3 },
        parts: [{ id: "text-1", type: "text", text: "Build finished." }],
      }),
    ]);

    expect(stale).toEqual({
      messageId: "a1",
      reason: "superseded_message",
    });
  });

  it("does not flag the latest active running tool as stale", () => {
    const stale = findStaleRunningToolState([
      createMessage({ id: "u1", role: "user" }),
      createMessage({
        id: "a1",
        role: "assistant",
        time: { created: 1 },
        parts: [{ id: "tool-1", type: "tool", status: "running" }],
      }),
    ]);

    expect(stale).toBeNull();
  });
});
