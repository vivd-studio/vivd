import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@vivd/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickActions } from "./QuickActions";

const baseProps = {
  projectSlug: "bettinis-bikinis",
  selectedVersion: 1,
  previewMode: "static" as const,
  originalUrl: null,
  copied: false,
  publicPreviewEnabled: true,
  handleCopy: vi.fn(),
  handleOpenPreviewUrl: vi.fn(),
  setHistoryPanelOpen: vi.fn(),
  historyPanelOpen: false,
  setPublishDialogOpen: vi.fn(),
  publishDialogOpen: false,
  hasGitChanges: false,
  isPublished: false,
  publishStatus: { mode: "connected" as const },
};

function renderQuickActions(overrides: Partial<typeof baseProps> = {}) {
  return render(
    <TooltipProvider delayDuration={0}>
      <QuickActions {...baseProps} {...overrides} />
    </TooltipProvider>,
  );
}

describe("QuickActions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps desktop actions compact until their dialog is active", () => {
    renderQuickActions();

    const snapshotsButton = screen.getByRole("button", { name: "Snapshots" });
    const snapshotsLabel = snapshotsButton.querySelector(
      'span[aria-hidden="true"]',
    );

    expect(snapshotsButton.className).not.toContain("hover:w");
    expect(snapshotsButton.className).not.toContain(
      "w-[var(--toolbar-expanded-width)]",
    );
    expect(snapshotsLabel?.className).not.toContain("group-hover");
    expect(snapshotsLabel).toHaveClass("opacity-0");
  });

  it("expands desktop actions while their dialog is active", () => {
    renderQuickActions({ historyPanelOpen: true });

    const snapshotsButton = screen.getByRole("button", { name: "Snapshots" });
    const snapshotsLabel = snapshotsButton.querySelector(
      'span[aria-hidden="true"]',
    );

    expect(snapshotsButton.className).toContain(
      "w-[var(--toolbar-expanded-width)]",
    );
    expect(snapshotsLabel).toHaveClass("opacity-100");
  });
});
