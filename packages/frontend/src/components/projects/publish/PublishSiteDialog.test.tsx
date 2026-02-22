import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PublishSiteDialog } from "./PublishSiteDialog";

const {
  useUtilsMock,
  publishStatusUseQueryMock,
  publishStateUseQueryMock,
  publishChecklistUseQueryMock,
  checkDomainUseQueryMock,
  publishUseMutationMock,
  unpublishUseMutationMock,
  publishMutateMock,
  unpublishMutateMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useUtilsMock: vi.fn(),
  publishStatusUseQueryMock: vi.fn(),
  publishStateUseQueryMock: vi.fn(),
  publishChecklistUseQueryMock: vi.fn(),
  checkDomainUseQueryMock: vi.fn(),
  publishUseMutationMock: vi.fn(),
  unpublishUseMutationMock: vi.fn(),
  publishMutateMock: vi.fn(),
  unpublishMutateMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    project: {
      publishStatus: { useQuery: publishStatusUseQueryMock },
      publishState: { useQuery: publishStateUseQueryMock },
      publishChecklist: { useQuery: publishChecklistUseQueryMock },
      checkDomain: { useQuery: checkDomainUseQueryMock },
      publish: { useMutation: publishUseMutationMock },
      unpublish: { useMutation: unpublishUseMutationMock },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

function renderDialog() {
  return render(
    <TooltipProvider delayDuration={0}>
      <PublishSiteDialog
        open
        onOpenChange={vi.fn()}
        slug="site-1"
        version={1}
        onOpenStudio={vi.fn()}
      />
    </TooltipProvider>,
  );
}

function setCommonTrpcMocks(options: {
  stateOverrides?: Record<string, unknown>;
  publishStatusOverrides?: Record<string, unknown>;
}) {
  const invalidateMock = vi.fn().mockResolvedValue(undefined);
  useUtilsMock.mockReturnValue({
    project: {
      list: { invalidate: invalidateMock },
      publishStatus: { invalidate: invalidateMock },
      publishState: { invalidate: invalidateMock },
      getExternalPreviewStatus: { invalidate: invalidateMock },
    },
  });

  publishStatusUseQueryMock.mockReturnValue({
    data: {
      isPublished: false,
      domain: "example.com",
      commitHash: null,
      publishedAt: null,
      url: null,
      ...options.publishStatusOverrides,
    },
    refetch: vi.fn(),
  });

  publishStateUseQueryMock.mockReturnValue({
    data: {
      storageEnabled: true,
      readiness: "ready",
      sourceKind: "source",
      framework: "generic",
      publishableCommitHash: "head-123",
      lastSyncedCommitHash: "head-123",
      builtAt: "2026-02-20T10:00:00.000Z",
      sourceBuiltAt: "2026-02-20T10:00:00.000Z",
      previewBuiltAt: null,
      error: null,
      studioRunning: true,
      studioStateAvailable: true,
      studioHasUnsavedChanges: false,
      studioHeadCommitHash: "head-123",
      studioWorkingCommitHash: "head-123",
      studioStateReportedAt: "2026-02-20T10:01:00.000Z",
      ...options.stateOverrides,
    },
    refetch: vi.fn(),
  });

  publishChecklistUseQueryMock.mockReturnValue({
    data: null,
    refetch: vi.fn(),
  });

  checkDomainUseQueryMock.mockReturnValue({
    data: {
      available: true,
      normalizedDomain: "example.com",
    },
    isFetching: false,
  });

  publishUseMutationMock.mockReturnValue({
    isPending: false,
    mutate: publishMutateMock,
  });

  unpublishUseMutationMock.mockReturnValue({
    isPending: false,
    mutate: unpublishMutateMock,
  });
}

describe("PublishSiteDialog", () => {
  beforeEach(() => {
    useUtilsMock.mockReset();
    publishStatusUseQueryMock.mockReset();
    publishStateUseQueryMock.mockReset();
    publishChecklistUseQueryMock.mockReset();
    checkDomainUseQueryMock.mockReset();
    publishUseMutationMock.mockReset();
    unpublishUseMutationMock.mockReset();
    publishMutateMock.mockReset();
    unpublishMutateMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    vi.useRealTimers();
  });

  it("shows unsaved-change warning and keeps publish disabled", async () => {
    setCommonTrpcMocks({
      stateOverrides: {
        studioHasUnsavedChanges: true,
      },
    });

    renderDialog();

    expect(
      await screen.findAllByText("You have unsaved changes in Studio."),
    ).toHaveLength(2);
    const publishButton = screen.getByRole("button", { name: "Publish site" });
    expect((publishButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits publish mutation with expected commit hash when state is ready", async () => {
    vi.useFakeTimers();
    setCommonTrpcMocks({});

    renderDialog();

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    const publishButton = screen.getByRole("button", { name: "Publish site" });
    expect((publishButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(publishButton);

    expect(publishMutateMock).toHaveBeenCalledWith({
      slug: "site-1",
      version: 1,
      domain: "example.com",
      expectedCommitHash: "head-123",
    });
  });
});
