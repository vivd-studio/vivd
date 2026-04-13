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
  respondPermissionMutateAsync,
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
  respondPermissionMutateAsync: vi.fn(),
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
    permissionRequestsBySessionId: {},
    sessions: [] as any[],
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
      respondPermission: {
        useMutation: () => ({
          mutateAsync: respondPermissionMutateAsync,
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
    respondPermissionMutateAsync.mockReset();
    mockToastInfo.mockReset();
    mockToastError.mockReset();

    mockOpencodeChat.setSelectedSessionId.mockReset();
    mockOpencodeChat.refetchSelectedSessionMessages.mockReset();
    mockOpencodeChat.refetchBootstrap.mockReset();
    mockOpencodeChat.addOptimisticUserMessage.mockReset();
    mockOpencodeChat.assignOptimisticUserMessageSession.mockReset();
    mockOpencodeChat.removeOptimisticUserMessage.mockReset();

    mockOpencodeChat.selectedSessionId = null;
    mockOpencodeChat.selectedMessages = [];
    mockOpencodeChat.sessionStatus = null;
    mockOpencodeChat.questionRequestsBySessionId = {};
    mockOpencodeChat.permissionRequestsBySessionId = {};
    mockOpencodeChat.state.sessionStatusById = {};
    mockOpencodeChat.state.connection = {
      state: "connected",
      message: undefined,
    };
    mockOpencodeChat.state.lastEventTime = null;
    mockOpencodeChat.state.lastEventType = null;
    mockOpencodeChat.state.lastEventId = null;
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

  it("passes the selected model variant through runTask payloads", async () => {
    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: {
          provider: "openrouter",
          modelId: "openai/gpt-5.4",
          variant: "high",
        },
      }),
    );

    act(() => {
      result.current.sendTask("review the site", "sess-1");
    });

    await waitFor(() => {
      expect(runTaskMutateAsync).toHaveBeenCalledWith({
        projectSlug: "site-1",
        task: "review the site",
        sessionId: "sess-1",
        version: 1,
        model: {
          provider: "openrouter",
          modelId: "openai/gpt-5.4",
          variant: "high",
        },
      });
    });
  });

  it("locks onto an explicitly requested session on mount", async () => {
    renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
        initialSelectedSessionId: "sess-started",
      }),
    );

    await waitFor(() => {
      expect(mockOpencodeChat.setSelectedSessionId).toHaveBeenCalledWith(
        "sess-started",
      );
    });
  });

  it("responds to permission requests with session context", async () => {
    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    await act(async () => {
      await result.current.respondPermission("perm-1", "sess-1", "once");
    });

    expect(respondPermissionMutateAsync).toHaveBeenCalledWith({
      projectSlug: "site-1",
      version: 1,
      requestId: "perm-1",
      sessionId: "sess-1",
      response: "once",
    });
  });

  it("does not auto-select an unrelated session during initial generation without a handed-off session id", async () => {
    mockOpencodeChat.sessions = [
      {
        id: "sess-latest",
        title: "Newest session",
        time: { updated: Date.UTC(2026, 3, 1, 12, 0) },
      },
      {
        id: "sess-older",
        title: "Older session",
        time: { updated: Date.UTC(2026, 3, 1, 11, 0) },
      },
    ];

    renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
        initialGenerationRequested: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockOpencodeChat.setSelectedSessionId).not.toHaveBeenCalledWith(
      "sess-latest",
    );
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

  it("reconciles the selected session snapshot after sending a follow-up into the active session", async () => {
    mockOpencodeChat.selectedSessionId = "sess-1";
    runTaskMutateAsync.mockResolvedValue({
      success: true,
      sessionId: "sess-1",
      version: 1,
    });

    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    act(() => {
      result.current.sendTask("steer here", "sess-1");
    });

    await waitFor(() => {
      expect(runTaskMutateAsync).toHaveBeenCalledWith({
        projectSlug: "site-1",
        task: "steer here",
        sessionId: "sess-1",
        version: 1,
      });
    });

    await waitFor(() => {
      expect(mockOpencodeChat.refetchBootstrap).toHaveBeenCalledTimes(1);
      expect(mockOpencodeChat.refetchSelectedSessionMessages).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  it("does not report task completion until the active session reaches a terminal status", async () => {
    const onTaskComplete = vi.fn();
    mockOpencodeChat.selectedSessionId = "sess-1";
    mockOpencodeChat.sessionStatus = { type: "busy" } as any;

    const { rerender } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
        onTaskComplete,
      }),
    );

    expect(onTaskComplete).not.toHaveBeenCalled();

    mockOpencodeChat.sessionStatus = null;
    rerender();

    expect(onTaskComplete).not.toHaveBeenCalled();

    mockOpencodeChat.sessionStatus = { type: "done" } as any;
    rerender();

    await waitFor(() => {
      expect(onTaskComplete).toHaveBeenCalledTimes(1);
    });
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

  it("clears the local working state immediately after stopping a selected session even if a fresh assistant shell is still visible", async () => {
    mockOpencodeChat.selectedSessionId = "sess-1";
    mockOpencodeChat.sessionStatus = { type: "idle" } as any;
    mockOpencodeChat.selectedMessages = [
      {
        info: {
          id: "msg-user",
          sessionID: "sess-1",
          role: "user",
          time: { created: Date.now() - 2_000 },
        },
        parts: [],
      },
      {
        info: {
          id: "msg-assistant",
          sessionID: "sess-1",
          role: "assistant",
          time: { created: Date.now() - 1_000 },
        },
        parts: [],
      },
    ];

    const { result } = renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    expect(result.current.isThinking).toBe(true);

    act(() => {
      result.current.stopGeneration();
    });

    expect(abortSessionMutate).toHaveBeenCalledWith({
      sessionId: "sess-1",
      projectSlug: "site-1",
      version: 1,
    });

    await waitFor(() => {
      expect(result.current.isThinking).toBe(false);
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

  it("reconciles a visible active session after event silence leaves it locally stuck in working state", async () => {
    vi.useFakeTimers();
    mockOpencodeChat.selectedSessionId = "sess-1";
    mockOpencodeChat.sessionStatus = { type: "busy" } as any;
    mockOpencodeChat.selectedMessages = [
      {
        info: {
          id: "msg-user",
          sessionID: "sess-1",
          role: "user",
          time: { created: 1 },
        },
        parts: [{ id: "part-user", messageID: "msg-user", type: "text", text: ":)" }],
      },
    ];

    renderHook(() =>
      useOpencodeChatController({
        projectSlug: "site-1",
        version: 1,
        selectedModel: null,
      }),
    );

    expect(mockOpencodeChat.refetchBootstrap).not.toHaveBeenCalled();
    expect(mockOpencodeChat.refetchSelectedSessionMessages).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(mockOpencodeChat.refetchBootstrap).toHaveBeenCalledTimes(1);
    expect(mockOpencodeChat.refetchSelectedSessionMessages).toHaveBeenCalledTimes(
      1,
    );
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
