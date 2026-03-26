import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpencodeChatProvider } from "./provider";

const {
  mockBootstrapRefetch,
  mockSessionMessagesRefetch,
  mockBootstrapData,
  useSubscriptionMock,
  subscriptionCallbacks,
} = vi.hoisted(() => ({
  mockBootstrapRefetch: vi.fn(async () => undefined),
  mockSessionMessagesRefetch: vi.fn(async () => undefined),
  mockBootstrapData: {
    sessions: [],
    statuses: {},
    questions: [],
    messages: [],
  },
  useSubscriptionMock: vi.fn(),
  subscriptionCallbacks: {
    onStarted: undefined as undefined | (() => void),
    onData: undefined as undefined | ((event: any) => void),
  },
}));

vi.mock("@/lib/trpc", () => {
  const React = require("react") as typeof import("react");

  return {
    trpc: {
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
            options: { onStarted?: () => void; onData?: (event: unknown) => void },
          ) => {
            useSubscriptionMock(input);
            subscriptionCallbacks.onStarted = options.onStarted;
            subscriptionCallbacks.onData = options.onData as
              | ((event: any) => void)
              | undefined;
            React.useEffect(() => {
              options.onStarted?.();
            }, []);
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
    useSubscriptionMock.mockReset();
    subscriptionCallbacks.onStarted = undefined;
    subscriptionCallbacks.onData = undefined;
    mockBootstrapRefetch.mockResolvedValue(undefined);
    mockSessionMessagesRefetch.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
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
  });
});
