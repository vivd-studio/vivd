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
      lastEventTime: null,
      lastEventType: null,
      lastEventId: null,
    },
    questionRequestsBySessionId: {},
    sessions: [],
    bootstrapLoading: false,
    selectedSessionId: null as string | null,
    selectedMessages: [],
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
        useMutation: () => ({
          mutateAsync: revertMutateAsync,
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
    const refetchGate = deferred<void>();
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

    refetchGate.resolve();

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
});
