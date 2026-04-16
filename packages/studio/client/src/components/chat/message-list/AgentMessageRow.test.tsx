import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentMessageRow } from "./AgentMessageRow";

describe("AgentMessageRow tool details", () => {
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
      screen.getByText(/\$ npm run cms:validate[\s\S]*Validated[\s\S]*Everything looks good/i),
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

    expect(screen.getAllByText(/getCollection\\\('horse'\\\)/i)).toHaveLength(1);
    expect(screen.getByText(/Found 1 match/i)).toBeInTheDocument();
  });
});
