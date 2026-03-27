import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePrePublishChecklist } from "./usePrePublishChecklist";
import type { PrePublishChecklist } from "./types";

const state = vi.hoisted(() => ({
  runChecklistMutateMock: vi.fn(),
  runChecklistIsPending: false,
  fixChecklistMutateMock: vi.fn(),
  refetchChecklistMock: vi.fn(),
  checklistData: null as
    | { checklist: PrePublishChecklist | null; hasChangesSinceCheck: boolean }
    | null,
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: state.toastSuccessMock,
    error: state.toastErrorMock,
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    agent: {
      runPrePublishChecklist: {
        useMutation: () => ({
          mutate: state.runChecklistMutateMock,
          isPending: state.runChecklistIsPending,
        }),
      },
      getPrePublishChecklist: {
        useQuery: () => ({
          data: state.checklistData,
          isLoading: false,
          refetch: state.refetchChecklistMock,
        }),
      },
      fixChecklistItem: {
        useMutation: () => ({
          mutate: state.fixChecklistMutateMock,
          isPending: false,
        }),
      },
    },
  },
}));

function createChecklist(runAt: string): PrePublishChecklist {
  return {
    projectSlug: "site-1",
    version: 1,
    runAt,
    items: [
      {
        id: "dns_record",
        label: "DNS record",
        status: "pass",
        note: "Configured correctly.",
      },
    ],
    summary: {
      passed: 1,
      failed: 0,
      warnings: 0,
      skipped: 0,
    },
  };
}

describe("usePrePublishChecklist", () => {
  beforeEach(() => {
    state.runChecklistMutateMock.mockReset();
    state.fixChecklistMutateMock.mockReset();
    state.refetchChecklistMock.mockReset();
    state.toastSuccessMock.mockReset();
    state.toastErrorMock.mockReset();
    state.runChecklistIsPending = false;
    state.checklistData = {
      checklist: createChecklist("2026-03-27T10:00:00.000Z"),
      hasChangesSinceCheck: true,
    };
    state.refetchChecklistMock.mockResolvedValue(undefined);
  });

  it("keeps reruns in a running state while the previous checklist is still loaded", () => {
    state.runChecklistMutateMock.mockImplementation(() => {
      state.runChecklistIsPending = true;
    });

    const { result, rerender } = renderHook(() =>
      usePrePublishChecklist({
        dialogOpen: true,
        projectSlug: "site-1",
        version: 1,
      }),
    );

    act(() => {
      result.current.runChecklist();
    });
    rerender();

    expect(state.refetchChecklistMock).toHaveBeenCalledTimes(1);
    expect(state.runChecklistMutateMock).toHaveBeenCalledWith({
      projectSlug: "site-1",
      version: 1,
    });
    expect(result.current.isRunningChecklist).toBe(true);
  });

  it("stops the live-running state once a newer completed checklist arrives", async () => {
    const { result, rerender } = renderHook(() =>
      usePrePublishChecklist({
        dialogOpen: true,
        projectSlug: "site-1",
        version: 1,
      }),
    );

    act(() => {
      result.current.runChecklist();
    });

    state.checklistData = {
      checklist: createChecklist("2026-03-27T10:05:00.000Z"),
      hasChangesSinceCheck: false,
    };
    rerender();

    await waitFor(() => {
      expect(result.current.isRunningChecklist).toBe(false);
    });
  });
});
