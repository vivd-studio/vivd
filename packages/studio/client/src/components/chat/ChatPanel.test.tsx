import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanelContent } from "./ChatPanel";

const mockChatContext = vi.hoisted(() => ({
  sessions: [
    {
      id: "session-1",
      title: "Refresh hero",
      time: { updated: Date.UTC(2026, 2, 18, 10, 59) },
    },
    {
      id: "session-2",
      title: "Tune mobile layout",
      time: { updated: Date.UTC(2026, 2, 18, 9, 14) },
    },
  ],
  sessionsLoading: false,
  selectedSessionId: "session-1",
  setSelectedSessionId: vi.fn(),
  handleDeleteSession: vi.fn(),
  handleNewSession: vi.fn(),
  messageCount: 1,
  activeQuestionRequest: null as any,
  activePermissionRequest: null as any,
  sessionDebugState: {
    selectedSessionId: "session-1",
    isStreaming: false,
    isWaiting: false,
    isThinking: false,
    streamingPartsCount: 0,
    messagesCount: 1,
    sseConnected: true,
    lastEventTime: null,
    lastEventType: null,
    lastEventId: null,
    sessionError: null,
    sessionStatus: { type: "done" },
    usage: null,
  },
  setSelectorMode: vi.fn(),
}));

const mockPreviewContext = vi.hoisted(() => ({
  sessionHistoryOpen: false,
  setSessionHistoryOpen: vi.fn(),
}));

vi.mock("./ChatContext", () => ({
  ChatProvider: ({ children }: { children: ReactNode }) => children,
  useChatContext: () => mockChatContext,
}));

vi.mock("../preview/PreviewContext", () => ({
  useOptionalPreview: () => mockPreviewContext,
}));

vi.mock("./MessageList", () => ({
  MessageList: () => <div>Message list</div>,
}));

vi.mock("./ChatInputRegion", () => ({
  ChatInputRegion: () => <div>Composer</div>,
}));

describe("ChatPanelContent", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockChatContext.setSelectedSessionId.mockReset();
    mockChatContext.handleNewSession.mockReset();
    mockChatContext.setSelectorMode.mockReset();
    mockChatContext.activeQuestionRequest = null;
    mockChatContext.activePermissionRequest = null;
    mockPreviewContext.setSessionHistoryOpen.mockReset();
    mockPreviewContext.sessionHistoryOpen = false;
  });

  it("removes the old Agent Chat headline and switches the sidebar into a sessions-only view", () => {
    mockPreviewContext.sessionHistoryOpen = true;

    render(<ChatPanelContent />);

    expect(screen.queryByText("Agent Chat")).not.toBeInTheDocument();
    expect(screen.getByText("Latest Sessions")).toBeInTheDocument();
    expect(screen.getByText("Refresh hero")).toBeInTheDocument();
    expect(screen.getByText("Tune mobile layout")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /new session/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Message list")).not.toBeInTheDocument();
  });

  it("returns from sessions mode to chat after choosing a session", () => {
    mockPreviewContext.sessionHistoryOpen = true;

    render(<ChatPanelContent />);

    fireEvent.click(screen.getByTitle("Tune mobile layout (session-2)"));

    expect(mockChatContext.setSelectedSessionId).toHaveBeenCalledWith("session-2");
    expect(mockPreviewContext.setSessionHistoryOpen).toHaveBeenCalledWith(false);
  });

  it("shows a focus overlay while an agent question is active", () => {
    mockChatContext.activeQuestionRequest = {
      id: "question-1",
      sessionID: "session-1",
      questions: [{ header: "Pick one", question: "Which layout?", options: [] }],
    };

    render(<ChatPanelContent />);

    expect(screen.getByTestId("chat-question-focus-overlay")).toBeInTheDocument();
  });

  it("keeps the overlay out of the way when there is no active question", () => {
    mockChatContext.activeQuestionRequest = null;
    mockChatContext.activePermissionRequest = null;

    render(<ChatPanelContent />);

    expect(
      screen.queryByTestId("chat-question-focus-overlay"),
    ).not.toBeInTheDocument();
  });

  it("shows a focus overlay while a permission approval is active", () => {
    mockChatContext.activePermissionRequest = {
      id: "perm-1",
      sessionID: "session-1",
      permission: "bash",
      patterns: ["vivd publish deploy"],
      always: ["vivd *"],
      metadata: {},
    };

    render(<ChatPanelContent />);

    expect(screen.getByTestId("chat-question-focus-overlay")).toBeInTheDocument();
  });
});
