import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("@/components/preview", () => ({
  PreviewProvider: ({ children }: { children: ReactNode }) => children,
  PreviewContent: () => <div>Preview</div>,
}));

vi.mock("@vivd/ui", async () => {
  const actual = await vi.importActual<typeof import("@vivd/ui")>("@vivd/ui");
  return {
    ...actual,
    Toaster: () => null,
  };
});

describe("App", () => {
  const originalParent = window.parent;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: originalParent,
    });
  });

  it("keeps announcing readiness until the host acknowledges it", () => {
    const postMessage = vi.fn();
    const parentWindow = { postMessage };

    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parentWindow,
    });
    window.history.replaceState(
      {},
      "",
      "/?embedded=1&hostOrigin=https://host.example.com",
    );

    render(<App />);

    expect(postMessage).toHaveBeenCalledWith(
      { type: "vivd:studio:presented" },
      "https://host.example.com",
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: "vivd:studio:ready" },
      "https://host.example.com",
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(postMessage).toHaveBeenCalledTimes(4);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:host:ready-check" },
          origin: "https://host.example.com",
          source: parentWindow as unknown as MessageEventSource,
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledTimes(6);
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: "vivd:studio:ready" },
      "https://host.example.com",
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:host:ready-ack" },
          origin: "https://host.example.com",
          source: parentWindow as unknown as MessageEventSource,
        }),
      );
      vi.advanceTimersByTime(1_500);
    });

    expect(postMessage).toHaveBeenCalledTimes(6);
  });
});
