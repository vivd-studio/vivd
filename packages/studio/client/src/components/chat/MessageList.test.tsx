import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";

const timelineState = vi.hoisted(() => ({
  items: [
    {
      key: "user-1",
      kind: "user",
      message: {
        id: "user-1",
        content: "First prompt",
        createdAt: Date.UTC(2026, 2, 18, 10, 59),
      },
    },
  ] as any[],
}));

const opencodeState = vi.hoisted(() => ({
  selectedMessages: [{ info: { id: "user-1" }, parts: [] }] as any[],
}));

const interruptedContinueState = vi.hoisted(() => ({
  value: false,
}));

const chatState = vi.hoisted(() => ({
  selectedSessionId: "session-1" as string | null,
  input: "",
  handleSend: vi.fn(),
  handleStopGeneration: vi.fn(),
  attachedElement: null,
  setAttachedElement: vi.fn(),
  attachedImages: [] as any[],
  addAttachedImages: vi.fn(),
  removeAttachedImage: vi.fn(),
  attachedFiles: [] as any[],
  addAttachedFile: vi.fn(),
  removeAttachedFile: vi.fn(),
  followupBehavior: "steer" as const,
  setFollowupBehavior: vi.fn(),
  queuedFollowups: [] as any[],
  queuedFollowupSendingId: null as string | null,
  handleSendQueuedFollowup: vi.fn(),
  handleEditQueuedFollowup: vi.fn(),
  selectorMode: false,
  setSelectorMode: vi.fn(),
  isThinking: false,
  isWaiting: false,
  isLoading: false,
  isSessionHydrating: false,
  selectorModeAvailable: true,
  availableModels: [] as any[],
  selectedModel: null as any,
  setSelectedModel: vi.fn(),
  handleRevert: vi.fn(),
  handleUnrevert: vi.fn(),
  isReverted: false,
  setInput: vi.fn(),
  handleContinueSession: vi.fn(),
  activeQuestionRequest: null,
  sessionError: null,
  clearSessionError: vi.fn(),
  sessionDebugState: {
    sessionStatus: { type: "done" },
  },
  usageLimitStatus: null,
  isUsageBlocked: false,
  initialGenerationRequested: false as boolean,
  initialGenerationStarting: false as boolean,
  initialGenerationFailed: null,
  retryInitialGeneration: vi.fn(),
}));

const scrollToMock = vi.fn();
const CHAT_ANCHOR_TOP_INSET_PX = 56;
const viewportExtraScrollHeight = vi.hoisted(() => ({ value: 0 }));
const anchorTopById = vi.hoisted(() => ({
  "optimistic:client-1": 120,
  "user-1": 120,
  "user-2": 280,
} as Record<string, number>));
const userMessageContentScrollHeightById = vi.hoisted(() => ({
  "optimistic:client-1": 80,
  "user-1": 80,
  "user-2": 80,
} as Record<string, number>));
const resizeObserverCallbacks = vi.hoisted(() => [] as ResizeObserverCallback[]);
const oscillatingActiveTurnRowIds = vi.hoisted(() => new Set<string>());

vi.mock("@/features/opencodeChat", () => ({
  useOpencodeChat: () => ({
    selectedMessages: opencodeState.selectedMessages,
    sessionStatus: { type: "done" },
  }),
}));

vi.mock("@/features/opencodeChat/render/timeline", () => ({
  buildCanonicalTimelineModel: () => ({ items: timelineState.items }),
  shouldSuggestInterruptedContinueFromRecords: () => interruptedContinueState.value,
}));

vi.mock("./ChatContext", () => ({
  useChatContext: () => chatState,
}));

