import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ProjectWizard } from "./ProjectWizard";

const SIDEBAR_STORAGE_KEY = "sidebar_state";

describe("ProjectWizard", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "sidebar_state=; path=/; max-age=0";

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

  it("keeps the sidebar state when starting a new project", async () => {
    render(
      <MemoryRouter>
        <SidebarProvider defaultOpen>
          <ProjectWizard />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "New Project" }));

    await waitFor(() => {
      expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");
    });
  });
});
