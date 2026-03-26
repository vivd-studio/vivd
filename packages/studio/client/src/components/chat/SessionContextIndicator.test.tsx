import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionContextIndicator } from "./SessionContextIndicator";

const { chatContextState, opencodeState } = vi.hoisted(() => ({
  chatContextState: {
    selectedSessionId: "sess-1" as string | null,
    softContextLimitTokens: 250_000,
    availableModels: [
      {
        tier: "advanced" as const,
        provider: "openai",
        modelId: "gpt-4.1",
        label: "Advanced",
        providerLabel: "OpenAI",
        modelLabel: "GPT-4.1",
        contextLimit: 1_000,
        inputLimit: 800,
      },
    ],
  },
  opencodeState: {
    selectedMessages: [
      {
        info: {
          id: "a1",
          sessionID: "sess-1",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-4.1",
          cost: 0.42,
          tokens: {
            input: 300,
            output: 120,
            reasoning: 30,
            cache: { read: 50, write: 10 },
          },
        },
        parts: [],
      },
    ],
  },
}));

vi.mock("./ChatContext", () => ({
  useChatContext: () => chatContextState,
}));

vi.mock("@/features/opencodeChat", () => ({
  useOpencodeChat: () => opencodeState,
}));

describe("SessionContextIndicator", () => {
  it("opens a dialog with OpenCode-style context usage details", () => {
    render(<SessionContextIndicator />);

    expect(
      screen.getByTestId("session-context-usage-button"),
    ).toHaveTextContent("64%");

    fireEvent.click(
      screen.getByRole("button", { name: /view context usage/i }),
    );

    expect(screen.getByText("Context Usage")).toBeInTheDocument();
    expect(screen.getByText("64% of working limit")).toBeInTheDocument();
    expect(screen.getByText("510")).toBeInTheDocument();
    expect(screen.getByText("42 ⬡")).toBeInTheDocument();
    expect(screen.getByText("250,000")).toBeInTheDocument();
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    expect(screen.queryByText("GPT-4.1")).not.toBeInTheDocument();
    expect(screen.queryByText("Input Tokens")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("session-context-details-toggle"));

    expect(screen.getByText("Used Model")).toBeInTheDocument();
    expect(screen.getByText("GPT-4.1")).toBeInTheDocument();
    expect(screen.getByText("Effective Working Limit")).toBeInTheDocument();
    expect(screen.getAllByText("800")).toHaveLength(2);
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("Cache Read")).toBeInTheDocument();
    expect(screen.getByText("Cache Write")).toBeInTheDocument();
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[calc(100dvh-1rem)]");
    expect(dialog.className).toContain("flex");

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.queryByText("Context Usage")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /view context usage/i }),
    );

    expect(screen.queryByText("Used Model")).not.toBeInTheDocument();
  });

  it("stays hidden when no session is selected", () => {
    chatContextState.selectedSessionId = null;

    const { container } = render(<SessionContextIndicator />);

    expect(container).toBeEmptyDOMElement();

    chatContextState.selectedSessionId = "sess-1";
  });
});
