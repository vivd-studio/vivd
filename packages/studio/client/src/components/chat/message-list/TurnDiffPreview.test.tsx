import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnDiffPreview } from "./TurnDiffPreview";

const queryState = vi.hoisted(() => ({
  data: [] as any[] | undefined,
  isLoading: false,
  isError: false,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    agentChat: {
      messageDiff: {
        useQuery: () => ({
          data: queryState.data,
          isLoading: queryState.isLoading,
          isError: queryState.isError,
        }),
      },
    },
  },
}));

vi.mock("../ChatContext", () => ({
  useChatContext: () => ({
    projectSlug: "site-1",
    version: 1,
    selectedSessionId: "sess-1",
  }),
}));

describe("TurnDiffPreview", () => {
  beforeEach(() => {
    queryState.isLoading = false;
    queryState.isError = false;
    queryState.data = [
      {
        file: "src/one.ts",
        before: "const value = 1;\n",
        after: "const value = 2;\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
      {
        file: "src/two.ts",
        before: "export const label = 'before';\n",
        after: "export const label = 'after';\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
    ];
  });

  afterEach(() => {
    cleanup();
  });

  it("expands the selected file inline instead of rendering a detached bottom preview", () => {
    render(
      <TurnDiffPreview
        messageId="msg-1"
        summaryDiffs={[
          { file: "src/one.ts", additions: 1, deletions: 1, status: "modified" },
          { file: "src/two.ts", additions: 1, deletions: 1, status: "modified" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /files edited/i }));

    expect(screen.getByText("const value = 2;")).toBeInTheDocument();
    expect(screen.queryByText("export const label = 'after';")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /two\.ts/i }));

    expect(screen.queryByText("const value = 2;")).not.toBeInTheDocument();
    expect(screen.getByText("export const label = 'after';")).toBeInTheDocument();

    const secondItem = document.querySelector(
      "[data-chat-turn-diff-item='src/two.ts']",
    ) as HTMLElement | null;
    expect(secondItem).not.toBeNull();
    expect(
      within(secondItem as HTMLElement).getByText("export const label = 'after';"),
    ).toBeInTheDocument();
  });

  it("shows an explicit placeholder for files without an inline text diff", () => {
    queryState.data = [
      {
        file: "public/files/report.pdf",
        before: "",
        after: "",
        additions: 0,
        deletions: 0,
        status: "added",
      },
    ];

    render(
      <TurnDiffPreview
        messageId="msg-2"
        summaryDiffs={[
          {
            file: "public/files/report.pdf",
            additions: 0,
            deletions: 0,
            status: "added",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /files edited/i }));

    expect(
      screen.getByText("No inline text diff preview is available for this file."),
    ).toBeInTheDocument();
  });
});
