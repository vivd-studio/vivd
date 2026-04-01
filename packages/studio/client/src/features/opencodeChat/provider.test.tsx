import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpencodeChatProvider } from "./provider";
import type { OpenCodeChatBootstrap } from "./types";

const {
  mockBootstrapRefetch,
  mockSessionMessagesRefetch,
  mockSessionMessagesFetch,
  mockBootstrapData,
  useSubscriptionMock,
  subscriptionCallbacks,
} = vi.hoisted(() => ({
  mockBootstrapRefetch: vi.fn(async () => undefined),
  mockSessionMessagesRefetch: vi.fn(async () => undefined),
  mockSessionMessagesFetch: vi.fn(async () => []),
  mockBootstrapData: {
    sessions: [],
    statuses: {},
    questions: [],
    messages: [],
  } as OpenCodeChatBootstrap,
  useSubscriptionMock: vi.fn(),
  subscriptionCallbacks: {
    onStarted: undefined as undefined | (() => void),
    onData: undefined as undefined | ((event: any) => void),
    onError: undefined as undefined | ((error: Error) => void),
  },
}));

vi.mock("@/lib/trpc", () => {
  const React = require("react") as typeof import("react");

  return {
    trpc: {
      useUtils: () => ({
        agentChat: {
          sessionMessages: {
            fetch: mockSessionMessagesFetch,
          },
        },
      }),
      agentChat: {
        bootstrap: {
          useQuery: () => ({
            data: mockBootstrapData,
            isLoading: false,
            refetch: mockBootstrapRefetch,
          }),
        },
        sessionMessages: {
          useQuery: () => ({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
            refetch: mockSessionMessagesRefetch,
          }),
        },
        events: {
          useSubscription: (
            input: unknown,
            options: {
              onStarted?: () => void;
              onData?: (event: unknown) => void;
              onError?: (error: Error) => void;
            },
          ) => {
            const subscriptionKey = JSON.stringify(input);
            useSubscriptionMock(input);
            subscriptionCallbacks.onStarted = options.onStarted;
            subscriptionCallbacks.onData = options.onData as
              | ((event: any) => void)
              | undefined;
            subscriptionCallbacks.onError = options.onError;
            React.useEffect(() => {
              options.onStarted?.();
            }, [subscriptionKey]);
          },
        },
      },
    },
  };
});

describe("OpencodeChatProvider", () => {
  beforeEach(() => {
    mockBootstrapRefetch.mockReset();
    mockSessionMessagesRefetch.mockReset();
    mockSessionMessagesFetch.mockReset();
    useSubscriptionMock.mockReset();
    subscriptionCallbacks.onStarted = undefined;
    subscriptionCallbacks.onData = undefined;
    subscriptionCallbacks.onError = undefined;
    mockBootstrapRefetch.mockResolvedValue(undefined);
    mockSessionMessagesRefetch.mockResolvedValue(undefined);
    mockSessionMessagesFetch.mockResolvedValue([]);
    mockBootstrapData.sessions = [];
    mockBootstrapData.statuses = {};
    mockBootstrapData.messages = [];
    mockBootstrapData.questions = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("reconciles bootstrap state once after the event stream connects", async () => {
    render(
      <OpencodeChatProvider projectSlug="site-1" version={1}>
        <div>chat</div>
      </OpencodeChatProvider>,
    );

    await waitFor(() => {
      expect(mockBootstrapRefetch).toHaveBeenCalledTimes(1);
    });

    expect(useSubscriptionMock).toHaveBeenCalledWith({
      projectSlug: "site-1",
      version: 1,
      replayBuffered: false,
      subscriptionInstance: 0,
    });
  });

  it("reconciles again after a reconnecting bridge recovers to connected", async () => {
    render(
      <OpencodeChatProvider projectSlug="site-1" version={1}>
        <div>chat</div>
      </OpencodeChatProvider>,
    );

    await waitFor(() => {
      expect(mockBootstrapRefetch).toHaveBeenCalledTimes(1);
    });

    act(() => {
      subscriptionCallbacks.onData?.({
        id: "evt-1",
        data: {
          eventId: "evt-1",
          type: "bridge.status",
          properties: { state: "reconnecting", message: "stream lost" },
        },
      });
      subscriptionCallbacks.onData?.({
        id: "evt-2",
        data: {
          eventId: "evt-2",
          type: "bridge.status",
          properties: { state: "connected" },
        },
      });
    });

    await waitFor(() => {
      expect(mockBootstrapRefetch).toHaveBeenCalledTimes(2);
    });
  });

  it("reconciles when the tab becomes visible after the stream has gone stale", async () => {
    render(
      <OpencodeChatProvider projectSlug="site-1" version={1}>
        <div>chat</div>
      </OpencodeChatProvider>,
    );

    await waitFor(() => {
      expect(mockBootstrapRefetch).toHaveBeenCalledTimes(1);
    });

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(mockBootstrapRefetch).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(useSubscriptionMock).toHaveBeenLastCalledWith({
        projectSlug: "site-1",
        version: 1,
        replayBuffered: false,
        subscriptionInstance: 1,
      });
    });
  });

  it("restarts the subscription when the stream goes inactive while visible", async () => {
    vi.useFakeTimers();

    render(
      <OpencodeChatProvider projectSlug="site-1" version={1}>
        <div>chat</div>
      </OpencodeChatProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockBootstrapRefetch).toHaveBeenCalledTimes(1);
    expect(useSubscriptionMock).toHaveBeenLastCalledWith({
      projectSlug: "site-1",
      version: 1,
      replayBuffered: false,
      subscriptionInstance: 0,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useSubscriptionMock).toHaveBeenLastCalledWith({
      projectSlug: "site-1",
      version: 1,
      replayBuffered: false,
      subscriptionInstance: 1,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockBootstrapRefetch).toHaveBeenCalledTimes(2);
  });

  it("restarts the subscription after a stream error instead of leaving the connection terminal", async () => {
    vi.useFakeTimers();

    render(
      <OpencodeChatProvider projectSlug="site-1" version={1}>
        <div>chat</div>
      </OpencodeChatProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useSubscriptionMock).toHaveBeenLastCalledWith({
      projectSlug: "site-1",
      version: 1,
      replayBuffered: false,
      subscriptionInstance: 0,
    });

    act(() => {
      subscriptionCallbacks.onError?.(new Error("stream lost"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useSubscriptionMock).toHaveBeenLastCalledWith({
      projectSlug: "site-1",
      version: 1,
      replayBuffered: false,
      subscriptionInstance: 1,
    });
  });

  it("reconciles non-selected active sessions during a queued refresh", async () => {
    mockBootstrapData.sessions = [
      { id: "sess-selected", time: { updated: 20 } },
      { id: "sess-active", time: { updated: 10 } },
    ];
    mockBootstrapData.statuses = {
      "sess-selected": { type: "idle" },
      "sess-active": { type: "busy" },
    };

    render(
      <OpencodeChatProvider projectSlug="site-1" version={1}>
        <div>chat</div>
      </OpencodeChatProvider>,
    );

    await waitFor(() => {
      expect(mockBootstrapRefetch).toHaveBeenCalledTimes(1);
    });

    expect(mockSessionMessagesFetch).toHaveBeenCalledWith({
      projectSlug: "site-1",
      version: 1,
      sessionId: "sess-active",
    });
  });
});
