import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewEditToolbar } from "./PreviewEditToolbar";

const mockUsePreview = vi.fn();

vi.mock("./PreviewContext", () => ({
  usePreview: () => mockUsePreview(),
}));

describe("PreviewEditToolbar", () => {
  beforeEach(() => {
    mockUsePreview.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when preview editing is inactive", () => {
    mockUsePreview.mockReturnValue({
      hasUnsavedChanges: false,
      editMode: false,
      handleSave: vi.fn(),
      handleCancelEdit: vi.fn(),
      isSaving: false,
    });

    const { container } = render(<PreviewEditToolbar />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders a non-overlay toolbar with save and discard actions", () => {
    const handleSave = vi.fn();
    const handleCancelEdit = vi.fn();
    mockUsePreview.mockReturnValue({
      hasUnsavedChanges: true,
      editMode: true,
      handleSave,
      handleCancelEdit,
      isSaving: false,
    });

    const { container } = render(<PreviewEditToolbar />);

    expect(screen.getByText("Unsaved preview edits")).toBeInTheDocument();
    expect(
      screen.getByText("Save or discard the pending preview changes."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("shrink-0");
    expect(container.firstChild).not.toHaveClass("absolute");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(handleSave).toHaveBeenCalledTimes(1);
    expect(handleCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("keeps save and discard visible while edit mode is active without pending changes", () => {
    mockUsePreview.mockReturnValue({
      hasUnsavedChanges: false,
      editMode: true,
      handleSave: vi.fn(),
      handleCancelEdit: vi.fn(),
      isSaving: false,
    });

    render(<PreviewEditToolbar />);

    expect(screen.getByText("Preview edit mode")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });
});
