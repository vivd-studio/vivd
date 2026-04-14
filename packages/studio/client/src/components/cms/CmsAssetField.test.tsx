import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CmsAssetField } from "./CmsAssetField";

const mocks = vi.hoisted(() => ({
  assetsInvalidateMock: vi.fn(),
  editImageMutateMock: vi.fn(),
  deleteAssetMutateAsyncMock: vi.fn(),
  uploadFilesToStudioPathMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  addAttachedFileMock: vi.fn(),
  pickerPropsMock: vi.fn(),
}));

let editImageMutationOptions:
  | {
      onSuccess?: (data: { newPath: string }) => void | Promise<void>;
      onError?: (error: Error) => void;
    }
  | undefined;
let chatContextState: { addAttachedFile: typeof mocks.addAttachedFileMock } | null = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      assets: {
        invalidate: mocks.assetsInvalidateMock,
      },
    }),
    assets: {
      editImageWithAI: {
        useMutation: (options: typeof editImageMutationOptions) => {
          editImageMutationOptions = options;
          return {
            mutate: mocks.editImageMutateMock,
            isPending: false,
          };
        },
      },
      deleteAsset: {
        useMutation: () => ({
          mutateAsync: mocks.deleteAssetMutateAsyncMock,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("@/components/chat/ChatContext", () => ({
  useOptionalChatContext: () => chatContextState,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccessMock,
    error: mocks.toastErrorMock,
    info: mocks.toastInfoMock,
  },
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div data-testid="alert-dialog">{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="context-menu-content">{children}</div>
  ),
  ContextMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => <div />,
}));

vi.mock("@/components/asset-explorer/FallbackImage", () => ({
  FallbackImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock("@/components/asset-explorer/AIEditDialog", () => ({
  AIEditDialog: ({
    open,
    prompt,
    onPromptChange,
    onSubmit,
    generatedImage,
    onAcceptGeneratedImage,
    onRejectGeneratedImage,
  }: {
    open: boolean;
    prompt: string;
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    generatedImage?: { path: string } | null;
    onAcceptGeneratedImage?: () => void;
    onRejectGeneratedImage?: () => void;
  }) =>
    open ? (
      <div data-testid="ai-edit-dialog">
        <input
          aria-label="AI prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
        />
        {generatedImage ? <div>{generatedImage.path}</div> : null}
        <button type="button" onClick={onSubmit}>
          submit-ai-edit
        </button>
        {generatedImage && onAcceptGeneratedImage ? (
          <button type="button" onClick={onAcceptGeneratedImage}>
            accept-ai-edit
          </button>
        ) : null}
        {generatedImage && onRejectGeneratedImage ? (
          <button type="button" onClick={onRejectGeneratedImage}>
            reject-ai-edit
          </button>
        ) : null}
      </div>
    ) : null,
}));

vi.mock("@/components/asset-explorer/upload", () => ({
  uploadFilesToStudioPath: (...args: unknown[]) => mocks.uploadFilesToStudioPathMock(...args),
}));

vi.mock("./CmsAssetPickerSheet", () => ({
  CmsAssetPickerSheet: (props: unknown) => {
    mocks.pickerPropsMock(props);
    return null;
  },
}));

describe("CmsAssetField", () => {
  beforeEach(() => {
    mocks.assetsInvalidateMock.mockReset();
    mocks.editImageMutateMock.mockReset();
    mocks.deleteAssetMutateAsyncMock.mockReset();
    mocks.deleteAssetMutateAsyncMock.mockResolvedValue(undefined);
    mocks.uploadFilesToStudioPathMock.mockReset();
    mocks.uploadFilesToStudioPathMock.mockResolvedValue([]);
    mocks.toastSuccessMock.mockReset();
    mocks.toastErrorMock.mockReset();
    mocks.toastInfoMock.mockReset();
    mocks.addAttachedFileMock.mockReset();
    mocks.pickerPropsMock.mockReset();
    editImageMutationOptions = undefined;
    chatContextState = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the current asset until an AI edit candidate is explicitly accepted", async () => {
    const onChange = vi.fn();

    render(
      <CmsAssetField
        projectSlug="demo"
        version={1}
        fieldId="hero-image"
        label="Image"
        field={{ type: "asset", accepts: ["image/*"] }}
        value="../media/horse/apollo/horse-1.webp"
        entryRelativePath="src/content/horse/apollo.yaml"
        storageKind="content-media"
        assetRootPath="src/content/media"
        defaultFolderPath="src/content/media/horse/apollo"
        canUseAiImages
        onChange={onChange}
        onOpenAsset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "AI Edit" })[0]!);
    fireEvent.change(screen.getByLabelText("AI prompt"), {
      target: { value: "Make the horse more dramatic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "submit-ai-edit" }));

    expect(mocks.editImageMutateMock).toHaveBeenCalledWith({
      slug: "demo",
      version: 1,
      relativePath: "src/content/media/horse/apollo/horse-1.webp",
      prompt: "Make the horse more dramatic",
    });

    await act(async () => {
      await editImageMutationOptions?.onSuccess?.({
        newPath: "src/content/media/horse/apollo/horse-1-ai-edited.webp",
      });
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText("src/content/media/horse/apollo/horse-1-ai-edited.webp"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "accept-ai-edit" }));

    expect(onChange).toHaveBeenCalledWith(
      "../media/horse/apollo/horse-1-ai-edited.webp",
    );
    expect(mocks.toastSuccessMock).toHaveBeenCalledWith("Image updated");
  });

  it("adds the resolved asset path to chat from the CMS image context menu", async () => {
    chatContextState = {
      addAttachedFile: mocks.addAttachedFileMock,
    };

    render(
      <CmsAssetField
        projectSlug="demo"
        version={1}
        fieldId="hero-image"
        label="Image"
        field={{ type: "asset", accepts: ["image/*"] }}
        value="../media/horse/apollo/horse-1.webp"
        entryRelativePath="src/content/horse/apollo.yaml"
        storageKind="content-media"
        assetRootPath="src/content/media"
        defaultFolderPath="src/content/media/horse/apollo"
        canUseAiImages
        onChange={vi.fn()}
        onOpenAsset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to Chat" }));

    await waitFor(() => {
      expect(mocks.addAttachedFileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "src/content/media/horse/apollo/horse-1.webp",
          filename: "horse-1.webp",
        }),
      );
    });
  });

  it("shows a single inline path input without the old advanced disclosure copy", () => {
    render(
      <CmsAssetField
        projectSlug="demo"
        version={1}
        fieldId="hero-image"
        label="Image"
        field={{ type: "asset", accepts: ["image/*"] }}
        value="../media/horse/apollo/horse-1.webp"
        entryRelativePath="src/content/horse/apollo.yaml"
        storageKind="content-media"
        assetRootPath="src/content/media"
        defaultFolderPath="src/content/media/horse/apollo"
        canUseAiImages
        onChange={vi.fn()}
        onOpenAsset={vi.fn()}
      />,
    );

    expect(screen.queryByText("Advanced path reference")).not.toBeInTheDocument();
    const inlinePathInputs = screen.getAllByDisplayValue("../media/horse/apollo/horse-1.webp");
    expect(inlinePathInputs).toHaveLength(1);
    expect(inlinePathInputs[0]).toBeVisible();
  });

  it("overwrites the current file at the same path instead of relinking the field", async () => {
    const onChange = vi.fn();
    const file = new File(["new pdf"], "replacement.pdf", {
      type: "application/pdf",
    });
    mocks.uploadFilesToStudioPathMock.mockResolvedValue([
      "public/pdfs/products/apollo/safety-sheet.pdf",
    ]);

    const { container } = render(
      <CmsAssetField
        projectSlug="demo"
        version={1}
        fieldId="safety-sheet"
        label="Safety Sheet"
        field={{ type: "asset", accepts: [".pdf", "application/pdf"] }}
        value="/pdfs/products/apollo/safety-sheet.pdf"
        entryRelativePath="src/content/products/apollo.yaml"
        storageKind="public"
        assetRootPath="public/pdfs"
        defaultFolderPath="public/pdfs/products/apollo"
        canUseAiImages={false}
        onChange={onChange}
        onOpenAsset={vi.fn()}
      />,
    );

    const replaceInput = container.querySelector(
      "#safety-sheet-replace-upload",
    ) as HTMLInputElement;
    fireEvent.change(replaceInput, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(mocks.uploadFilesToStudioPathMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectSlug: "demo",
          version: 1,
          targetPath: "public/pdfs/products/apollo",
          filename: "safety-sheet.pdf",
        }),
      );
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(mocks.toastSuccessMock).toHaveBeenCalledWith("File replaced");
  });

  it("deletes the current file and clears the linked field after confirmation", async () => {
    const onChange = vi.fn();

    render(
      <CmsAssetField
        projectSlug="demo"
        version={1}
        fieldId="safety-sheet"
        label="Safety Sheet"
        field={{ type: "asset", accepts: [".pdf", "application/pdf"] }}
        value="/pdfs/products/apollo/safety-sheet.pdf"
        entryRelativePath="src/content/products/apollo.yaml"
        storageKind="public"
        assetRootPath="public/pdfs"
        defaultFolderPath="public/pdfs/products/apollo"
        canUseAiImages={false}
        onChange={onChange}
        onOpenAsset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete file" }));
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete file" }).at(-1)!);

    await waitFor(() => {
      expect(mocks.deleteAssetMutateAsyncMock).toHaveBeenCalledWith({
        slug: "demo",
        version: 1,
        relativePath: "public/pdfs/products/apollo/safety-sheet.pdf",
      });
    });

    expect(onChange).toHaveBeenCalledWith("");
    expect(mocks.toastSuccessMock).toHaveBeenCalledWith("File deleted");
  });

  it("routes public PDF fields through the public asset root and keeps site-root paths on replace", () => {
    const onChange = vi.fn();

    render(
      <CmsAssetField
        projectSlug="demo"
        version={1}
        fieldId="safety-sheet"
        label="Safety Sheet"
        field={{ type: "asset", accepts: [".pdf", "application/pdf"] }}
        value="/pdfs/products/apollo/safety-sheet.pdf"
        entryRelativePath="src/content/products/apollo.yaml"
        storageKind="public"
        assetRootPath="public/pdfs"
        defaultFolderPath="public/pdfs/products/apollo"
        canUseAiImages={false}
        onChange={onChange}
        onOpenAsset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose other" }));

    const latestPickerProps = mocks.pickerPropsMock.mock.calls.at(-1)?.[0] as {
      open: boolean;
      storageKind: string;
      assetRootPath: string;
      defaultFolderPath: string;
      currentValue: string;
      onSelect: (value: string) => void;
    };

    expect(latestPickerProps.open).toBe(true);
    expect(latestPickerProps.storageKind).toBe("public");
    expect(latestPickerProps.assetRootPath).toBe("public/pdfs");
    expect(latestPickerProps.defaultFolderPath).toBe("public/pdfs/products/apollo");
    expect(latestPickerProps.currentValue).toBe("public/pdfs/products/apollo/safety-sheet.pdf");

    act(() => {
      latestPickerProps.onSelect("/pdfs/products/apollo/replacement.pdf");
    });

    expect(onChange).toHaveBeenCalledWith("/pdfs/products/apollo/replacement.pdf");
  });
});
