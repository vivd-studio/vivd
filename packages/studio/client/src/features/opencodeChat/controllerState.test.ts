import { describe, expect, it } from "vitest";
import {
  deriveOpencodeControllerState,
  findTerminalPendingAssistantMessageId,
} from "./controllerState";
import type { OpenCodeSessionMessageRecord } from "./types";

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

describe("opencodeChat controllerState", () => {
  it("falls back to the most recent attention session when none is selected", () => {
    const state = deriveOpencodeControllerState({
      sessions: [
        { id: "sess-1", time: { updated: 10 } },
        { id: "sess-2", time: { updated: 20 } },
      ],
      selectedSessionId: null,
      selectedMessages: [],
      sessionStatusById: {
        "sess-1": { type: "done" },
        "sess-2": { type: "idle" },
      },
      questionRequestsBySessionId: {
        "sess-2": [{ id: "que-1", sessionID: "sess-2", questions: [] }],
      },
      permissionRequestsBySessionId: {},
      selectedSessionStatus: null,
      selectedSessionIsError: false,
      selectedSessionError: null,
      connectionState: "connected",
      connectionMessage: undefined,
      hasOptimisticUserMessage: false,
      isSubmitting: false,
    });

    expect(state.attentionSessionId).toBe("sess-2");
    expect(state.activeQuestionRequest?.id).toBe("que-1");
    expect(state.hasBlockingRequest).toBe(true);
  });

  it("keeps unrelated requests out of the active state when another session is selected", () => {
    const state = deriveOpencodeControllerState({
      sessions: [
        { id: "sess-1", time: { updated: 20 } },
        { id: "sess-2", time: { updated: 10 } },
      ],
      selectedSessionId: "sess-1",
      selectedMessages: [],
      sessionStatusById: {
        "sess-1": { type: "idle" },
        "sess-2": { type: "done" },
      },
      questionRequestsBySessionId: {
        "sess-2": [{ id: "que-1", sessionID: "sess-2", questions: [] }],
      },
      permissionRequestsBySessionId: {},
      selectedSessionStatus: { type: "idle" },
      selectedSessionIsError: false,
      selectedSessionError: null,
      connectionState: "connected",
      connectionMessage: undefined,
      hasOptimisticUserMessage: false,
      isSubmitting: false,
    });

    expect(state.attentionSessionId).toBe("sess-2");
    expect(state.activeQuestionRequest).toBeNull();
    expect(state.hasBlockingRequest).toBe(false);
  });

  it("derives terminal pending-assistant activity for a selected session that still has an assistant shell", () => {
    const messages = [
      createMessage({ id: "u1", role: "user", time: { created: 1 } }),
      createMessage({
        id: "a1",
        role: "assistant",
        time: { created: 2 },
      }),
    ];

    const state = deriveOpencodeControllerState({
      sessions: [{ id: "sess-1", time: { updated: 20 } }],
      selectedSessionId: "sess-1",
      selectedMessages: messages,
      sessionStatusById: {
        "sess-1": { type: "done" },
      },
      questionRequestsBySessionId: {},
      permissionRequestsBySessionId: {},
      selectedSessionStatus: { type: "done" },
      selectedSessionIsError: false,
      selectedSessionError: null,
      connectionState: "connected",
      connectionMessage: undefined,
      hasOptimisticUserMessage: false,
      isSubmitting: false,
    });

    expect(state.terminalPendingAssistantMessageId).toBe("a1");
    expect(state.activityState.isStreaming).toBe(true);
    expect(state.sessionShowsRunActivity).toBe(true);
  });

  it("suppresses the terminal pending-assistant reconcile target once the selected session is locally suppressed", () => {
    const terminalMessageId = findTerminalPendingAssistantMessageId({
      selectedSessionId: "sess-1",
      selectedMessages: [
        createMessage({ id: "u1", role: "user", time: { created: 1 } }),
        createMessage({
          id: "a1",
          role: "assistant",
          time: { created: 2 },
        }),
      ],
      selectedSessionStatus: { type: "done" },
      suppressedSessionId: "sess-1",
    });

    expect(terminalMessageId).toBeNull();
  });
});
