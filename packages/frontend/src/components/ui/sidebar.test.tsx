import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar, SidebarProvider, SidebarTrigger } from "./sidebar";

const SIDEBAR_STORAGE_KEY = "sidebar_state";

function TestSidebar({
  defaultOpen = true,
}: {
  defaultOpen?: boolean;
}) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar>
        <div>Navigation</div>
      </Sidebar>
      <SidebarTrigger />
    </SidebarProvider>
  );
}

describe("SidebarProvider persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "sidebar_state=; path=/; max-age=0";

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("restores the desktop sidebar state from localStorage on mount", () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "false");

    render(<TestSidebar />);

    expect(screen.getByText("Navigation").closest("[data-state]")).toHaveAttribute(
      "data-state",
      "collapsed",
    );
  });

  it("persists the updated sidebar state and restores it after remount", () => {
    const { unmount } = render(<TestSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("false");
    expect(document.cookie).toContain("sidebar_state=false");

    unmount();
    render(<TestSidebar />);

    expect(screen.getByText("Navigation").closest("[data-state]")).toHaveAttribute(
      "data-state",
      "collapsed",
    );
  });
});
