import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetExplorer } from "./AssetExplorer";
import { ASTRO_CONTENT_MEDIA_PATH, ASTRO_SHARED_MEDIA_PATH } from "./utils";

const listAssetsUseQueryMock = vi.fn();
const listAllAssetsUseQueryMock = vi.fn();
const getPreviewInfoUseQueryMock = vi.fn();
const createFolderUseMutationMock = vi.fn();
const createImageUseMutationMock = vi.fn();
const useUtilsMock = vi.fn();
const invalidateMock = vi.fn();
const refetchMock = vi.fn();
const fetchMock = vi.fn();
const createImageMutateMock = vi.fn();
let currentPreviewPath = "/";
let canUseAiImages = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => useUtilsMock(),
    project: {
      getPreviewInfo: {
        useQuery: (...args: unknown[]) => getPreviewInfoUseQueryMock(...args),
      },
    },
    assets: {
      listAssets: {
        useQuery: (...args: unknown[]) => listAssetsUseQueryMock(...args),
      },
      listAllAssets: {
        useQuery: (...args: unknown[]) => listAllAssetsUseQueryMock(...args),
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
    canUseAiImages,
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
  AssetToolbar: ({ uploadTargetPath }: { uploadTargetPath: string }) => (
    <div data-testid="asset-toolbar" data-upload-target={uploadTargetPath} />
  ),
}));

vi.mock("./CreateFolderInput", () => ({
  CreateFolderInput: () => null,
}));

vi.mock("./ImagePreviewDialog", () => ({
  ImagePreviewDialog: () => null,
}));

