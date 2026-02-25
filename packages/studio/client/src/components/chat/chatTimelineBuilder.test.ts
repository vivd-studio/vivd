import { describe, expect, it } from "vitest";
import {
  buildChatTimelineModel,
  formatWorkedLabel,
  mergeLiveParts,
} from "./chatTimelineBuilder";

describe("chatTimelineBuilder", () => {
  it("renders a waiting agent row for an in-progress user turn with no actions", () => {
    const timeline = buildChatTimelineModel({
      messages: [{ id: "u1", role: "user", content: "Fix it", createdAt: 1000 }],
      liveParts: [],
      isWorking: true,
      isWaiting: true,
    });

    const agentRow = timeline.items.find(
      (item) => item.kind === "agent",
    );

    expect(agentRow).toMatchObject({
      kind: "agent",
      runInProgress: true,
      showWorkedSection: false,
      fallbackState: "waiting",
    });
  });

  it("keeps live action rows visible on the active pending turn", () => {
    const timeline = buildChatTimelineModel({
      messages: [
        { id: "u1", role: "user", content: "Inspect file", createdAt: 1000 },
        {
          id: "a1",
          role: "agent",
          content: "",
          parts: [{ id: "t1", type: "tool", tool: "read", status: "completed" }],
          createdAt: 1500,
        },
        { id: "u2", role: "user", content: "Now edit it", createdAt: 2000 },
      ],
      liveParts: [
        { id: "t2", type: "tool", tool: "edit", status: "running" },
      ],
      isWorking: true,
      isWaiting: false,
    });

    const agentRows = timeline.items.filter(
      (item) => item.kind === "agent",
    );
    const activeRow = agentRows.find(
      (item) => item.kind === "agent" && item.runInProgress,
    );

    expect(activeRow).toMatchObject({
      kind: "agent",
      runInProgress: true,
      showWorkedSection: false,
      fallbackState: null,
    });
    expect(activeRow?.kind === "agent" ? activeRow.actionParts : []).toHaveLength(1);
  });

  it("does not mark the previous completed run as in-progress during startup gaps", () => {
    const timeline = buildChatTimelineModel({
      messages: [
        { id: "u1", role: "user", content: "Inspect file", createdAt: 1000 },
        {
          id: "a1",
          role: "agent",
          content: "Done",
          createdAt: 1500,
          parts: [
            { id: "t1", type: "tool", tool: "read", status: "completed" },
            { id: "text-1", type: "text", text: "Done" },
          ],
        },
      ],
      liveParts: [],
      isWorking: true,
      isWaiting: true,
    });

    const agentRows = timeline.items.filter(
      (item) => item.kind === "agent",
    );
    const completedRow = agentRows.find(
      (item) =>
        item.kind === "agent" &&
        item.message?.id === "a1",
    );
    const activeRow = agentRows.find(
      (item) =>
        item.kind === "agent" &&
        item.runInProgress &&
        !item.message,
    );

    expect(completedRow).toMatchObject({
      kind: "agent",
      runInProgress: false,
      showWorkedSection: true,
    });
    expect(activeRow).toMatchObject({
      kind: "agent",
      runInProgress: true,
      showWorkedSection: false,
    });
  });

  it("shows worked section only after run completion when response text exists", () => {
    const timeline = buildChatTimelineModel({
      messages: [
        { id: "u1", role: "user", content: "Fix", createdAt: 1000 },
        {
          id: "a1",
          role: "agent",
          content: "Done",
          createdAt: 3000,
          parts: [
            { id: "tool-1", type: "tool", tool: "edit", status: "completed" },
            { id: "text-1", type: "text", text: "Done" },
          ],
        },
      ],
      liveParts: [],
      isWorking: false,
      isWaiting: false,
    });

    const agentRow = timeline.items.find(
      (item) => item.kind === "agent",
    );

    expect(agentRow).toMatchObject({
      kind: "agent",
      runInProgress: false,
      showWorkedSection: true,
      workedLabel: "Worked for 2s",
    });
  });

  it("merges live action parts by id while preserving sequence", () => {
    const merged = mergeLiveParts(
      [{ id: "a", type: "tool", status: "running", tool: "read" }],
      [
        { id: "a", type: "tool", status: "completed", tool: "read" },
        { id: "b", type: "reasoning", text: "Thinking" },
      ],
    );

    expect(merged).toEqual([
      { id: "a", type: "tool", status: "completed", tool: "read" },
      { id: "b", type: "reasoning", text: "Thinking" },
    ]);
  });

  it("formats long durations in worked labels", () => {
    expect(formatWorkedLabel(0, 0)).toBe("Worked session");
    expect(formatWorkedLabel(1000, 65_000)).toBe("Worked for 1m 4s");
  });

  it("keeps interleaved action/text runs in strict part order without worked wrapper", () => {
    const timeline = buildChatTimelineModel({
      messages: [
        { id: "u1", role: "user", content: "Do multi-step", createdAt: 1000 },
        {
          id: "a1",
          role: "agent",
          content: "",
          createdAt: 5000,
          parts: [
            { id: "tool-1", type: "tool", tool: "read", status: "completed" },
            { id: "text-1", type: "text", text: "I checked the file." },
            { id: "tool-2", type: "tool", tool: "edit", status: "completed" },
            { id: "text-2", type: "text", text: "I made the update." },
          ],
        },
      ],
      liveParts: [],
      isWorking: false,
      isWaiting: false,
    });

    const agentRow = timeline.items.find((item) => item.kind === "agent");
    expect(agentRow).toMatchObject({
      kind: "agent",
      hasInterleavedParts: true,
      showWorkedSection: false,
      runInProgress: false,
    });

    if (agentRow?.kind !== "agent") {
      throw new Error("Expected agent row to exist");
    }

    expect(
      agentRow.orderedParts.map((part) => `${part.type}:${part.id}`),
    ).toEqual([
      "tool:tool-1",
      "text:text-1",
      "tool:tool-2",
      "text:text-2",
    ]);
  });
});
