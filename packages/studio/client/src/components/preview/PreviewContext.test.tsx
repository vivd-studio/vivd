import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewProvider, usePreview } from "./PreviewContext";

const mocks = vi.hoisted(() => ({
  invalidateProjectListMock: vi.fn(),
  invalidateGitChangesMock: vi.fn(),
  cancelPreviewInfoMock: vi.fn(),
  invalidatePreviewInfoMock: vi.fn(),
  setCurrentVersionMock: vi.fn(),
  keepAliveDevServerMock: vi.fn(),
  applyHtmlPatchesMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      project: {
        list: { invalidate: mocks.invalidateProjectListMock },
        gitHasChanges: { invalidate: mocks.invalidateGitChangesMock },
        getPreviewInfo: {
          cancel: mocks.cancelPreviewInfoMock,
          invalidate: mocks.invalidatePreviewInfoMock,
        },
      },
    }),
    project: {
      list: {
        useQuery: () => ({
          data: {
            supportEmail: null,
            projects: [
              {
                slug: "demo",
                versions: [{ version: 1, status: "draft" }],
                totalVersions: 1,
                enabledPlugins: [],
              },
            ],
          },
        }),
      },
      gitHasChanges: {
        useQuery: () => ({
          data: { hasChanges: false },
        }),
      },
      setCurrentVersion: {
        useMutation: () => ({
          mutate: mocks.setCurrentVersionMock,
        }),
      },
      getPreviewInfo: {
        useQuery: () => ({
          data: {
            mode: "static",
            status: "ready",
            url: "https://preview.example/",
          },
          isLoading: false,
        }),
      },
      getShareablePreviewUrl: {
        useQuery: () => ({
          data: { url: "https://share.example/" },
        }),
      },
      keepAliveDevServer: {
        useMutation: () => ({
          mutate: mocks.keepAliveDevServerMock,
        }),
      },
      applyHtmlPatches: {
        useMutation: () => ({
          mutate: mocks.applyHtmlPatchesMock,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("@/hooks/useResizablePanel", () => ({
  useResizablePanel: () => ({
    width: 320,
    handleMouseDown: vi.fn(),
  }),
}));

vi.mock("./useImageDropZone", () => ({
  useImageDropZone: vi.fn(),
}));

vi.mock("@/lib/studioAuth", () => ({
  getVivdStudioToken: () => "studio-token",
  resolveStudioRuntimePath: (path: string) => path,
  withVivdStudioTokenQuery: (url: string) => url,
}));

vi.mock("@/lib/hostBridge", () => ({
  getVivdHostOrigin: () => "https://host.example",
}));

vi.mock("./bridge", () => ({
  getPreviewBridgeOrigin: () => "https://preview.example",
  isPreviewBridgeMessage: () => false,
}));

vi.mock("@/lib/vivdPreviewTextPatching", () => ({
  collectVivdTextPatchesFromDocument: () => [],
  getI18nKeyForEditableElement: () => null,
}));

vi.mock("./previewLeave", () => ({
  sendPreviewLeaveBeacon: vi.fn(),
}));

vi.mock("./assetPathMapping", () => ({
  toAstroRuntimeAssetPath: (assetPath: string) => assetPath,
}));

vi.mock("@/app/config/polling", () => ({
  POLLING_BACKGROUND: false,
  POLLING_DEV_SERVER_STARTING: false,
  POLLING_DEV_SERVER_KEEPALIVE: 120_000,
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function PreviewStateHarness() {
  const {
    cmsOpen,
    setCmsOpen,
    editingTextFile,
    setEditingTextFile,
    viewingImagePath,
    setViewingImagePath,
    viewingPdfPath,
    setViewingPdfPath,
  } = usePreview();

  return (
    <div>
      <button type="button" onClick={() => setCmsOpen(true)}>
        open-cms
      </button>
      <button type="button" onClick={() => setCmsOpen(false)}>
        close-cms
      </button>
      <button
        type="button"
        onClick={() => setEditingTextFile("src/content/pages/home.md")}
      >
        open-text
      </button>
      <button type="button" onClick={() => setEditingTextFile(null)}>
        close-text
      </button>
      <button
        type="button"
        onClick={() => setViewingImagePath("src/content/media/hero.webp")}
      >
        open-image
      </button>
      <button type="button" onClick={() => setViewingImagePath(null)}>
        close-image
      </button>
      <button
        type="button"
        onClick={() => setViewingPdfPath("src/content/docs/guide.pdf")}
      >
        open-pdf
      </button>
      <button type="button" onClick={() => setViewingPdfPath(null)}>
        close-pdf
      </button>
      <div data-testid="cms-state">{cmsOpen ? "open" : "closed"}</div>
      <div data-testid="text-state">{editingTextFile ?? ""}</div>
      <div data-testid="image-state">{viewingImagePath ?? ""}</div>
      <div data-testid="pdf-state">{viewingPdfPath ?? ""}</div>
    </div>
  );
}

function renderPreviewProvider(children: ReactNode) {
  return render(
    <PreviewProvider
      url="https://preview.example/"
      originalUrl="https://preview.example/"
      projectSlug="demo"
      version={1}
      onClose={vi.fn()}
    >
      {children}
    </PreviewProvider>,
  );
}

describe("PreviewProvider workspace surfaces", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    mocks.invalidateProjectListMock.mockReset();
    mocks.invalidateGitChangesMock.mockReset();
    mocks.cancelPreviewInfoMock.mockReset();
    mocks.invalidatePreviewInfoMock.mockReset();
    mocks.setCurrentVersionMock.mockReset();
    mocks.keepAliveDevServerMock.mockReset();
    mocks.applyHtmlPatchesMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("restores the CMS surface after closing a text file opened from CMS", () => {
    renderPreviewProvider(<PreviewStateHarness />);

    fireEvent.click(screen.getByRole("button", { name: "open-cms" }));
    expect(screen.getByTestId("cms-state")).toHaveTextContent("open");

    fireEvent.click(screen.getByRole("button", { name: "open-text" }));

    expect(screen.getByTestId("cms-state")).toHaveTextContent("closed");
    expect(screen.getByTestId("text-state")).toHaveTextContent(
      "src/content/pages/home.md",
    );

    fireEvent.click(screen.getByRole("button", { name: "close-text" }));

    expect(screen.getByTestId("cms-state")).toHaveTextContent("open");
    expect(screen.getByTestId("text-state")).toHaveTextContent("");
  });

  it("restores the CMS surface after closing an image opened from CMS", () => {
    renderPreviewProvider(<PreviewStateHarness />);

    fireEvent.click(screen.getByRole("button", { name: "open-cms" }));
    fireEvent.click(screen.getByRole("button", { name: "open-image" }));

    expect(screen.getByTestId("cms-state")).toHaveTextContent("closed");
    expect(screen.getByTestId("image-state")).toHaveTextContent(
      "src/content/media/hero.webp",
    );

    fireEvent.click(screen.getByRole("button", { name: "close-image" }));

    expect(screen.getByTestId("cms-state")).toHaveTextContent("open");
    expect(screen.getByTestId("image-state")).toHaveTextContent("");
  });

  it("keeps the original CMS return target while switching between file surfaces", () => {
    renderPreviewProvider(<PreviewStateHarness />);

    fireEvent.click(screen.getByRole("button", { name: "open-cms" }));
    fireEvent.click(screen.getByRole("button", { name: "open-image" }));
    fireEvent.click(screen.getByRole("button", { name: "open-pdf" }));

    expect(screen.getByTestId("cms-state")).toHaveTextContent("closed");
    expect(screen.getByTestId("pdf-state")).toHaveTextContent(
      "src/content/docs/guide.pdf",
    );

    fireEvent.click(screen.getByRole("button", { name: "close-pdf" }));

    expect(screen.getByTestId("cms-state")).toHaveTextContent("open");
    expect(screen.getByTestId("image-state")).toHaveTextContent("");
    expect(screen.getByTestId("pdf-state")).toHaveTextContent("");
  });

  it("treats toolbar-style CMS opens as root navigation", () => {
    renderPreviewProvider(<PreviewStateHarness />);

    fireEvent.click(screen.getByRole("button", { name: "open-image" }));
    expect(screen.getByTestId("image-state")).toHaveTextContent(
      "src/content/media/hero.webp",
    );

    fireEvent.click(screen.getByRole("button", { name: "open-cms" }));
    fireEvent.click(screen.getByRole("button", { name: "close-cms" }));

    expect(screen.getByTestId("cms-state")).toHaveTextContent("closed");
    expect(screen.getByTestId("text-state")).toHaveTextContent("");
    expect(screen.getByTestId("image-state")).toHaveTextContent("");
    expect(screen.getByTestId("pdf-state")).toHaveTextContent("");
  });
});
