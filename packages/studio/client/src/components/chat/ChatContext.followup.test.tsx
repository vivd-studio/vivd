import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatProvider, useChatContext } from "./ChatContext";
import { FOLLOWUP_BEHAVIOR_STORAGE_KEY } from "./followupUtils";

const {
  controllerState,
  sendTaskMock,
  stopGenerationMock,
  startInitialGenerationMock,
  previewState,
} = vi.hoisted(() => ({
  sendTaskMock: vi.fn(),
  stopGenerationMock: vi.fn(),
  startInitialGenerationMock: vi.fn(),
  previewState: {
    initialGenerationRequested: false,
    pendingChatMessage: null as
      | {
          kind?: "task" | "initialGeneration";
          message: string;
          startNewSession?: boolean;
        }
      | null,
    clearPendingChatMessage: vi.fn(),
    setChatOpen: vi.fn(),
  },
  controllerState: {
    sessions: [],
    sessionsLoading: false,
    selectedSessionId: "sess-1" as string | null,
    setSelectedSessionId: vi.fn(),
    selectedMessages: [],
    sessionStatusType: "busy",
    isSessionHydrating: false,
    isReverted: false,
    activeQuestionRequest: null,
    usage: null,
    sessionError: null,
    clearSessionError: vi.fn(),
    runTaskPending: false,
    isSending: false,
    setIsSending: vi.fn(),
    isStreaming: false,
    isWaiting: false,
    isThinking: false,
    connection: { state: "connected", message: undefined },
    lastEventTime: null,
    lastEventType: null,
    lastEventId: null,
    refetchSessions: vi.fn(async () => undefined),
    sendTask: vi.fn(),
    replyQuestion: vi.fn(async () => undefined),
    rejectQuestion: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    revertToMessage: vi.fn(async () => undefined),
    unrevertSession: vi.fn(async () => undefined),
    stopGeneration: vi.fn(),
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    usage: {
      status: {
        useQuery: () => ({ data: null }),
      },
    },
    agent: {
      getAvailableModels: {
        useQuery: () => ({ data: [] }),
      },
      getRuntimeConfig: {
        useQuery: () => ({ data: { softContextLimitTokens: 250_000 } }),
      },
      startInitialGeneration: {
        useMutation: () => ({
          mutateAsync: startInitialGenerationMock,
        }),
      },
    },
  },
}));

vi.mock("../preview/PreviewContext", () => ({
  useOptionalPreview: () => previewState,
}));

