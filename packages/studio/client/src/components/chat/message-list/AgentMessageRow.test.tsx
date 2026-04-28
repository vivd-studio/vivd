import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMessageRow } from "./AgentMessageRow";

describe("AgentMessageRow tool details", () => {
  afterEach(() => {
    cleanup();
  });

  it("collapses pre-answer work into one completed activity row", () => {
    const item = {
      kind: "agent",
      key: "agent-chronological",
      runId: "turn-chronological",
      userMessageId: undefined,
      orderedParts: [],
      actionParts: [],
      responseParts: [],
      summaryDiffs: [],
      hasInterleavedParts: true,
      runInProgress: false,
      showWorkedSection: true,
      workedLabel: "Worked for 24s",
      fallbackState: null,
    } as any;
    const orderedParts = [
      {
        id: "text-1",
        type: "text",
        text: "Checking project structure and Vivd status.",
      },
      {
        id: "tool-read",
        type: "tool",
        tool: "read",
        status: "completed",
        input: { filePath: "/workspace/package.json" },
      },
      {
        id: "tool-list",
        type: "tool",
        tool: "list",
        status: "completed",
        input: { path: "/workspace/src" },
      },
      {
        id: "text-2",
        type: "text",
        text: "Reviewing the generated pages.",
      },
      {
        id: "tool-edit",
        type: "tool",
        tool: "edit",
        status: "completed",
        input: { filePath: "/workspace/src/App.tsx" },
      },
      {
        id: "text-3",
        type: "text",
        text: "The project has a solid technical foundation.",
      },
    ];

    const { container, rerender } = render(
      <AgentMessageRow
        item={item}
        orderedParts={orderedParts}
        workedOpen={false}
        onToggleWorked={() => undefined}
      />,
    );

    const transcript = container.textContent ?? "";
    const workedIndex = transcript.indexOf("Worked for 24s");
    const finalTextIndex = transcript.indexOf(
      "The project has a solid technical foundation.",
    );

    expect(workedIndex).toBeGreaterThanOrEqual(0);
    expect(workedIndex).toBeLessThan(finalTextIndex);
    expect(
      screen.getByRole("button", {
        name: /Worked for 24s.*Read 1 file.*Listed 1 folder.*Edited 1 file/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Checking project structure and Vivd status."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /readpackage\.json/i }),
    ).not.toBeInTheDocument();

    rerender(
      <AgentMessageRow
        item={item}
        orderedParts={orderedParts}
        workedOpen={true}
        onToggleWorked={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: /readpackage\.json/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /listedsrc/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /editedapp\.tsx/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Checking project structure and Vivd status."),
    ).toBeInTheDocument();
  });

  it("collapses active work into one live activity row", () => {
    const item = {
      kind: "agent",
      key: "agent-running",
      runId: "turn-running",
      userMessageId: undefined,
      orderedParts: [],
      actionParts: [],
      responseParts: [],
      summaryDiffs: [],
      hasInterleavedParts: false,
      runInProgress: true,
      showWorkedSection: false,
      workedLabel: undefined,
      fallbackState: "working",
    } as any;
    const orderedParts = [
      {
        id: "reasoning-1",
        type: "reasoning",
        text: "I need to inspect the project first.",
      },
      {
        id: "status-1",
        type: "text",
        text: "Checking project structure and Vivd status.",
      },
      {
        id: "tool-read",
        type: "tool",
        tool: "read",
        status: "completed",
        input: { filePath: "/workspace/package.json" },
      },
      {
        id: "tool-list",
        type: "tool",
        tool: "list",
        status: "running",
        input: { path: "/workspace/src" },
      },
    ];

    render(
      <AgentMessageRow
        item={item}
        orderedParts={orderedParts}
        workedOpen={false}
        onToggleWorked={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /Working.*Listing src.*Read 1 file.*Listed 1 folder.*Thought through the change/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Checking project structure and Vivd status."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /readpackage\.json/i }),
    ).not.toBeInTheDocument();
  });

  it("renders a readable bash transcript from command and completed output", () => {
    render(
      <AgentMessageRow
        item={
          {
            kind: "agent",
            key: "agent-1",
            runId: "turn-1",
            orderedParts: [],
            actionParts: [],
            responseParts: [],
            summaryDiffs: [],
            hasInterleavedParts: false,
            runInProgress: false,
            showWorkedSection: false,
            fallbackState: null,
          } as any
        }
        orderedParts={[
          {
            id: "tool-1",
            type: "tool",
            tool: "bash",
            status: "completed",
            input: {
              command: "npm run cms:validate",
              description: "Validates the CMS schema and content.",
            },
            state: {
              status: "completed",
              input: {
                command: "npm run cms:validate",
                description: "Validates the CMS schema and content.",
              },
              output: "\u001b[32mValidated\u001b[39m\r\nEverything looks good",
            },
          },
        ]}
        workedOpen={false}
        onToggleWorked={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(
      screen.getByText("Validates the CMS schema and content."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /\$ npm run cms:validate[\s\S]*Validated[\s\S]*Everything looks good/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/"description":/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\u001b\[32m/)).not.toBeInTheDocument();
  });

  it("hides tool titles that are already present inside the rendered input details", () => {
    render(
      <AgentMessageRow
        item={
          {
            kind: "agent",
            key: "agent-2",
            runId: "turn-2",
            orderedParts: [],
            actionParts: [],
            responseParts: [],
            summaryDiffs: [],
            hasInterleavedParts: false,
            runInProgress: false,
            showWorkedSection: false,
            fallbackState: null,
          } as any
        }
        orderedParts={[
          {
            id: "tool-2",
            type: "tool",
            tool: "grep",
            status: "completed",
            input: {
              pattern: "getCollection\\('horse'\\)",
              path: "/home/studio/project/src",
              include: "*.{astro,ts,js,yaml}",
            },
            state: {
              status: "completed",
              title: "getCollection\\('horse'\\)",
              input: {
                pattern: "getCollection\\('horse'\\)",
                path: "/home/studio/project/src",
                include: "*.{astro,ts,js,yaml}",
              },
              output: "Found 1 match",
            },
          },
        ]}
        workedOpen={false}
        onToggleWorked={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /exploredsrc/i }));

    expect(screen.getAllByText(/getCollection\\\('horse'\\\)/i)).toHaveLength(
      1,
    );
    expect(screen.getByText(/Found 1 match/i)).toBeInTheDocument();
  });
});