vi.mock("./CreateImageDialog", () => ({
  CreateImageDialog: ({
    open,
    prompt,
    onPromptChange,
    onSubmit,
  }: {
    open: boolean;
    prompt: string;
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
  }) =>
    open ? (
      <div data-testid="create-image-dialog">
        <input
          aria-label="image prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
        />
        <button type="button" onClick={onSubmit}>
          Submit image
        </button>
      </div>
    ) : null,
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
    itemsOverride,
    emptyLabel,
    onDragOver,
    onDragLeave,
    onDrop,
  }: {
    currentPath: string;
    itemsOverride?: Array<{ path: string }>;
    emptyLabel?: string;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  }) => (
    <div
      data-testid="image-gallery-view"
      data-path={currentPath}
      data-items-count={itemsOverride?.length ?? -1}
      data-item-paths={itemsOverride?.map((item) => item.path).join("|") ?? ""}
      data-empty-label={emptyLabel}
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
    createImageMutateMock.mockReset();
    getPreviewInfoUseQueryMock.mockReset();
    canUseAiImages = false;

    useUtilsMock.mockReturnValue({
      assets: {
        invalidate: invalidateMock,
      },
    });
    getPreviewInfoUseQueryMock.mockReturnValue({
      data: {
        mode: "static",
        status: "ready",
        url: "/",
      },
      isFetched: true,
      isLoading: false,
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
    listAllAssetsUseQueryMock.mockReset();
    listAllAssetsUseQueryMock.mockReturnValue({
      data: { tree: [] },
      isLoading: false,
      refetch: refetchMock,
    });

    createFolderUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    createImageUseMutationMock.mockReturnValue({
      mutate: createImageMutateMock,
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

  it("does not upload non-image files through the gallery", async () => {
    render(<AssetExplorer projectSlug="demo" version={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("image-gallery-view")).toHaveAttribute(
        "data-path",
        "public/images",
      );
    });

    const file = new File(["demo"], "brief.pdf", { type: "application/pdf" });
    const files = createFileList([file]);
    const dataTransfer = {
      types: ["Files"],
      files,
    };

    fireEvent.drop(screen.getByTestId("image-gallery-view"), {
      dataTransfer,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses src/content/media as the Astro gallery root and shared media as the default upload target", async () => {
    getPreviewInfoUseQueryMock.mockReturnValue({
      data: {
        mode: "devserver",
        status: "ready",
        url: "/",
      },
      isFetched: true,
      isLoading: false,
    });

    render(<AssetExplorer projectSlug="demo" version={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("image-gallery-view")).toHaveAttribute(
        "data-path",
        ASTRO_CONTENT_MEDIA_PATH,
      );
    });
    expect(screen.getByTestId("asset-toolbar")).toHaveAttribute(
      "data-upload-target",
      ASTRO_SHARED_MEDIA_PATH,
    );

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

    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      `path=${encodeURIComponent(ASTRO_SHARED_MEDIA_PATH)}`,
    );
  });

  it("targets generated Astro images to shared media from the gallery root", async () => {
    canUseAiImages = true;
    getPreviewInfoUseQueryMock.mockReturnValue({
      data: {
        mode: "devserver",
        status: "ready",
        url: "/",
      },
      isFetched: true,
      isLoading: false,
    });

    render(<AssetExplorer projectSlug="demo" version={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("image-gallery-view")).toHaveAttribute(
        "data-path",
        ASTRO_CONTENT_MEDIA_PATH,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate Image" }));
    fireEvent.change(screen.getByLabelText("image prompt"), {
      target: { value: "Clean hero image" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit image" }));

    expect(createImageMutateMock).toHaveBeenCalledWith({
      slug: "demo",
      version: 1,
      prompt: "Clean hero image",
      referenceImages: [],
      targetPath: ASTRO_SHARED_MEDIA_PATH,
    });
  });

  it("shows one unified Astro image library without scope tabs", async () => {
    getPreviewInfoUseQueryMock.mockReturnValue({
      data: {
        mode: "devserver",
        status: "ready",
        url: "/",
      },
      isFetched: true,
      isLoading: false,
    });
    listAllAssetsUseQueryMock.mockImplementation(
      ({ rootPath }: { rootPath: string }) => {
        const trees: Record<string, unknown[]> = {
          [ASTRO_CONTENT_MEDIA_PATH]: [
            {
              name: "shared",
              type: "folder",
              path: "src/content/media/shared",
              children: [
                {
                  name: "hero.webp",
                  type: "file",
                  path: "src/content/media/shared/hero.webp",
                  isImage: true,
                },
              ],
            },
            {
              name: "blog",
              type: "folder",
              path: "src/content/media/blog",
              children: [
                {
                  name: "welcome",
                  type: "folder",
                  path: "src/content/media/blog/welcome",
                  children: [
                    {
                      name: "inline.png",
                      type: "file",
                      path: "src/content/media/blog/welcome/inline.png",
                      isImage: true,
                    },
                  ],
                },
              ],
            },
          ],
          public: [
            {
              name: "logo.svg",
              type: "file",
              path: "public/logo.svg",
              isImage: true,
            },
            {
              name: "robots.txt",
              type: "file",
              path: "public/robots.txt",
              isImage: false,
            },
          ],
          images: [
            {
              name: "legacy.jpg",
              type: "file",
              path: "images/legacy.jpg",
              isImage: true,
            },
          ],
          assets: [
            {
              name: "readme.txt",
              type: "file",
              path: "assets/readme.txt",
              isImage: false,
            },
          ],
        };

        return {
          data: { tree: trees[rootPath] ?? [] },
          isLoading: false,
          refetch: refetchMock,
        };
      },
    );

    render(<AssetExplorer projectSlug="demo" version={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("image-gallery-view")).toHaveAttribute(
        "data-items-count",
        "4",
      );
    });
    expect(screen.getByTestId("image-gallery-view")).toHaveAttribute(
      "data-item-paths",
      [
        "src/content/media/shared/hero.webp",
        "src/content/media/blog/welcome/inline.png",
        "public/logo.svg",
        "images/legacy.jpg",
      ].join("|"),
    );
    expect(screen.queryByRole("button", { name: "All Media" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Shared" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Public" })).toBeNull();
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
    const findRecursiveQueryOptionsForRoot = (rootPath: string) =>
      listAllAssetsUseQueryMock.mock.calls.find((call) => {
        const input = call[0] as { rootPath?: string } | undefined;
        return input?.rootPath === rootPath;
      })?.[1];

    expect(findQueryOptionsForPath("public/images")).toMatchObject({
      staleTime: 0,
    });
    expect(findQueryOptionsForPath("images")).toMatchObject({
      staleTime: 0,
    });
    expect(findRecursiveQueryOptionsForRoot(ASTRO_CONTENT_MEDIA_PATH)).toMatchObject({
      staleTime: 0,
    });
    expect(findRecursiveQueryOptionsForRoot("public")).toMatchObject({
      staleTime: 0,
    });
  });
});
