import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOpencodeChatController } from "./controller";

const {
  mockToastInfo,
  mockToastError,
  createSessionMutateAsync,
  runTaskMutateAsync,
  deleteSessionMutateAsync,
  abortSessionMutate,
  revertMutateAsync,
  unrevertMutateAsync,
  replyQuestionMutateAsync,
  rejectQuestionMutateAsync,
  mockOpencodeChat,
} = vi.hoisted(() => ({
  mockToastInfo: vi.fn(),
  mockToastError: vi.fn(),
  createSessionMutateAsync: vi.fn(),
  runTaskMutateAsync: vi.fn(),
  deleteSessionMutateAsync: vi.fn(),
  abortSessionMutate: vi.fn(),
  revertMutateAsync: vi.fn(),
  unrevertMutateAsync: vi.fn(),
  replyQuestionMutateAsync: vi.fn(),
  rejectQuestionMutateAsync: vi.fn(),
  mockOpencodeChat: {
    setSelectedSessionId: vi.fn(),
    state: {
      sessionStatusById: {},
      connection: { state: "connected" as const, message: undefined },
      lastEventTime: null as number | null,
      lastEventType: null as string | null,
      lastEventId: null as string | null,
    },
    questionRequestsBySessionId: {},
    sessions: [],
    bootstrapLoading: false,
    selectedSessionId: null as string | null,
    selectedMessages: [] as any[],
    sessionStatus: null,
    selectedSessionIsError: false,
    selectedSessionError: null,
    refetchSelectedSessionMessages: vi.fn(async () => undefined),
    refetchBootstrap: vi.fn(async () => undefined),
    selectedSessionLoading: false,
    selectedHasOptimisticUserMessage: false,
    addOptimisticUserMessage: vi.fn(() => "client-1"),
    assignOptimisticUserMessageSession: vi.fn(),
    removeOptimisticUserMessage: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    info: mockToastInfo,
    error: mockToastError,
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    agent: {
      runTask: {
        useMutation: () => ({
          mutateAsync: runTaskMutateAsync,
          isPending: false,
        }),
      },
      createSession: {
        useMutation: () => ({
          mutateAsync: createSessionMutateAsync,
          isPending: false,
        }),
      },
      deleteSession: {
        useMutation: () => ({
          mutateAsync: deleteSessionMutateAsync,
          isPending: false,
        }),
      },
      revertToMessage: {
        useMutation: (options?: {
          onSuccess?: (data: unknown) => void;
          onError?: (error: Error) => void;
        }) => ({
          mutateAsync: async (...args: unknown[]) => {
            try {
              const data = await revertMutateAsync(...args);
              options?.onSuccess?.(data);
              return data;
            } catch (error) {
              options?.onError?.(error as Error);
              throw error;
            }
          },
          isPending: false,
        }),
      },
      unrevertSession: {
        useMutation: () => ({
          mutateAsync: unrevertMutateAsync,
          isPending: false,
        }),
      },
      abortSession: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            abortSessionMutate(input);
            void options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    agentChat: {
      replyQuestion: {
        useMutation: () => ({
          mutateAsync: replyQuestionMutateAsync,
          isPending: false,
        }),
      },
      rejectQuestion: {
        useMutation: () => ({
          mutateAsync: rejectQuestionMutateAsync,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("./provider", () => ({
  useOpencodeChat: () => mockOpencodeChat,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useOpencodeChatController", () => {
  beforeEach(() => {
    createSessionMutateAsync.mockReset();
    runTaskMutateAsync.mockReset();
    deleteSessionMutateAsync.mockReset();
    abortSessionMutate.mockReset();
    revertMutateAsync.mockReset();
    unrevertMutateAsync.mockReset();
    replyQuestionMutateAsync.mockReset();
    rejectQuestionMutateAsync.mockReset();
    mockToastInfo.mockReset();
    mockToastError.mockReset();

    mockOpencodeChat.setSelectedSessionId.mockReset();
    mockOpencodeChat.refetchSelectedSessionMessages.mockReset();
    mockOpencodeChat.refetchBootstrap.mockReset();
    mockOpencodeChat.addOptimisticUserMessage.mockReset();
    mockOpencodeChat.assignOptimisticUserMessageSession.mockReset();
    mockOpencodeChat.removeOptimisticUserMessage.mockReset();

    mockOpencodeChat.selectedSessionId = null;
    mockOpencodeChat.refetchBootstrap.mockResolvedValue(undefined);
    mockOpencodeChat.refetchSelectedSessionMessages.mockResolvedValue(undefined);
    mockOpencodeChat.addOptimisticUserMessage.mockReturnValue("client-1");
    createSessionMutateAsync.mockResolvedValue({
      success: true,
      sessionId: "sess-new",
      session: { id: "sess-new", title: "New Session" },
      version: 1,
    });
    runTaskMutateAsync.mockResolvedValue({
      success: true,
      sessionId: "sess-new",
      version: 1,
    });
    deleteSessionMutateAsync.mockResolvedValue({ success: true });
  });

  it("creates a new session before dispatching a new task", async () => {
    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    act(() => {
      result.current.sendTask("change the hero copy", null);
    });

    await waitFor(() => {
      expect(createSessionMutateAsync).toHaveBeenCalledWith({
        projectSlug: "site-1",
        version: 1,
      });
    });

    await waitFor(() => {
      expect(runTaskMutateAsync).toHaveBeenCalledWith({
        projectSlug: "site-1",
        task: "change the hero copy",
        sessionId: "sess-new",
        version: 1,
      });
    });

    expect(createSessionMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      runTaskMutateAsync.mock.invocationCallOrder[0],
    );
    expect(mockOpencodeChat.setSelectedSessionId).toHaveBeenCalledWith(
      "sess-new",
    );
    expect(mockOpencodeChat.addOptimisticUserMessage).toHaveBeenCalledWith({
      content: "change the hero copy",
      sessionId: "sess-new",
      createdAt: expect.any(Number),
    });
  });

  it("stops a pending new-session start before the first prompt dispatch", async () => {
    const refetchGate = deferred<undefined>();
    mockOpencodeChat.refetchBootstrap.mockReturnValue(refetchGate.promise);

    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    act(() => {
      result.current.sendTask("change the hero copy", null);
    });

    await waitFor(() => {
      expect(mockOpencodeChat.setSelectedSessionId).toHaveBeenCalledWith(
        "sess-new",
      );
    });

    act(() => {
      result.current.stopGeneration();
    });

    expect(abortSessionMutate).toHaveBeenCalledWith({
      sessionId: "sess-new",
      projectSlug: "site-1",
      version: 1,
    });

    refetchGate.resolve(undefined);

    await waitFor(() => {
      expect(deleteSessionMutateAsync).toHaveBeenCalledWith({
        sessionId: "sess-new",
        projectSlug: "site-1",
        version: 1,
      });
    });

    expect(runTaskMutateAsync).not.toHaveBeenCalled();
  });

  it("refetches session status and messages after stopping the selected session", async () => {
    mockOpencodeChat.selectedSessionId = "sess-1";

    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    act(() => {
      result.current.stopGeneration();
    });

    expect(abortSessionMutate).toHaveBeenCalledWith({
      sessionId: "sess-1",
      projectSlug: "site-1",
      version: 1,
    });

    await waitFor(() => {
      expect(mockOpencodeChat.refetchBootstrap).toHaveBeenCalledTimes(1);
      expect(mockOpencodeChat.refetchSelectedSessionMessages).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  it("refetches the selected session once when older assistant activity still shows a stale running tool", async () => {
    mockOpencodeChat.selectedSessionId = "sess-1";
    mockOpencodeChat.selectedMessages = [
      {
        info: {
          id: "msg-user",
          sessionID: "sess-1",
          role: "user",
          time: { created: 1 },
        },
        parts: [{ id: "part-user", messageID: "msg-user", type: "text", text: "Run build" }],
      },
      {
        info: {
          id: "msg-build",
          sessionID: "sess-1",
          role: "assistant",
          time: { created: 2 },
        },
        parts: [{ id: "tool-build", messageID: "msg-build", type: "tool", status: "running" }],
      },
      {
        info: {
          id: "msg-followup",
          sessionID: "sess-1",
          role: "assistant",
          time: { created: 3, completed: 4 },
        },
        parts: [{ id: "part-followup", messageID: "msg-followup", type: "text", text: "Build finished." }],
      },
    ];
    mockOpencodeChat.state.lastEventId = "evt-3";

    renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    await waitFor(() => {
      expect(mockOpencodeChat.refetchSelectedSessionMessages).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  it("does not show 'Nothing to revert' when the server reports a successful revert", async () => {
    mockOpencodeChat.selectedSessionId = "sess-1";
    revertMutateAsync.mockResolvedValue({
      success: true,
      reverted: true,
      trackedFiles: [],
    });

    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    await act(async () => {
      await result.current.revertToMessage("msg-1");
    });

    expect(revertMutateAsync).toHaveBeenCalledWith({
      sessionId: "sess-1",
      messageId: "msg-1",
      projectSlug: "site-1",
      version: 1,
    });
    expect(mockToastInfo).not.toHaveBeenCalled();
  });

  it("shows 'Nothing to revert' only when the server reports a no-op revert", async () => {
    mockOpencodeChat.selectedSessionId = "sess-1";
    revertMutateAsync.mockResolvedValue({
      success: true,
      reverted: false,
      trackedFiles: [],
    });

    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    await act(async () => {
      await result.current.revertToMessage("msg-1");
    });

    expect(mockToastInfo).toHaveBeenCalledWith("Nothing to revert", {
      description:
        "We couldn’t find any reversible changes for that message. This can happen when changes were made outside tracked edits (for example via terminal commands).",
    });
  });

  it("shows a specific toast when older snapshot history is no longer available", async () => {
    mockOpencodeChat.selectedSessionId = "sess-1";
    revertMutateAsync.mockResolvedValue({
      success: true,
      reverted: false,
      reason: "missing_snapshot_history",
      trackedFiles: ["src/pages/index.astro"],
    });

    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    await act(async () => {
      await result.current.revertToMessage("msg-1");
    });

    expect(mockToastInfo).toHaveBeenCalledWith("Revert unavailable", {
      description:
        "This older session depends on snapshot history that is no longer available on this Studio. New changes should be tracked again, but this specific revert cannot be reconstructed.",
    });
  });

  it("resolves optimistic revert clicks to the canonical user message id", async () => {
    mockOpencodeChat.selectedSessionId = "sess-1";
    mockOpencodeChat.selectedMessages = [
      {
        info: {
          id: "msg-1",
          sessionID: "sess-1",
          role: "user",
          time: { created: 1_700_000_000_000 },
        },
        parts: [
          {
            id: "part-1",
            messageID: "msg-1",
            sessionID: "sess-1",
            type: "text",
            text: "Make this text red",
          },
        ],
      },
      {
        info: {
          id: "optimistic:client-1",
          sessionID: "sess-1",
          role: "user",
          time: { created: 1_700_000_000_050 },
        },
        parts: [
          {
            id: "part-2",
            messageID: "optimistic:client-1",
            sessionID: "sess-1",
            type: "text",
            text:
              'Make this text red\n\n<vivd-internal type="element-ref" selector="//*[@id=\'hero\']" />',
          },
        ],
      },
    ];
    revertMutateAsync.mockResolvedValue({
      success: true,
      reverted: true,
      trackedFiles: ["index.html"],
    });

    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    await act(async () => {
      await result.current.revertToMessage("optimistic:client-1");
    });

    expect(revertMutateAsync).toHaveBeenCalledWith({
      sessionId: "sess-1",
      messageId: "msg-1",
      projectSlug: "site-1",
      version: 1,
    });
  });
});
