import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTreeView, getFileTreeMoveTargets } from "./FileTreeView";
import { STUDIO_UPLOADS_PATH } from "./utils";
import type { FileTreeNode } from "./types";

const listAllAssetsUseQueryMock = vi.fn();
const moveAssetUseMutationMock = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    assets: {
      listAllAssets: {
        useQuery: (...args: unknown[]) => listAllAssetsUseQueryMock(...args),
      },
      moveAsset: {
        useMutation: (...args: unknown[]) => moveAssetUseMutationMock(...args),
      },
    },
  },
}));

vi.mock("@/components/preview/PreviewContext", () => ({
  usePreview: () => ({
    editingTextFile: null,
    setEditingTextFile: vi.fn(),
    viewingImagePath: null,
    setViewingImagePath: vi.fn(),
    viewingPdfPath: null,
    setViewingPdfPath: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/components/common", () => ({
  LoadingSpinner: ({ message }: { message?: string }) => <div>{message}</div>,
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => (
    <div data-testid="context-menu">{children}</div>
  ),
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ContextMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuSubTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ContextMenuSubContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ContextMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ContextMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  ContextMenuSeparator: () => null,
}));

function createFileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
  } as unknown as FileList;
}

const treeFixture: FileTreeNode[] = [
  {
    name: ".vivd",
    type: "folder",
    path: ".vivd",
    children: [
      {
        name: "uploads",
        type: "folder",
        path: ".vivd/uploads",
        children: [
          {
            name: "image-files-description.txt",
            type: "file",
            path: ".vivd/uploads/image-files-description.txt",
          },
        ],
      },
      {
        name: "dropped-images",
        type: "folder",
        path: ".vivd/dropped-images",
        children: [
          {
            name: "thumbnail.webp",
            type: "file",
            path: ".vivd/dropped-images/thumbnail.webp",
            isImage: true,
          },
        ],
      },
    ],
  },
  { name: "images", type: "folder", path: "images", children: [] },
  {
    name: "dist",
    type: "folder",
    path: "dist",
    children: [
      {
        name: "assets",
        type: "folder",
        path: "dist/assets",
        children: [],
      },
    ],
  },
  {
    name: "node_modules",
    type: "folder",
    path: "node_modules",
    children: [
      {
        name: "react",
        type: "folder",
        path: "node_modules/react",
        children: [],
      },
    ],
  },
  { name: "readme.md", type: "file", path: "readme.md" },
];

