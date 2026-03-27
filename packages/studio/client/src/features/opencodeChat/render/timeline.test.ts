import { describe, expect, it } from "vitest";
import {
  buildCanonicalTimelineModel,
  formatWorkedLabel,
  shouldSuggestInterruptedContinueFromRecords,
} from "./timeline";
import type { OpenCodeSessionMessageRecord } from "../types";

function createRecord(
  input: Partial<OpenCodeSessionMessageRecord["info"]> & {
    id: string;
    role: string;
    sessionID?: string;
    parentID?: string | null;
    createdAt?: number;
    completedAt?: number;
    parts?: any[];
  },
): OpenCodeSessionMessageRecord {
  return {
    info: {
      id: input.id,
      role: input.role,
      sessionID: input.sessionID ?? "sess-1",
      ...(input.parentID !== undefined ? { parentID: input.parentID } : {}),
      time:
        input.createdAt || input.completedAt
          ? {
              ...(input.createdAt ? { created: input.createdAt } : {}),
              ...(input.completedAt ? { completed: input.completedAt } : {}),
            }
          : undefined,
    },
    parts: input.parts ?? [],
  };
}

describe("canonical timeline builder", () => {
  const BASE_TIME = 1_700_000_000_000;

  it("renders a waiting agent row for an in-progress user turn with no actions", () => {
    const timeline = buildCanonicalTimelineModel({
      messages: [
        createRecord({
          id: "u1",
          role: "user",
          createdAt: BASE_TIME + 1000,
          parts: [{ id: "text-u1", type: "text", text: "Fix it" }],
        }),
      ],
      sessionStatus: { type: "busy" },
      isThinking: true,
      isWaiting: true,
    });

    const agentRow = timeline.items.find((item) => item.kind === "agent");
    expect(agentRow).toMatchObject({
      kind: "agent",
      runInProgress: true,
      showWorkedSection: false,
      fallbackState: "waiting",
    });
  });

  it("keeps the last assistant turn active while the session is busy", () => {
    const timeline = buildCanonicalTimelineModel({
      messages: [
        createRecord({
          id: "u1",
          role: "user",
          createdAt: BASE_TIME + 1000,
          parts: [{ id: "text-u1", type: "text", text: "Inspect file" }],
        }),
        createRecord({
          id: "a1",
          role: "assistant",
          parentID: "u1",
          createdAt: BASE_TIME + 1500,
          parts: [
            { id: "t1", type: "tool", tool: "read", status: "completed" },
            { id: "text-a1", type: "text", text: "Done" },
          ],
        }),
      ],
      sessionStatus: { type: "busy" },
      isThinking: true,
      isWaiting: false,
    });

    const agentRow = timeline.items.find(
      (item) => item.kind === "agent" && item.message?.id === "a1",
    );
    expect(agentRow).toMatchObject({
      kind: "agent",
      runInProgress: true,
      showWorkedSection: false,
    });
  });

  it("shows worked section for completed interleaved runs", () => {
    const timeline = buildCanonicalTimelineModel({
      messages: [
        createRecord({
          id: "u1",
          role: "user",
          createdAt: BASE_TIME + 1000,
          parts: [{ id: "text-u1", type: "text", text: "Do multi-step" }],
        }),
        createRecord({
          id: "a1",
          role: "assistant",
          parentID: "u1",
          createdAt: BASE_TIME + 5000,
          completedAt: BASE_TIME + 5000,
          parts: [
            { id: "tool-1", type: "tool", tool: "read", status: "completed" },
            { id: "text-1", type: "text", text: "I checked the file." },
            { id: "tool-2", type: "tool", tool: "edit", status: "completed" },
            { id: "text-2", type: "text", text: "I made the update." },
          ],
        }),
      ],
      sessionStatus: { type: "done" },
      isThinking: false,
      isWaiting: false,
    });

    const agentRow = timeline.items.find((item) => item.kind === "agent");
    expect(agentRow).toMatchObject({
      kind: "agent",
      hasInterleavedParts: true,
      showWorkedSection: true,
      runInProgress: false,
    });
  });

  it("folds a trailing thought after the final response back into the worked section", () => {
    const timeline = buildCanonicalTimelineModel({
      messages: [
        createRecord({
          id: "u1",
          role: "user",
          createdAt: BASE_TIME + 1000,
          parts: [{ id: "text-u1", type: "text", text: "Say hi" }],
        }),
        createRecord({
          id: "a1",
          role: "assistant",
          createdAt: BASE_TIME + 4000,
          parentID: "u1",
          completedAt: BASE_TIME + 4000,
          parts: [
            { id: "reason-1", type: "reasoning", text: "Thinking..." },
            { id: "text-1", type: "text", text: "Hello there" },
            { id: "reason-2", type: "reasoning", text: "Late tail" },
          ],
        }),
      ],
      sessionStatus: { type: "done" },
      isThinking: false,
      isWaiting: false,
    });

    const agentRow = timeline.items.find((item) => item.kind === "agent");
    if (agentRow?.kind !== "agent") {
      throw new Error("Expected agent row");
    }

    expect(agentRow.showWorkedSection).toBe(true);
    expect(agentRow.actionParts.map((part) => part.id)).toEqual([
      "reason-1",
      "reason-2",
    ]);
    expect(agentRow.responseParts.map((part) => part.id)).toEqual(["text-1"]);
  });

  it("groups multiple assistant messages with the same parent into one worked turn", () => {
    const timeline = buildCanonicalTimelineModel({
      messages: [
        createRecord({
          id: "u1",
          role: "user",
          createdAt: BASE_TIME + 1000,
          parts: [{ id: "text-u1", type: "text", text: "hey, whats up?" }],
        }),
        createRecord({
          id: "a1",
          role: "assistant",
          parentID: "u1",
          createdAt: BASE_TIME + 1500,
          completedAt: BASE_TIME + 1500,
          parts: [{ id: "reason-1", type: "reasoning", text: "Friendly reply" }],
        }),
        createRecord({
          id: "a2",
          role: "assistant",
          parentID: "u1",
          createdAt: BASE_TIME + 2000,
          completedAt: BASE_TIME + 2000,
          parts: [{ id: "text-1", type: "text", text: "I'm doing well." }],
        }),
        createRecord({
          id: "u2",
          role: "user",
          createdAt: BASE_TIME + 3000,
          parts: [{ id: "text-u2", type: "text", text: "what would you do?" }],
        }),
        createRecord({
          id: "a3",
          role: "assistant",
          parentID: "u2",
          createdAt: BASE_TIME + 3500,
          completedAt: BASE_TIME + 3500,
          parts: [
            { id: "tool-1", type: "tool", tool: "bash", status: "completed" },
            { id: "reason-2", type: "reasoning", text: "Inspect project" },
          ],
        }),
        createRecord({
          id: "a4",
          role: "assistant",
          parentID: "u2",
          createdAt: BASE_TIME + 5000,
          completedAt: BASE_TIME + 5000,
          parts: [{ id: "text-2", type: "text", text: "I would add a contact form." }],
        }),
      ],
      sessionStatus: { type: "done" },
      isThinking: false,
      isWaiting: false,
    });

    expect(timeline.items.map((item) => `${item.kind}:${item.runId}`)).toEqual([
      "user:turn-u1",
      "agent:turn-u1",
      "user:turn-u2",
      "agent:turn-u2",
    ]);

    const firstAgentRow = timeline.items.find(
      (item) => item.kind === "agent" && item.runId === "turn-u1",
    );
    const secondAgentRow = timeline.items.find(
      (item) => item.kind === "agent" && item.runId === "turn-u2",
    );

    if (firstAgentRow?.kind !== "agent" || secondAgentRow?.kind !== "agent") {
      throw new Error("Expected grouped agent rows");
    }

    expect(firstAgentRow.showWorkedSection).toBe(true);
    expect(firstAgentRow.actionParts.map((part) => part.id)).toEqual(["reason-1"]);
    expect(firstAgentRow.responseParts.map((part) => part.id)).toEqual(["text-1"]);

    expect(secondAgentRow.showWorkedSection).toBe(true);
    expect(secondAgentRow.actionParts.map((part) => part.id)).toEqual([
      "tool-1",
      "reason-2",
    ]);
    expect(secondAgentRow.responseParts.map((part) => part.id)).toEqual(["text-2"]);
    expect(secondAgentRow.completedAt).toBe(BASE_TIME + 5000);
  });

  it("renders a session-compacted divider without a synthetic user bubble", () => {
    const timeline = buildCanonicalTimelineModel({
      messages: [
        createRecord({
          id: "u-compact",
          role: "user",
          createdAt: BASE_TIME + 1000,
          parts: [{ id: "compact-1", type: "compaction" }],
        }),
        createRecord({
          id: "a-summary",
          role: "assistant",
          parentID: "u-compact",
          createdAt: BASE_TIME + 2000,
          completedAt: BASE_TIME + 3000,
          parts: [{ id: "text-summary", type: "text", text: "Summary text" }],
        }),
      ],
      sessionStatus: { type: "done" },
      isThinking: false,
      isWaiting: false,
    });

    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({
      kind: "agent",
      sessionDividerLabel: "Session compacted",
      userMessageId: undefined,
    });
  });

  it("keeps a pending assistant run active even if the session status already looks terminal", () => {
    const timeline = buildCanonicalTimelineModel({
      messages: [
        createRecord({
          id: "u1",
          role: "user",
          createdAt: BASE_TIME + 10_000,
          parts: [{ id: "text-u1", type: "text", text: "Do the task" }],
        }),
        createRecord({
          id: "a1",
          role: "assistant",
          parentID: "u1",
          createdAt: BASE_TIME + 11_000,
          parts: [{ id: "tool-a1", type: "tool", tool: "read", status: "running" }],
        }),
      ],
      sessionStatus: { type: "done" },
      isThinking: true,
      isWaiting: false,
    });

    const agentRow = timeline.items.find((item) => item.kind === "agent");
    if (agentRow?.kind !== "agent") {
      throw new Error("Expected active agent row");
    }

    expect(agentRow.runInProgress).toBe(true);
    expect(agentRow.showWorkedSection).toBe(false);
    expect(agentRow.orderedParts).toMatchObject([
      { id: "tool-a1", type: "tool", status: "running" },
    ]);
  });

  it("finalizes stale running tools when the assistant message itself is already completed", () => {
    const timeline = buildCanonicalTimelineModel({
      messages: [
        createRecord({
          id: "u1",
          role: "user",
          createdAt: BASE_TIME + 10_000,
          parts: [{ id: "text-u1", type: "text", text: "Build it" }],
        }),
        createRecord({
          id: "a1",
          role: "assistant",
          parentID: "u1",
          createdAt: BASE_TIME + 11_000,
          completedAt: BASE_TIME + 12_000,
          parts: [
            { id: "tool-a1", type: "tool", tool: "bash", status: "running" },
            { id: "text-a1", type: "text", text: "Build completed successfully." },
          ],
        }),
      ],
      sessionStatus: { type: "busy" },
      isThinking: false,
      isWaiting: false,
    });

    const agentRow = timeline.items.find((item) => item.kind === "agent");
    if (agentRow?.kind !== "agent") {
      throw new Error("Expected completed agent row");
    }

    expect(agentRow.runInProgress).toBe(false);
    expect(agentRow.orderedParts).toMatchObject([
      { id: "tool-a1", type: "tool", status: "completed" },
      { id: "text-a1", type: "text", text: "Build completed successfully." },
    ]);
  });

  it("does not suggest continue when a final answer exists in an earlier assistant message of the latest turn", () => {
    const shouldSuggest = shouldSuggestInterruptedContinueFromRecords({
      sessionStatus: "done",
      messages: [
        createRecord({
          id: "u1",
          role: "user",
          createdAt: BASE_TIME + 10_000,
          parts: [{ id: "text-u1", type: "text", text: "Do the task" }],
        }),
        createRecord({
          id: "a1",
          role: "assistant",
          parentID: "u1",
          createdAt: BASE_TIME + 11_000,
          completedAt: BASE_TIME + 11_000,
          parts: [{ id: "text-a1", type: "text", text: "Done" }],
        }),
        createRecord({
          id: "a2",
          role: "assistant",
          parentID: "u1",
          createdAt: BASE_TIME + 12_000,
          completedAt: BASE_TIME + 12_000,
          parts: [{ id: "reason-a2", type: "reasoning", text: "late tail" }],
        }),
      ],
      isThinking: false,
      isLoading: false,
      now: BASE_TIME + 30_000,
    });

    expect(shouldSuggest).toBe(false);
  });

  it("does not suggest continue while a pending assistant message still exists", () => {
    const shouldSuggest = shouldSuggestInterruptedContinueFromRecords({
      sessionStatus: "done",
      messages: [
        createRecord({
          id: "u1",
          role: "user",
          createdAt: BASE_TIME + 10_000,
          parts: [{ id: "text-u1", type: "text", text: "Do the task" }],
        }),
        createRecord({
          id: "a1",
          role: "assistant",
          parentID: "u1",
          createdAt: BASE_TIME + 11_000,
          parts: [{ id: "tool-a1", type: "tool", tool: "read", status: "running" }],
        }),
      ],
      isThinking: false,
      isLoading: false,
      now: BASE_TIME + 30_000,
    });

    expect(shouldSuggest).toBe(false);
  });

  it("suggests continue for interrupted terminal sessions without a final answer", () => {
    const shouldSuggest = shouldSuggestInterruptedContinueFromRecords({
      sessionStatus: "done",
      messages: [
        createRecord({
          id: "u1",
          role: "user",
          createdAt: BASE_TIME + 10_000,
          parts: [{ id: "text-u1", type: "text", text: "Do the task" }],
        }),
      ],
      isThinking: false,
      isLoading: false,
      now: BASE_TIME + 30_000,
    });

    expect(shouldSuggest).toBe(true);
  });

  it("formats long durations in worked labels", () => {
    expect(formatWorkedLabel(0, 0)).toBe("Worked session");
    expect(formatWorkedLabel(1000, 65_000)).toBe("Worked for 1m 4s");
  });
});
