import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("@/components/preview", () => ({
  PreviewProvider: ({ children }: { children: ReactNode }) => children,
  PreviewContent: () => <div>Preview</div>,
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: () => null,
}));

describe("App", () => {
  const originalParent = window.parent;

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: originalParent,
    });
  });

  it("replies to host ready checks when embedded", () => {
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
      { type: "vivd:studio:ready" },
      "https://host.example.com",
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:host:ready-check" },
          origin: "https://host.example.com",
          source: parentWindow as unknown as MessageEventSource,
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: "vivd:studio:ready" },
      "https://host.example.com",
    );
  });
});