describe("MessageList latest-user anchoring", () => {
  beforeEach(() => {
    vi.useRealTimers();
    scrollToMock.mockReset();
    timelineState.items = [
      {
        key: "user-1",
        kind: "user",
        message: {
          id: "user-1",
          content: "First prompt",
          createdAt: Date.UTC(2026, 2, 18, 10, 59),
        },
      },
    ];
    opencodeState.selectedMessages = [{ info: { id: "user-1" }, parts: [] }];
    chatState.isSessionHydrating = false;
    chatState.input = "";
    chatState.attachedElement = null;
    chatState.attachedImages = [];
    chatState.attachedFiles = [];
    chatState.selectorMode = false;
    chatState.usageLimitStatus = null;
    chatState.isUsageBlocked = false;
    chatState.selectedSessionId = "session-1";
    chatState.initialGenerationRequested = false;
    chatState.initialGenerationStarting = false;
    chatState.initialGenerationFailed = null;
    chatState.activeQuestionRequest = null;
    interruptedContinueState.value = false;
    anchorTopById["optimistic:client-1"] = 120;
    anchorTopById["user-1"] = 120;
    anchorTopById["user-2"] = 280;
    viewportExtraScrollHeight.value = 0;
    userMessageContentScrollHeightById["optimistic:client-1"] = 80;
    userMessageContentScrollHeightById["user-1"] = 80;
    userMessageContentScrollHeightById["user-2"] = 80;
    resizeObserverCallbacks.length = 0;
    oscillatingActiveTurnRowIds.clear();
    let nextAnimationFrameId = 1;
    const cancelledAnimationFrameIds = new Set<number>();

    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => {
        const frameId = nextAnimationFrameId++;
        queueMicrotask(() => {
          if (cancelledAnimationFrameIds.has(frameId)) {
            return;
          }
          callback(0);
        });
        return frameId;
      },
    });

    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: (frameId: number) => {
        cancelledAnimationFrameIds.add(frameId);
      },
    });

    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        private callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
          resizeObserverCallbacks.push(callback);
        }
        observe() {}
        disconnect() {
          const index = resizeObserverCallbacks.indexOf(this.callback);
          if (index >= 0) {
            resizeObserverCallbacks.splice(index, 1);
          }
        }
        unobserve() {}
      },
    });

    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: function ({
        top,
        behavior,
      }: {
        top: number;
        behavior: ScrollBehavior;
      }) {
        (this as HTMLElement).scrollTop = top;
        scrollToMock({ top, behavior });
      },
    });

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        const element = this as HTMLElement;
        if (element.getAttribute("data-chat-scroll-viewport") !== null) {
          return 400;
        }
        return 0;
      },
    });

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        const element = this as HTMLElement;
        if (element.dataset.chatUserMessageContent) {
          return userMessageContentScrollHeightById[
            element.dataset.chatUserMessageContent
          ] ?? 0;
        }
        if (element.getAttribute("data-chat-scroll-viewport") !== null) {
          const activeTurnBody = element.querySelector<HTMLElement>(
            "[data-chat-active-turn-body]",
          );
          const activeMessageId = activeTurnBody?.dataset.chatActiveTurnBody;

          if (activeMessageId) {
            return (
              400 +
              Math.max(
                0,
                (anchorTopById[activeMessageId] ?? 0) -
                  CHAT_ANCHOR_TOP_INSET_PX,
              ) +
              viewportExtraScrollHeight.value
            );
          }

          return 520 + viewportExtraScrollHeight.value;
        }
        return 0;
      },
    });

    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: function () {
        const element = this as HTMLElement;
        const viewport =
          element.closest<HTMLElement>("[data-chat-scroll-viewport]") ??
          document.querySelector<HTMLElement>("[data-chat-scroll-viewport]");
        const viewportTop = 20;
        const currentScrollTop = viewport?.scrollTop ?? 0;

        if (
          element.dataset.chatUserAnchorId ||
          element.dataset.chatUserMessageId
        ) {
          const messageId =
            element.dataset.chatUserAnchorId ?? element.dataset.chatUserMessageId;
          const top = anchorTopById[messageId ?? ""] ?? 0;
          return {
            top: viewportTop + top - currentScrollTop,
            left: 0,
            bottom: viewportTop + top + 40 - currentScrollTop,
            right: 240,
            width: 240,
            height: 40,
            x: 0,
            y: viewportTop + top - currentScrollTop,
            toJSON() {
              return {};
            },
          };
        }
        if (element.dataset.chatUserRowId) {
          const messageId = element.dataset.chatUserRowId;
          const top = anchorTopById[messageId] ?? 0;
          const activeTurnBody = messageId
            ? document.querySelector<HTMLElement>(
                `[data-chat-active-turn-body='${messageId}']`,
              )
            : null;
          const activeTurnMinHeight = Number.parseFloat(
            activeTurnBody?.style.minHeight || "0",
          );
          const rowBottomOffset =
            messageId && oscillatingActiveTurnRowIds.has(messageId) &&
            activeTurnMinHeight >= 220
              ? 72
              : 52;
          return {
            top: viewportTop + top - 24 - currentScrollTop,
            left: 0,
            bottom: viewportTop + top + rowBottomOffset - currentScrollTop,
            right: 260,
            width: 260,
            height: rowBottomOffset + 24,
            x: 0,
            y: viewportTop + top - 24 - currentScrollTop,
            toJSON() {
              return {};
            },
          };
        }
        if (element.getAttribute("data-chat-scroll-viewport") !== null) {
          return {
            top: 20,
            left: 0,
            bottom: 420,
            right: 320,
            width: 320,
            height: 400,
            x: 0,
            y: 20,
            toJSON() {
              return {};
            },
          };
        }

        return {
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON() {
            return {};
          },
        };
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses auto scrollbar gutter for the empty-state prompt", () => {
    timelineState.items = [];
    opencodeState.selectedMessages = [];

    const { container } = render(<MessageList />);

    expect(
      screen.getByRole("heading", { name: "Where should we begin?" }),
    ).toBeInTheDocument();
    expect(
      container
        .querySelector("[data-chat-scroll-viewport]")
        ?.getAttribute("data-scrollbar-gutter-mode"),
    ).toBe("auto");
  });

  it("keeps a stable scrollbar gutter once the transcript has messages", () => {
    const { container } = render(<MessageList />);

    expect(
      container
        .querySelector("[data-chat-scroll-viewport]")
        ?.getAttribute("data-scrollbar-gutter-mode"),
    ).toBe("stable");
  });

  it("shows an initial-generation waiting state instead of the idle composer before a session attaches", () => {
    timelineState.items = [];
    opencodeState.selectedMessages = [];
    chatState.selectedSessionId = null;
    chatState.initialGenerationRequested = true;
    chatState.initialGenerationStarting = false;
    chatState.initialGenerationFailed = null;
    chatState.activeQuestionRequest = null;

    const { container } = render(<MessageList />);

    expect(
      screen.getByText("Attaching the initial generation session..."),
    ).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("uses explicit continue wording for interrupted initial-generation sessions", () => {
    interruptedContinueState.value = true;
    chatState.initialGenerationRequested = true;

    render(<MessageList />);

    expect(
      screen.getByText("Initial generation stopped before finishing. Click to continue"),
    ).toBeInTheDocument();
  });

  it("keeps the generic continue wording for other interrupted sessions", () => {
    interruptedContinueState.value = true;
    chatState.initialGenerationRequested = false;

    render(<MessageList />);

    expect(
      screen.getByText("Agent interrupted, click to continue"),
    ).toBeInTheDocument();
  });

  it("labels backend usage-check failures without showing a usage-limit headline", () => {
    chatState.isUsageBlocked = true;
    chatState.usageLimitStatus = {
      reason: "backend_unavailable",
      blocked: true,
      imageGenBlocked: true,
      warnings: [
        "Unable to verify Studio usage status with the backend. AI features are temporarily unavailable. Please try again later.",
      ],
      usage: {
        daily: { current: 0, limit: 0, percentage: 0 },
        weekly: { current: 0, limit: 0, percentage: 0 },
        monthly: { current: 0, limit: 0, percentage: 0 },
        imageGen: { current: 0, limit: 0, percentage: 0 },
      },
      nextReset: {
        daily: new Date().toISOString(),
        weekly: new Date().toISOString(),
        monthly: new Date().toISOString(),
      },
    } as any;

    render(<MessageList />);

    expect(screen.getByText("Usage Check Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Usage Limit Reached")).not.toBeInTheDocument();
  });

  it("anchors the latest user message to the top on session load", async () => {
    render(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 64,
        behavior: "auto",
      });
    });

    const activeTurnBody = document.querySelector<HTMLElement>(
      "[data-chat-active-turn-body='user-1']",
    );
    expect(activeTurnBody?.style.minHeight).toBe("204px");
  });

  it("does not re-anchor on follow-up renders until a new latest user message appears", async () => {
    const { rerender } = render(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });

    opencodeState.selectedMessages = [
      { info: { id: "user-1" }, parts: [] },
      { info: { id: "agent-1" }, parts: [] },
    ];
    rerender(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });

    timelineState.items = [
      ...timelineState.items,
      {
        key: "user-2",
        kind: "user",
        message: {
          id: "user-2",
          content: "Second prompt",
          createdAt: Date.UTC(2026, 2, 18, 11, 5),
        },
      },
    ];
    opencodeState.selectedMessages = [
      ...opencodeState.selectedMessages,
      { info: { id: "user-2" }, parts: [] },
    ];
    rerender(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(2);
      expect(scrollToMock).toHaveBeenLastCalledWith({
        top: 224,
        behavior: "smooth",
      });
    });

    const activeTurnBody = document.querySelector<HTMLElement>(
      "[data-chat-active-turn-body='user-2']",
    );
    expect(activeTurnBody?.style.minHeight).toBe("204px");
  });

  it("does not issue another scroll while the active turn layout updates", async () => {
    const { rerender } = render(<MessageList />);

    timelineState.items = [
      ...timelineState.items,
      {
        key: "user-2",
        kind: "user",
        message: {
          id: "user-2",
          content: "Second prompt",
          createdAt: Date.UTC(2026, 2, 18, 11, 5),
        },
      },
    ];
    opencodeState.selectedMessages = [
      ...opencodeState.selectedMessages,
      { info: { id: "user-2" }, parts: [] },
    ];
    rerender(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenLastCalledWith({
        top: 224,
        behavior: "smooth",
      });
    });

    resizeObserverCallbacks.forEach((callback) => callback([], {} as ResizeObserver));

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(2);
    });
  });

  it("does not re-anchor when an optimistic latest-user id is replaced in place", async () => {
    timelineState.items = [
      {
        key: "optimistic:client-1",
        kind: "user",
        message: {
          id: "optimistic:client-1",
          content: "First prompt",
          createdAt: Date.UTC(2026, 2, 18, 10, 59),
        },
      },
    ];
    opencodeState.selectedMessages = [
      { info: { id: "optimistic:client-1" }, parts: [] },
    ];

    const { rerender } = render(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
      expect(scrollToMock).toHaveBeenLastCalledWith({
        top: 64,
        behavior: "auto",
      });
    });

    timelineState.items = [
      {
        key: "user-1",
        kind: "user",
        message: {
          id: "user-1",
          content: "First prompt",
          createdAt: Date.UTC(2026, 2, 18, 10, 59),
        },
      },
    ];
    opencodeState.selectedMessages = [{ info: { id: "user-1" }, parts: [] }];
    rerender(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });

    const activeTurnBody = document.querySelector<HTMLElement>(
      "[data-chat-active-turn-body='user-1']",
    );
    expect(activeTurnBody?.style.minHeight).toBe("204px");
  });

  it("keeps the context indicator outside the scrollable transcript content", () => {
    const { container } = render(<MessageList />);

    const indicatorButton = container.querySelector(
      "[data-testid='session-context-usage-button']",
    );
    const transcriptContent = container.querySelector("[data-chat-transcript-content]");

    expect(indicatorButton).not.toBeNull();
    expect(transcriptContent).not.toBeNull();
    if (!(indicatorButton instanceof HTMLElement)) {
      throw new Error("Expected context indicator button");
    }
    if (!(transcriptContent instanceof HTMLElement)) {
      throw new Error("Expected transcript content container");
    }
    expect(transcriptContent).not.toContainElement(indicatorButton);
  });

  it("keeps the context indicator left-aligned so it does not cover revert actions", () => {
    const { container } = render(<MessageList />);

    const overlay = container.querySelector(
      "[data-testid='session-context-indicator-overlay']",
    );

    expect(overlay).not.toBeNull();
    if (!(overlay instanceof HTMLElement)) {
      throw new Error("Expected context indicator overlay");
    }
    expect(overlay.className).toContain("justify-start");
    expect(overlay.className).not.toContain("md:justify-end");
  });

  it("auto-follows streamed output while the user stays pinned to the bottom", async () => {
    render(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });

    scrollToMock.mockClear();
    viewportExtraScrollHeight.value = 120;
    resizeObserverCallbacks.forEach((callback) => callback([], {} as ResizeObserver));

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 184,
        behavior: "auto",
      });
    });
  });

  it("keeps auto-follow paused after a small upward manual scroll near the bottom", async () => {
    const { container } = render(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });

    scrollToMock.mockClear();

    const viewport = container.querySelector<HTMLElement>("[data-chat-scroll-viewport]");
    expect(viewport).not.toBeNull();

    viewport!.scrollTop = 75;
    fireEvent.scroll(viewport!);

    viewportExtraScrollHeight.value = 120;
    resizeObserverCallbacks.forEach((callback) => callback([], {} as ResizeObserver));

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it("pauses auto-follow after the user scrolls away and resumes from the jump button", async () => {
    const { container } = render(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });

    scrollToMock.mockClear();

    const viewport = container.querySelector<HTMLElement>("[data-chat-scroll-viewport]");
    expect(viewport).not.toBeNull();

    fireEvent.wheel(viewport!, { deltaY: -120 });
    viewport!.scrollTop = 20;
    fireEvent.scroll(viewport!);

    let resumeButton: Element | null = null;
    await waitFor(() => {
      resumeButton = container.querySelector("[aria-label='Jump to latest message']");
      expect(resumeButton).toBeInTheDocument();
    });

    viewportExtraScrollHeight.value = 120;
    resizeObserverCallbacks.forEach((callback) => callback([], {} as ResizeObserver));

    expect(scrollToMock).not.toHaveBeenCalled();

    fireEvent.click(resumeButton!);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 184,
        behavior: "auto",
      });
    });
  });

  it("resumes auto-follow when the user scrolls back into the bottom zone", async () => {
    const { container } = render(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });

    scrollToMock.mockClear();

    const viewport = container.querySelector<HTMLElement>("[data-chat-scroll-viewport]");
    expect(viewport).not.toBeNull();

    fireEvent.wheel(viewport!, { deltaY: -120 });
    viewport!.scrollTop = 20;
    fireEvent.scroll(viewport!);

    await waitFor(() => {
      expect(
        container.querySelector("[aria-label='Jump to latest message']"),
      ).toBeInTheDocument();
    });

    viewport!.scrollTop = viewport!.scrollHeight - viewport!.clientHeight - 8;
    fireEvent.scroll(viewport!);

    await waitFor(() => {
      expect(
        container.querySelector("[aria-label='Jump to latest message']"),
      ).not.toBeInTheDocument();
    });

    viewportExtraScrollHeight.value = 120;
    resizeObserverCallbacks.forEach((callback) => callback([], {} as ResizeObserver));

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 184,
        behavior: "auto",
      });
    });
  });

  it("does not lose auto-follow after a delayed scroll sync with no user interaction", async () => {
    let now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    try {
      const { container } = render(<MessageList />);

      await waitFor(() => {
        expect(scrollToMock).toHaveBeenCalledTimes(1);
      });

      scrollToMock.mockClear();

      const viewport = container.querySelector<HTMLElement>(
        "[data-chat-scroll-viewport]",
      );
      expect(viewport).not.toBeNull();

      now += 1600;

      viewportExtraScrollHeight.value = 120;
      fireEvent.scroll(viewport!);

      expect(
        container.querySelector("[aria-label='Jump to latest message']"),
      ).not.toBeInTheDocument();

      resizeObserverCallbacks.forEach((callback) =>
        callback([], {} as ResizeObserver),
      );

      await waitFor(() => {
        expect(scrollToMock).toHaveBeenCalledWith({
          top: 184,
          behavior: "auto",
        });
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("stops retrying the active-turn measurement when layout shifts keep changing the row height", async () => {
    oscillatingActiveTurnRowIds.add("user-1");

    render(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
      expect(scrollToMock).toHaveBeenLastCalledWith({
        top: 64,
        behavior: "auto",
      });
    });

    const activeTurnBody = document.querySelector<HTMLElement>(
      "[data-chat-active-turn-body='user-1']",
    );
    expect(["184px", "204px"]).toContain(activeTurnBody?.style.minHeight ?? "");
  });

  it("does not show a long-message toggle for short user prompts", async () => {
    render(<MessageList />);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.queryByRole("button", { name: /show more/i }),
    ).not.toBeInTheDocument();
  });

  it("collapses long user prompts and keeps attachments visible", async () => {
    timelineState.items = [
      {
        key: "user-1",
        kind: "user",
        message: {
          id: "user-1",
          content:
            'Long prompt\n\n<vivd-internal type="attached-file" filename="brief.txt" />',
          createdAt: Date.UTC(2026, 2, 18, 10, 59),
        },
      },
    ];
    userMessageContentScrollHeightById["user-1"] = 280;

    render(<MessageList />);

    const toggle = await screen.findByRole("button", { name: /show more/i });

    expect(screen.getByText("brief.txt")).toBeInTheDocument();
    expect(
      document.querySelector("[data-chat-user-message-time='user-1']"),
    ).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: /show less/i })).toBeInTheDocument();
    expect(screen.getByText("brief.txt")).toBeInTheDocument();
  });
});
