import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useUtilsMock,
  listAccessUseQueryMock,
  upsertEntitlementUseMutationMock,
  upsertEntitlementMutateAsyncMock,
  listAccessInvalidateMock,
  toastSuccessMock,
  toastErrorMock,
  useAppConfigMock,
} = vi.hoisted(() => ({
  useUtilsMock: vi.fn(),
  listAccessUseQueryMock: vi.fn(),
  upsertEntitlementUseMutationMock: vi.fn(),
  upsertEntitlementMutateAsyncMock: vi.fn(),
  listAccessInvalidateMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  useAppConfigMock: vi.fn(),
}));

vi.mock("@/lib/AppConfigContext", () => ({
  useAppConfig: useAppConfigMock,
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
    upsertEntitlementMutateAsyncMock.mockReset();
    listAccessInvalidateMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    useAppConfigMock.mockReset();

    listAccessInvalidateMock.mockResolvedValue(undefined);
    upsertEntitlementMutateAsyncMock.mockResolvedValue({});

    useUtilsMock.mockReturnValue({
      config: {
        getAppConfig: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
      superadmin: {
        pluginsListAccess: {
          invalidate: listAccessInvalidateMock,
        },
      },
    });

    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "platform",
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
      mutateAsync: upsertEntitlementMutateAsyncMock,
    });
  });

  it("renders one row per project with grouped plugin controls", () => {
    listAccessUseQueryMock.mockImplementation((input: { pluginId: string }) => {
      if (input.pluginId === "contact_form") {
        return {
          data: {
            rows: [
              {
                organizationId: "org-1",
                organizationSlug: "org-1",
                organizationName: "Org One",
                projectSlug: "site-1",
                projectTitle: "Site 1",
                isDeployed: true,
                deployedDomain: "site-1.example.com",
                effectiveScope: "project",
                state: "enabled",
                managedBy: "manual_superadmin",
                monthlyEventLimit: 100,
                hardStop: true,
                turnstileEnabled: true,
                turnstileReady: true,
                usageThisMonth: 10,
                projectPluginStatus: "enabled",
                updatedAt: "2026-02-22T10:00:00.000Z",
              },
            ],
          },
          error: null,
          isLoading: false,
          isFetching: false,
          refetch: vi.fn(),
        };
      }

      return {
        data: {
          rows: [
            {
              organizationId: "org-1",
              organizationSlug: "org-1",
              organizationName: "Org One",
              projectSlug: "site-1",
              projectTitle: "Site 1",
              isDeployed: true,
              deployedDomain: "site-1.example.com",
              effectiveScope: "project",
              state: "disabled",
              managedBy: "manual_superadmin",
              monthlyEventLimit: null,
              hardStop: true,
              turnstileEnabled: false,
              turnstileReady: false,
              usageThisMonth: 0,
              projectPluginStatus: "disabled",
              updatedAt: "2026-02-22T11:00:00.000Z",
            },
          ],
        },
        error: null,
        isLoading: false,
        isFetching: false,
        refetch: vi.fn(),
      };
    });

    render(<PluginsTab />);

    expect(
      screen.getByText(
        "One row per project. Manage all plugin entitlements for that project in one place, including row-level actions to set all plugins at once.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Set all plugins" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Contact Form")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable all plugins" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("queries plugin access for both Contact Form and Analytics", () => {
    render(<PluginsTab />);

    expect(listAccessUseQueryMock).toHaveBeenCalledWith({
      pluginId: "contact_form",
      search: undefined,
      state: undefined,
      limit: 500,
      offset: 0,
    });
    expect(listAccessUseQueryMock).toHaveBeenCalledWith({
      pluginId: "analytics",
      search: undefined,
      state: undefined,
      limit: 500,
      offset: 0,
    });
  });

  it("can set all plugins on a project row", async () => {
    listAccessUseQueryMock.mockImplementation((input: { pluginId: string }) => {
      return {
        data: {
          rows: [
            {
              organizationId: "org-1",
              organizationSlug: "org-1",
              organizationName: "Org One",
              projectSlug: "site-1",
              projectTitle: "Site 1",
              isDeployed: true,
              deployedDomain: "site-1.example.com",
              effectiveScope: "project",
              state: input.pluginId === "contact_form" ? "enabled" : "disabled",
              managedBy: "manual_superadmin",
              monthlyEventLimit: null,
              hardStop: true,
              turnstileEnabled: false,
              turnstileReady: false,
              usageThisMonth: 0,
              projectPluginStatus: "enabled",
              updatedAt: "2026-02-22T10:00:00.000Z",
            },
          ],
        },
        error: null,
        isLoading: false,
        isFetching: false,
        refetch: vi.fn(),
      };
    });

    render(<PluginsTab />);

    fireEvent.click(screen.getByRole("button", { name: "Enable all plugins" }));

    await waitFor(() => {
      expect(upsertEntitlementMutateAsyncMock).toHaveBeenCalledTimes(2);
    });
    expect(upsertEntitlementMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "contact_form",
        organizationId: "org-1",
        projectSlug: "site-1",
        state: "enabled",
      }),
    );
    expect(upsertEntitlementMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "analytics",
        organizationId: "org-1",
        projectSlug: "site-1",
        state: "enabled",
      }),
    );
  });

  it("paginates projects with a page size of 100", async () => {
    listAccessUseQueryMock.mockImplementation((input: { pluginId: string }) => {
      const rows = Array.from({ length: 101 }, (_unused, index) => {
        const projectNumber = String(index + 1).padStart(3, "0");
        return {
          organizationId: "org-1",
          organizationSlug: "org-1",
          organizationName: "Org One",
          projectSlug: `site-${projectNumber}`,
          projectTitle: `Site ${projectNumber}`,
          isDeployed: false,
          deployedDomain: null,
          effectiveScope: "project",
          state: input.pluginId === "contact_form" ? "enabled" : "disabled",
          managedBy: "manual_superadmin",
          monthlyEventLimit: null,
          hardStop: true,
          turnstileEnabled: false,
          turnstileReady: false,
          usageThisMonth: 0,
          projectPluginStatus: "enabled",
          updatedAt: "2026-02-22T10:00:00.000Z",
        };
      });

      return {
        data: { rows },
        error: null,
        isLoading: false,
        isFetching: false,
        refetch: vi.fn(),
      };
    });

    render(<PluginsTab />);

    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Showing 1-100 of 101 projects")).toBeInTheDocument();
    expect(screen.getByText("site-001")).toBeInTheDocument();
    expect(screen.queryByText("site-101")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    });
    expect(screen.getByText("Showing 101-101 of 101 projects")).toBeInTheDocument();
    expect(screen.getByText("site-101")).toBeInTheDocument();
    expect(screen.queryByText("site-001")).not.toBeInTheDocument();
  });
});
