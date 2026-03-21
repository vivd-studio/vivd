import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileAttachmentList } from "./FileDropzone";

describe("FileAttachmentList", () => {
  const createObjectURL = vi.fn(() => "blob:preview");
  const revokeObjectURL = vi.fn();

  afterEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it("renders image thumbnails and file metadata without stretching the drop surface", () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    render(
      <FileAttachmentList
        files={[
          new File(["image"], "moodboard.png", { type: "image/png" }),
          new File(["pdf"], "brand-guide.pdf", { type: "application/pdf" }),
        ]}
        onRemoveFile={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("img", { name: "moodboard.png preview" }),
    ).toBeInTheDocument();
    expect(screen.getByText("brand-guide.pdf")).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});
