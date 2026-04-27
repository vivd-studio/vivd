import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@vivd/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditControls } from "./EditControls";

function renderEditControls(overrides: Partial<Parameters<typeof EditControls>[0]> = {}) {
  return render(
    <TooltipProvider delayDuration={0}>
      <EditControls
        projectSlug="bettinis-bikinis"
        editMode={false}
        hasUnsavedChanges={false}
        toggleEditMode={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

describe("EditControls", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps edit text compact until edit mode is active", () => {
    renderEditControls();

    const editButton = screen.getByRole("button", { name: "Edit text" });
    const editLabel = editButton.querySelector('span[aria-hidden="true"]');

    expect(editButton.className).not.toContain("hover:w");
    expect(editButton.className).not.toContain(
      "w-[var(--toolbar-expanded-width)]",
    );
    expect(editLabel?.className).not.toContain("group-hover");
    expect(editLabel).toHaveClass("opacity-0");
  });

  it("expands edit text while edit mode is active", () => {
    renderEditControls({ editMode: true });

    const editButton = screen.getByRole("button", { name: "Editing text" });
    const editLabel = editButton.querySelector('span[aria-hidden="true"]');

    expect(editButton.className).toContain("w-[var(--toolbar-expanded-width)]");
    expect(editLabel).toHaveClass("opacity-100");
  });
});