vi.mock("@/features/opencodeChat", () => ({
  useOpencodeChatController: () => controllerState,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogAction: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

let latestContext: ReturnType<typeof useChatContext> | null = null;

function CaptureContext() {
  latestContext = useChatContext();
  return null;
}

describe("ChatProvider follow-up behavior", () => {
  beforeEach(() => {
    window.localStorage.clear();
    latestContext = null;

    controllerState.selectedSessionId = "sess-1";
    controllerState.sessionStatusType = "busy";
    controllerState.activeQuestionRequest = null;
    controllerState.runTaskPending = false;
    controllerState.isSending = false;
    controllerState.isStreaming = false;
    controllerState.isWaiting = false;
    controllerState.isThinking = false;
    controllerState.clearSessionError.mockReset();
    controllerState.setIsSending.mockReset();
    controllerState.setSelectedSessionId.mockReset();
    controllerState.refetchSessions.mockReset();
    sendTaskMock.mockReset();
    stopGenerationMock.mockReset();
    startInitialGenerationMock.mockReset();
    previewState.initialGenerationRequested = false;
    previewState.pendingChatMessage = null;
    previewState.clearPendingChatMessage.mockReset();
    previewState.clearPendingChatMessage.mockImplementation(() => {
      previewState.pendingChatMessage = null;
    });
    previewState.setChatOpen.mockReset();

    controllerState.sendTask = sendTaskMock;
    controllerState.stopGeneration = stopGenerationMock;
    startInitialGenerationMock.mockResolvedValue({
      sessionId: "sess-new",
      reused: false,
      status: "generating_initial_site",
    });
    sendTaskMock.mockImplementation(
      (
        _task: string,
        _sessionId: string | null,
        options?: { onCompleted?: (success: boolean) => void; onSettled?: () => void },
      ) => {
        options?.onCompleted?.(true);
        options?.onSettled?.();
      },
    );
  });

  it("queues mid-session follow-ups by default", async () => {
    controllerState.isThinking = true;

    render(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    expect(latestContext).not.toBeNull();

    act(() => {
      latestContext!.setInput("Polish the headline");
    });

    await waitFor(() => {
      expect(latestContext!.input).toBe("Polish the headline");
    });

    await act(async () => {
      await latestContext!.handleSend();
    });

    expect(latestContext!.followupBehavior).toBe("queue");
    expect(latestContext!.showSteerButton).toBe(true);
    expect(sendTaskMock).not.toHaveBeenCalled();
    expect(latestContext!.queuedFollowups).toHaveLength(1);
  });

  it("still allows an explicit steer while queue mode is active", async () => {
    controllerState.isThinking = true;

    render(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    expect(latestContext).not.toBeNull();

    act(() => {
      latestContext!.setInput("Polish the headline");
    });

    await waitFor(() => {
      expect(latestContext!.input).toBe("Polish the headline");
    });

    await act(async () => {
      await latestContext!.handleSteerSend();
    });

    expect(sendTaskMock).toHaveBeenCalledWith(
      "Polish the headline",
      "sess-1",
      {
        onCompleted: undefined,
        onSettled: undefined,
      },
    );
    expect(latestContext!.queuedFollowups).toEqual([]);
  });

  it("queues busy follow-ups in queue mode and auto-sends them when idle", async () => {
    window.localStorage.setItem(FOLLOWUP_BEHAVIOR_STORAGE_KEY, "queue");
    controllerState.isThinking = true;

    const view = render(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    act(() => {
      latestContext!.setInput("Tighten the pricing copy");
    });

    await waitFor(() => {
      expect(latestContext!.input).toBe("Tighten the pricing copy");
    });

    await act(async () => {
      await latestContext!.handleSend();
    });

    expect(sendTaskMock).not.toHaveBeenCalled();
    expect(latestContext!.queuedFollowups).toHaveLength(1);
    expect(latestContext!.queuedFollowups[0]?.preview).toBe(
      "Tighten the pricing copy",
    );

    controllerState.isThinking = false;
    view.rerender(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    await waitFor(() => {
      expect(sendTaskMock).toHaveBeenCalledWith(
        "Tighten the pricing copy",
        "sess-1",
        expect.objectContaining({
          onCompleted: expect.any(Function),
          onSettled: expect.any(Function),
        }),
      );
    });

    await waitFor(() => {
      expect(latestContext!.queuedFollowups).toEqual([]);
    });
  });

  it("keeps explicit steer available while an existing-session dispatch is still in flight", async () => {
    controllerState.runTaskPending = true;

    render(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    expect(latestContext).not.toBeNull();
    expect(latestContext!.isLoading).toBe(false);

    act(() => {
      latestContext!.setInput("Tighten the intro copy");
    });

    await waitFor(() => {
      expect(latestContext!.input).toBe("Tighten the intro copy");
    });

    await act(async () => {
      await latestContext!.handleSteerSend();
    });

    expect(sendTaskMock).toHaveBeenCalledWith(
      "Tighten the intro copy",
      "sess-1",
      {
        onCompleted: undefined,
        onSettled: undefined,
      },
    );
  });

  it("queues existing-session follow-ups while dispatch is still in flight in queue mode", async () => {
    window.localStorage.setItem(FOLLOWUP_BEHAVIOR_STORAGE_KEY, "queue");
    controllerState.runTaskPending = true;

    render(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    expect(latestContext).not.toBeNull();
    expect(latestContext!.isLoading).toBe(false);

    act(() => {
      latestContext!.setInput("Polish the FAQ answers");
    });

    await waitFor(() => {
      expect(latestContext!.input).toBe("Polish the FAQ answers");
    });

    await act(async () => {
      await latestContext!.handleSend();
    });

    expect(sendTaskMock).not.toHaveBeenCalled();
    expect(latestContext!.queuedFollowups).toHaveLength(1);
    expect(latestContext!.queuedFollowups[0]?.preview).toBe(
      "Polish the FAQ answers",
    );
  });

  it("keeps the composer locked until a new session has a target id", async () => {
    controllerState.selectedSessionId = null;
    controllerState.runTaskPending = true;

    render(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    expect(latestContext).not.toBeNull();
    expect(latestContext!.isLoading).toBe(true);

    act(() => {
      latestContext!.setInput("Start the homepage");
    });

    await waitFor(() => {
      expect(latestContext!.input).toBe("Start the homepage");
    });

    await act(async () => {
      await latestContext!.handleSend();
    });

    expect(sendTaskMock).not.toHaveBeenCalled();
    expect(latestContext!.queuedFollowups).toEqual([]);
  });

  it("pauses auto-send after stop until a queued follow-up is sent manually", async () => {
    window.localStorage.setItem(FOLLOWUP_BEHAVIOR_STORAGE_KEY, "queue");
    controllerState.isThinking = true;

    const view = render(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    act(() => {
      latestContext!.setInput("Rewrite the testimonial block");
    });

    await waitFor(() => {
      expect(latestContext!.input).toBe("Rewrite the testimonial block");
    });

    await act(async () => {
      await latestContext!.handleSend();
    });

    const queuedId = latestContext!.queuedFollowups[0]?.id;
    expect(queuedId).toBeTruthy();

    act(() => {
      latestContext!.handleStopGeneration();
    });

    expect(stopGenerationMock).toHaveBeenCalledTimes(1);

    controllerState.isThinking = false;
    view.rerender(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    expect(sendTaskMock).not.toHaveBeenCalled();

    act(() => {
      latestContext!.handleSendQueuedFollowup(queuedId!);
    });

    await waitFor(() => {
      expect(sendTaskMock).toHaveBeenCalledWith(
        "Rewrite the testimonial block",
        "sess-1",
        expect.objectContaining({
          onCompleted: expect.any(Function),
          onSettled: expect.any(Function),
        }),
      );
    });
  });

  it("keeps a pending initial-generation bootstrap until chat is ready to consume it", async () => {
    controllerState.runTaskPending = true;
    previewState.initialGenerationRequested = true;
    previewState.pendingChatMessage = {
      kind: "initialGeneration",
      message: "",
      startNewSession: true,
    };

    const view = render(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    expect(startInitialGenerationMock).not.toHaveBeenCalled();
    expect(previewState.clearPendingChatMessage).not.toHaveBeenCalled();
    expect(previewState.pendingChatMessage).not.toBeNull();

    controllerState.runTaskPending = false;
    view.rerender(
      <ChatProvider projectSlug="site-1" version={1}>
        <CaptureContext />
      </ChatProvider>,
    );

    await waitFor(() => {
      expect(startInitialGenerationMock).toHaveBeenCalledWith({
        projectSlug: "site-1",
        version: 1,
        model: undefined,
      });
    });
    expect(previewState.clearPendingChatMessage).toHaveBeenCalledTimes(1);
    expect(previewState.pendingChatMessage).toBeNull();
  });
});
