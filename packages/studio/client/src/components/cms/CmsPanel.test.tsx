import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CmsPanel } from "./CmsPanel";

const cmsStatusUseQueryMock = vi.fn();
const mutationResult = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    cms: {
      status: {
        useQuery: (...args: unknown[]) => cmsStatusUseQueryMock(...args),
      },
      init: { useMutation: () => mutationResult },
      scaffoldModel: { useMutation: () => mutationResult },
      createEntry: { useMutation: () => mutationResult },
      updateModel: { useMutation: () => mutationResult },
      prepare: { useMutation: () => mutationResult },
    },
    assets: {
      saveTextFile: { useMutation: () => mutationResult },
      deleteAsset: { useMutation: () => mutationResult },
    },
  },
}));

vi.mock("@/components/preview/PreviewContext", () => ({
  usePreview: () => ({
    handleRefresh: vi.fn(),
    setAssetsOpen: vi.fn(),
    setEditingTextFile: vi.fn(),
    setViewingImagePath: vi.fn(),
    setViewingPdfPath: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canUseAiImages: false }),
}));

vi.mock("./CmsCollectionsSidebar", () => ({
  CmsCollectionsSidebar: () => <div>collections</div>,
}));

vi.mock("./CmsEntriesSidebar", () => ({
  CmsEntriesSidebar: () => <div>entries</div>,
}));

vi.mock("./CmsEntryEditor", () => ({
  CmsEntryEditor: () => <div>entry-editor</div>,
}));

vi.mock("./CmsModelEditor", () => ({
  CmsModelEditor: () => <div>model-editor</div>,
}));

describe("CmsPanel", () => {
  beforeEach(() => {
    cmsStatusUseQueryMock.mockReset();
    cmsStatusUseQueryMock.mockReturnValue({
      data: {
        sourceKind: "astro-collections",
        initialized: true,
        valid: true,
        defaultLocale: "en",
        locales: ["en"],
        modelCount: 0,
        entryCount: 0,
        assetCount: 0,
        mediaFileCount: 0,
        errors: [],
        models: [],
      },
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("stays mounted but hidden and non-interactive when inactive", () => {
    const { rerender } = render(
      <CmsPanel projectSlug="demo" version={1} active={false} onClose={vi.fn()} />,
    );

    const heading = screen.getByText("Content");
    const panel = heading.closest('[data-state="hidden"]');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass("pointer-events-none");
    expect(panel).toHaveClass("invisible");

    rerender(<CmsPanel projectSlug="demo" version={1} active onClose={vi.fn()} />);

    const openPanel = screen.getByText("Content").closest('[data-state="open"]');
    expect(openPanel).toBeInTheDocument();
    expect(openPanel).toHaveClass("pointer-events-auto");
    expect(openPanel).toHaveClass("visible");
  });
});
