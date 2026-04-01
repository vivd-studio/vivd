import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetExplorer } from "./AssetExplorer";

const listAssetsUseQueryMock = vi.fn();
const createFolderUseMutationMock = vi.fn();
const createImageUseMutationMock = vi.fn();
const useUtilsMock = vi.fn();
const invalidateMock = vi.fn();
const refetchMock = vi.fn();
const fetchMock = vi.fn();
let currentPreviewPath = "/";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => useUtilsMock(),
    assets: {
      listAssets: {
        useQuery: (...args: unknown[]) => listAssetsUseQueryMock(...args),
      },
      createFolder: {
        useMutation: (...args: unknown[]) => createFolderUseMutationMock(...args),
      },
      createImageWithAI: {
        useMutation: (...args: unknown[]) => createImageUseMutationMock(...args),
      },
    },
  },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canUseAiImages: false,
  }),
}));

vi.mock("@/components/preview/PreviewContext", () => ({
  usePreview: () => ({
    currentPreviewPath,
    setEditingTextFile: vi.fn(),
    setEditingAsset: vi.fn(),
    setPendingDeleteAsset: vi.fn(),
  }),
}));

vi.mock("@/components/chat/ChatContext", () => ({
  useOptionalChatContext: () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("./AssetToolbar", () => ({
  AssetToolbar: () => <div data-testid="asset-toolbar" />,
}));

vi.mock("./CreateFolderInput", () => ({
  CreateFolderInput: () => null,
}));

vi.mock("./ImagePreviewDialog", () => ({
  ImagePreviewDialog: () => null,
}));

vi.mock("./CreateImageDialog", () => ({
  CreateImageDialog: () => null,
}));

vi.mock("./ViewModeToggle", () => ({
  ViewModeToggle: () => <div data-testid="view-mode-toggle" />,
}));

vi.mock("./FileTreeView", () => ({
  FileTreeView: () => <div data-testid="file-tree-view" />,
}));

vi.mock("./ImageGalleryView", () => ({
  ImageGalleryView: ({
    currentPath,
    onDragOver,
    onDragLeave,
    onDrop,
  }: {
    currentPath: string;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  }) => (
    <div
      data-testid="image-gallery-view"
      data-path={currentPath}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    />
  ),
}));

function createFileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
  } as unknown as FileList;
}

describe("AssetExplorer", () => {
  beforeEach(() => {
    localStorage.clear();
    currentPreviewPath = "/";
    invalidateMock.mockReset();
    refetchMock.mockReset();
    fetchMock.mockReset();

    useUtilsMock.mockReturnValue({
      assets: {
        invalidate: invalidateMock,
      },
    });

    listAssetsUseQueryMock.mockImplementation(
      ({ relativePath }: { relativePath: string }) => {
        if (relativePath === "public/images") {
          return {
            data: {
              items: [
                {
                  name: "existing.png",
                  type: "file",
                  path: "public/images/existing.png",
                  isImage: true,
                },
              ],
            },
            isFetched: true,
            isLoading: false,
            refetch: refetchMock,
          };
        }

        return {
          data: { items: [] },
          isFetched: true,
          isLoading: false,
          refetch: refetchMock,
        };
      },
    );

    createFolderUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    createImageUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        uploaded: ["public/images/logo.png"],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uploads gallery drops into the current folder instead of .vivd/uploads", async () => {
    render(<AssetExplorer projectSlug="demo" version={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("image-gallery-view")).toHaveAttribute(
        "data-path",
        "public/images",
      );
    });

    const file = new File(["demo"], "logo.png", { type: "image/png" });
    const files = createFileList([file]);
    const dataTransfer = {
      types: ["Files"],
      files,
    };

    fireEvent.dragOver(screen.getByTestId("image-gallery-view"), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByTestId("image-gallery-view"), {
      dataTransfer,
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("path=public%2Fimages");
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain(
      "path=.vivd%2Fuploads",
    );
  });

  it("revalidates asset queries when the preview route changes", async () => {
    const { rerender } = render(<AssetExplorer projectSlug="demo" version={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("image-gallery-view")).toHaveAttribute(
        "data-path",
        "public/images",
      );
    });

    expect(invalidateMock).not.toHaveBeenCalled();

    currentPreviewPath = "/pricing";
    rerender(<AssetExplorer projectSlug="demo" version={1} />);

    await waitFor(() => {
      expect(invalidateMock).toHaveBeenCalledTimes(1);
    });
  });

  it("marks the explorer asset queries as immediately stale", () => {
    render(<AssetExplorer projectSlug="demo" version={1} />);

    const findQueryOptionsForPath = (relativePath: string) =>
      listAssetsUseQueryMock.mock.calls.find((call) => {
        const input = call[0] as { relativePath?: string } | undefined;
        return input?.relativePath === relativePath;
      })?.[1];

    expect(findQueryOptionsForPath("public/images")).toMatchObject({
      staleTime: 0,
    });
    expect(findQueryOptionsForPath("images")).toMatchObject({
      staleTime: 0,
    });
    expect(findQueryOptionsForPath(".vivd/uploads")).toMatchObject({
      staleTime: 0,
    });
  });
});
