import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectTagsPopover } from "./ProjectTagsPopover";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverAnchor: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function renderPopover(options?: {
  projectTags?: string[];
  availableTags?: string[];
  isSaving?: boolean;
  onDeleteTags?: (tags: string[]) => void;
}) {
  const onOpenChange = vi.fn();
  const onCommitTags = vi.fn();

  render(
    <ProjectTagsPopover
      open
      onOpenChange={onOpenChange}
      projectTags={options?.projectTags ?? ["alpha"]}
      availableTags={options?.availableTags ?? ["alpha", "beta"]}
      isSaving={options?.isSaving ?? false}
      onCommitTags={onCommitTags}
      onDeleteTags={options?.onDeleteTags}
    >
      <button type="button">anchor</button>
    </ProjectTagsPopover>,
  );

  return { onOpenChange, onCommitTags };
}

function setInlineEditLabelText(value: string) {
  const editor = screen.getByRole("textbox", { name: "Edit label text" });
  editor.textContent = value;
  fireEvent.input(editor);
  return editor;
}

describe("ProjectTagsPopover", () => {
  it("does not commit tag toggles when closing without confirmation", () => {
    const { onCommitTags, onOpenChange } = renderPopover();

    fireEvent.click(screen.getByTitle('Add "beta"'));

    expect(onCommitTags).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close labels popover" }));

    expect(onCommitTags).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("commits tag toggles when OK is clicked", () => {
    const { onCommitTags, onOpenChange } = renderPopover();

    fireEvent.click(screen.getByTitle('Add "beta"'));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(onCommitTags).toHaveBeenCalledTimes(1);
    expect(onCommitTags).toHaveBeenCalledWith(["alpha", "beta"]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not emit commit when labels are unchanged", () => {
    const { onCommitTags } = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(onCommitTags).not.toHaveBeenCalled();
  });

  it("commits newly created labels on OK", () => {
    const { onCommitTags } = renderPopover({
      projectTags: ["alpha"],
      availableTags: ["alpha"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Create a new label" }));
    fireEvent.change(screen.getByPlaceholderText("Label name…"), {
      target: { value: "  #SEO  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onCommitTags).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(onCommitTags).toHaveBeenCalledTimes(1);
    expect(onCommitTags).toHaveBeenCalledWith(["alpha", "seo"]);
  });

  it("renames an existing label when Enter is pressed in edit view", () => {
    const { onCommitTags } = renderPopover({
      projectTags: ["alpha"],
      availableTags: ["alpha"],
    });

    fireEvent.click(screen.getByTitle("Edit label"));
    const editor = setInlineEditLabelText("  #SEO  ");
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(onCommitTags).not.toHaveBeenCalled();
    expect(screen.queryByTitle('Remove "alpha"')).toBeNull();
    expect(screen.getByTitle('Remove "seo"')).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(onCommitTags).toHaveBeenCalledTimes(1);
    expect(onCommitTags).toHaveBeenCalledWith(["seo"]);
  });

  it("does not commit renamed labels when closing without confirmation", () => {
    const { onCommitTags } = renderPopover({
      projectTags: ["alpha"],
      availableTags: ["alpha"],
    });

    fireEvent.click(screen.getByTitle("Edit label"));
    setInlineEditLabelText("branding");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Close labels popover" }));

    expect(onCommitTags).not.toHaveBeenCalled();
  });

  it("deletes an existing label from edit view on OK", () => {
    const onDeleteTags = vi.fn();
    const { onCommitTags } = renderPopover({
      projectTags: ["alpha", "beta"],
      availableTags: ["alpha", "beta"],
      onDeleteTags,
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit label alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete label" }));

    expect(onCommitTags).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(onDeleteTags).toHaveBeenCalledTimes(1);
    expect(onDeleteTags).toHaveBeenCalledWith(["alpha"]);
    expect(onCommitTags).toHaveBeenCalledTimes(1);
    expect(onCommitTags).toHaveBeenCalledWith(["beta"]);
  });

  it("does not commit deleted labels when closing without confirmation", () => {
    const onDeleteTags = vi.fn();
    const { onCommitTags } = renderPopover({
      projectTags: ["alpha", "beta"],
      availableTags: ["alpha", "beta"],
      onDeleteTags,
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit label alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete label" }));
    fireEvent.click(screen.getByRole("button", { name: "Close labels popover" }));

    expect(onDeleteTags).not.toHaveBeenCalled();
    expect(onCommitTags).not.toHaveBeenCalled();
  });
});
