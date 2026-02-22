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
    >
      <button type="button">anchor</button>
    </ProjectTagsPopover>,
  );

  return { onOpenChange, onCommitTags };
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
});