describe("FileTreeView", () => {
  const refetchMock = vi.fn();
  const moveMutateMock = vi.fn();

  beforeEach(() => {
    refetchMock.mockReset();
    moveMutateMock.mockReset();

    listAllAssetsUseQueryMock.mockReturnValue({
      data: {
        tree: treeFixture,
      },
      isLoading: false,
      refetch: refetchMock,
    });

    moveAssetUseMutationMock.mockReturnValue({
      mutate: moveMutateMock,
      mutateAsync: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("uploads external drops on the tree background into .vivd/uploads", async () => {
    const onFilesUpload = vi.fn().mockResolvedValue(undefined);
    const file = new File(["demo"], "logo.png", { type: "image/png" });
    const files = createFileList([file]);

    const { container } = render(
      <FileTreeView
        projectSlug="demo"
        version={1}
        onFilesUpload={onFilesUpload}
      />,
    );

    const root = container.firstElementChild as HTMLElement;
    const dataTransfer = {
      types: ["Files"],
      files,
      getData: vi.fn(() => ""),
    };

    fireEvent.dragOver(root, { dataTransfer });
    fireEvent.drop(root, { dataTransfer });

    await waitFor(() => {
      expect(onFilesUpload).toHaveBeenCalledWith(files, STUDIO_UPLOADS_PATH);
    });
  });

  it("uploads external drops on a folder row into that folder", async () => {
    const onFilesUpload = vi.fn().mockResolvedValue(undefined);
    const file = new File(["demo"], "logo.png", { type: "image/png" });
    const files = createFileList([file]);

    const { container } = render(
      <FileTreeView
        projectSlug="demo"
        version={1}
        onFilesUpload={onFilesUpload}
      />,
    );

    const folderRow = container.querySelector(
      '[data-file-tree-path="images"]',
    ) as HTMLElement | null;
    expect(folderRow).not.toBeNull();

    const dataTransfer = {
      types: ["Files"],
      files,
      getData: vi.fn(() => ""),
    };

    fireEvent.dragOver(folderRow as HTMLElement, { dataTransfer });
    fireEvent.drop(folderRow as HTMLElement, { dataTransfer });

    await waitFor(() => {
      expect(onFilesUpload).toHaveBeenCalledWith(files, "images");
    });
  });

  it("reveals and highlights the requested uploaded file path once", async () => {
    const onRevealHandled = vi.fn();
    render(
      <FileTreeView
        projectSlug="demo"
        version={1}
        revealPath=".vivd/uploads/image-files-description.txt"
        highlightedPath=".vivd/uploads/image-files-description.txt"
        onRevealHandled={onRevealHandled}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle("uploads")).toBeInTheDocument();
      expect(screen.getByTitle("image-files-description.txt")).toBeInTheDocument();
      expect(onRevealHandled).toHaveBeenCalledTimes(1);
    });

    const selectedRow = screen
      .getByTitle("image-files-description.txt")
      .closest("div");
    expect(selectedRow).toHaveClass("bg-muted");
  });

  it("moves a dropped file into the folder only once when dropped on a folder row", () => {
    const { container } = render(<FileTreeView projectSlug="demo" version={1} />);

    const folderRow = container.querySelector(
      '[data-file-tree-path="images"]',
    ) as HTMLElement | null;
    expect(folderRow).not.toBeNull();

    const dataTransfer = {
      types: ["application/x-file-path"],
      getData: vi.fn((type: string) =>
        type === "application/x-file-path" ? "readme.md" : "",
      ),
    };

    fireEvent.drop(folderRow as HTMLElement, { dataTransfer });

    expect(moveMutateMock).toHaveBeenCalledTimes(1);
    expect(moveMutateMock).toHaveBeenCalledWith({
      slug: "demo",
      version: 1,
      sourcePath: "readme.md",
      destinationPath: "images/readme.md",
    });
    expect(
      screen.queryByText("Drop here to move to root"),
    ).not.toBeInTheDocument();
  });

  it("allows moving a file from a child folder back into its expanded parent folder", () => {
    const { container } = render(<FileTreeView projectSlug="demo" version={1} />);

    const vivdRow = container.querySelector(
      '[data-file-tree-path=".vivd"]',
    ) as HTMLElement | null;
    expect(vivdRow).not.toBeNull();

    fireEvent.click(vivdRow as HTMLElement);

    const vivdDropZone = container.querySelector(
      '[data-folder-drop-zone=".vivd"]',
    ) as HTMLElement | null;
    expect(vivdDropZone).not.toBeNull();

    const dataTransfer = {
      types: ["application/x-file-path"],
      getData: vi.fn((type: string) =>
        type === "application/x-file-path"
          ? ".vivd/uploads/image-files-description.txt"
          : "",
      ),
    };

    fireEvent.dragOver(vivdDropZone as HTMLElement, { dataTransfer });
    expect(screen.getByText("Drop into .vivd")).toBeInTheDocument();

    fireEvent.drop(vivdDropZone as HTMLElement, { dataTransfer });

    expect(moveMutateMock).toHaveBeenCalledWith({
      slug: "demo",
      version: 1,
      sourcePath: ".vivd/uploads/image-files-description.txt",
      destinationPath: ".vivd/image-files-description.txt",
    });
  });

  it("only shows the active child folder indicator and keeps its indentation aligned", () => {
    const { container } = render(<FileTreeView projectSlug="demo" version={1} />);

    const vivdRow = container.querySelector(
      '[data-file-tree-path=".vivd"]',
    ) as HTMLElement | null;

    expect(vivdRow).not.toBeNull();
    fireEvent.click(vivdRow as HTMLElement);

    const uploadsRowExpanded = container.querySelector(
      '[data-file-tree-path=".vivd/uploads"]',
    ) as HTMLElement | null;
    expect(uploadsRowExpanded).not.toBeNull();
    fireEvent.click(uploadsRowExpanded as HTMLElement);

    const uploadsDropZone = container.querySelector(
      '[data-folder-drop-zone=".vivd/uploads"]',
    ) as HTMLElement | null;
    expect(uploadsDropZone).not.toBeNull();

    const dataTransfer = {
      types: ["application/x-file-path"],
      getData: vi.fn((type: string) =>
        type === "application/x-file-path" ? "images/reference.png" : "",
      ),
    };

    fireEvent.dragOver(uploadsDropZone as HTMLElement, { dataTransfer });

    const indicator = screen.getByText("Drop into uploads");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveStyle({ marginLeft: "44px" });
    expect(screen.queryByText("Drop into .vivd")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Drop here to move to root"),
    ).not.toBeInTheDocument();
  });

  it("offers move targets except the current parent, ignored folders, and descendant folders", () => {
    const fileTargets = getFileTreeMoveTargets(treeFixture, {
      name: "image-files-description.txt",
      type: "file",
      path: ".vivd/uploads/image-files-description.txt",
    });
    expect(fileTargets).toEqual([
      { path: "", label: "Project Root" },
      { path: ".vivd", label: ".vivd" },
      { path: ".vivd/dropped-images", label: ".vivd/dropped-images" },
      { path: "images", label: "images" },
    ]);

    const folderTargets = getFileTreeMoveTargets(treeFixture, {
      name: ".vivd",
      type: "folder",
      path: ".vivd",
    });
    expect(folderTargets).toEqual([
      { path: "images", label: "images" },
    ]);
  });

  it("moves a file to a selected folder via the context menu submenu", () => {
    render(<FileTreeView projectSlug="demo" version={1} />);

    const fileRow = screen.getByTitle("readme.md");
    const contextMenu = fileRow.closest('[data-testid="context-menu"]');

    expect(contextMenu).not.toBeNull();

    fireEvent.click(
      within(contextMenu as HTMLElement).getByRole("button", {
        name: ".vivd/dropped-images",
      }),
    );

    expect(moveMutateMock).toHaveBeenCalledWith({
      slug: "demo",
      version: 1,
      sourcePath: "readme.md",
      destinationPath: ".vivd/dropped-images/readme.md",
    });
  });
});
