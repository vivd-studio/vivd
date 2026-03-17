import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useUtilsMock,
  listStudioMachinesUseQueryMock,
  imageOptionsUseQueryMock,
  setImageOverrideUseMutationMock,
  reconcileUseMutationMock,
  destroyUseMutationMock,
  setImageOverrideMutateMock,
  reconcileMutateMock,
  destroyMutateMock,
  listInvalidateMock,
  imageOptionsInvalidateMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useUtilsMock: vi.fn(),
  listStudioMachinesUseQueryMock: vi.fn(),
  imageOptionsUseQueryMock: vi.fn(),
  setImageOverrideUseMutationMock: vi.fn(),
  reconcileUseMutationMock: vi.fn(),
  destroyUseMutationMock: vi.fn(),
  setImageOverrideMutateMock: vi.fn(),
  reconcileMutateMock: vi.fn(),
  destroyMutateMock: vi.fn(),
  listInvalidateMock: vi.fn(),
  imageOptionsInvalidateMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    superadmin: {
      listStudioMachines: {
        useQuery: listStudioMachinesUseQueryMock,
      },
      getStudioMachineImageOptions: {
        useQuery: imageOptionsUseQueryMock,
      },
      setStudioMachineImageOverrideTag: {
        useMutation: setImageOverrideUseMutationMock,
      },
      reconcileStudioMachines: {
        useMutation: reconcileUseMutationMock,
      },
      destroyStudioMachine: {
        useMutation: destroyUseMutationMock,
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

import { MachinesTab } from "./MachinesTab";

function makeMachine(overrides: Record<string, unknown> = {}) {
  return {
    id: "machine-1",
    name: "studio-machine-1",
    organizationId: "org-1",
    projectSlug: "site-1",
    version: 1,
    state: "started",
    createdAt: "2026-02-22T10:00:00.000Z",
    imageOutdated: false,
    image: "ghcr.io/vivd-studio/vivd-studio:v0.1.0",
    desiredImage: "ghcr.io/vivd-studio/vivd-studio:v0.1.0",
    cpuKind: "shared",
    cpus: 1,
    memoryMb: 1024,
    region: "ams",
    externalPort: 443,
    routePath: null,
    url: "https://studio.example.com",
    ...overrides,
  };
}

describe("MachinesTab", () => {
  beforeEach(() => {
    useUtilsMock.mockReset();
    listStudioMachinesUseQueryMock.mockReset();
    imageOptionsUseQueryMock.mockReset();
    setImageOverrideUseMutationMock.mockReset();
    reconcileUseMutationMock.mockReset();
    destroyUseMutationMock.mockReset();
    setImageOverrideMutateMock.mockReset();
    reconcileMutateMock.mockReset();
    destroyMutateMock.mockReset();
    listInvalidateMock.mockReset();
    imageOptionsInvalidateMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();

    listInvalidateMock.mockResolvedValue(undefined);
    imageOptionsInvalidateMock.mockResolvedValue(undefined);

    useUtilsMock.mockReturnValue({
      superadmin: {
        listStudioMachines: { invalidate: listInvalidateMock },
        getStudioMachineImageOptions: { invalidate: imageOptionsInvalidateMock },
      },
    });

    listStudioMachinesUseQueryMock.mockReturnValue({
      data: {
        provider: "fly",
        machines: [makeMachine()],
      },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    imageOptionsUseQueryMock.mockReturnValue({
      data: {
        provider: "fly",
        supported: false,
        selectionMode: "unsupported",
      },
    });

    setImageOverrideUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: setImageOverrideMutateMock,
    });
    reconcileUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: reconcileMutateMock,
    });
    destroyUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: destroyMutateMock,
    });
  });

  it("renders machine stats and list errors from query payload", () => {
    listStudioMachinesUseQueryMock.mockReturnValueOnce({
      data: {
        provider: "fly",
        machines: [makeMachine({ imageOutdated: true, state: "suspended" })],
        error: "fly unavailable",
      },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    render(<MachinesTab />);

    expect(
      screen.getByText("Failed to list machines: fly unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("total 1")).toBeInTheDocument();
    expect(screen.getByText("outdated 1")).toBeInTheDocument();
    expect(screen.getByText("suspended 1")).toBeInTheDocument();
  });

  it("calls refetch when Refresh is clicked", () => {
    const refetchMock = vi.fn();
    listStudioMachinesUseQueryMock.mockReturnValueOnce({
      data: {
        provider: "fly",
        machines: [makeMachine()],
      },
      isLoading: false,
      isFetching: false,
      refetch: refetchMock,
    });

    render(<MachinesTab />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows empty-state copy when provider returns no machines", () => {
    listStudioMachinesUseQueryMock.mockReturnValueOnce({
      data: {
        provider: "fly",
        machines: [],
      },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    render(<MachinesTab />);

    expect(screen.getByText("No studio machines found.")).toBeInTheDocument();
  });

  it("runs reconcile mutation after confirmation", () => {
    render(<MachinesTab />);

    fireEvent.click(screen.getByRole("button", { name: "Reconcile now" }));
    fireEvent.click(screen.getByRole("button", { name: "Run reconcile" }));

    expect(reconcileMutateMock).toHaveBeenCalledTimes(1);
  });

  it("renders Docker route paths with provider-neutral labels", () => {
    listStudioMachinesUseQueryMock.mockReturnValueOnce({
      data: {
        provider: "docker",
        machines: [
          makeMachine({
            id: "container-1",
            region: null,
            externalPort: null,
            routePath: "/_studio/site-1-v1",
          }),
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    render(<MachinesTab />);

    expect(screen.getByRole("button", { name: "Container" })).toBeInTheDocument();
    expect(screen.getByText("/_studio/site-1-v1")).toBeInTheDocument();
    expect(screen.getByText("single-host")).toBeInTheDocument();
  });
});
