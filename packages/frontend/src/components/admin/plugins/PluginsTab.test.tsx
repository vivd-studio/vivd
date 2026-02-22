import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useUtilsMock,
  listAccessUseQueryMock,
  upsertEntitlementUseMutationMock,
  upsertEntitlementMutateMock,
  listAccessInvalidateMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useUtilsMock: vi.fn(),
  listAccessUseQueryMock: vi.fn(),
  upsertEntitlementUseMutationMock: vi.fn(),
  upsertEntitlementMutateMock: vi.fn(),
  listAccessInvalidateMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    superadmin: {
      pluginsListAccess: {
        useQuery: listAccessUseQueryMock,
      },
      pluginsUpsertEntitlement: {
        useMutation: upsertEntitlementUseMutationMock,
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

import { PluginsTab } from "./PluginsTab";

describe("PluginsTab", () => {
  beforeEach(() => {
    useUtilsMock.mockReset();
    listAccessUseQueryMock.mockReset();
    upsertEntitlementUseMutationMock.mockReset();
    upsertEntitlementMutateMock.mockReset();
    listAccessInvalidateMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();

    listAccessInvalidateMock.mockResolvedValue(undefined);

    useUtilsMock.mockReturnValue({
      superadmin: {
        pluginsListAccess: {
          invalidate: listAccessInvalidateMock,
        },
      },
    });

    listAccessUseQueryMock.mockReturnValue({
      data: {
        rows: [],
      },
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    upsertEntitlementUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: upsertEntitlementMutateMock,
    });
  });

  it("renders a plugin tab bar that makes Contact Form scope explicit", () => {
    render(<PluginsTab />);

    expect(screen.getByRole("tab", { name: "Contact Form" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose a plugin tab to manage entitlements. This list currently shows Contact Form access.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Selected plugin controls the project access list below. This tab manages Contact Form enablement, limits, and Turnstile behavior.",
      ),
    ).toBeInTheDocument();
  });

  it("queries plugin access with the active Contact Form plugin id", () => {
    render(<PluginsTab />);

    expect(listAccessUseQueryMock).toHaveBeenCalledWith({
      pluginId: "contact_form",
      search: undefined,
      state: undefined,
      limit: 500,
      offset: 0,
    });
  });
});
