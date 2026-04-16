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

const pluginCatalog = [
  {
    pluginId: "contact_form",
    name: "Contact Form",
    description: "Submissions with optional Turnstile protection.",
    usageLabel: "Submissions",
    limitPrompt: "Set monthly submission limit.",
    supportsMonthlyLimit: true,
    supportsTurnstile: true,
  },
  {
    pluginId: "analytics",
    name: "Analytics",
    description: "Tracking script and event ingestion.",
    usageLabel: "Events",
    limitPrompt: "Set monthly event limit.",
    supportsMonthlyLimit: true,
    supportsTurnstile: false,
  },
];

function makePluginRow(
  pluginId: "contact_form" | "analytics",
  overrides: Record<string, unknown> = {},
) {
  const catalog = pluginCatalog.find((plugin) => plugin.pluginId === pluginId)!;
  return {
    organizationId: "org-1",
    pluginId,
    projectSlug: "site-1",
    catalog,
    effectiveScope: "project",
    state: "disabled",
    managedBy: "manual_superadmin",
    monthlyEventLimit: null,
    hardStop: true,
    turnstileEnabled: false,
    turnstileReady: false,
    usageThisMonth: 0,
    projectPluginStatus: "disabled",
    updatedAt: "2026-02-22T10:00:00.000Z",
    ...overrides,
  };
}

function makeProjectRow(
  overrides: Record<string, unknown> = {},
  plugins = [
    makePluginRow("contact_form", {
      state: "enabled",
      projectPluginStatus: "enabled",
      usageThisMonth: 10,
      monthlyEventLimit: 100,
      turnstileEnabled: true,
      turnstileReady: true,
    }),
    makePluginRow("analytics"),
  ],
) {
  return {
    organizationId: "org-1",
    organizationSlug: "org-1",
    organizationName: "Org One",
    projectSlug: "site-1",
    projectTitle: "Site 1",
    isDeployed: true,
    deployedDomain: "site-1.example.com",
    plugins,
    updatedAt: "2026-02-22T11:00:00.000Z",
    ...overrides,
  };
}

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
        experimentalSoloModeEnabled: false,
        selfHostAdminFeaturesEnabled: false,
      },
    });

    listAccessUseQueryMock.mockReturnValue({
      data: {
        pluginCatalog,
        rows: [],
        total: 0,
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
    listAccessUseQueryMock.mockReturnValue({
      data: {
        pluginCatalog,
        rows: [makeProjectRow()],
        total: 1,
      },
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
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

  it("queries grouped plugin access once", () => {
    render(<PluginsTab />);

    expect(listAccessUseQueryMock).toHaveBeenCalledWith({
      search: undefined,
      limit: 500,
      offset: 0,
    });
  });

  it("can set all plugins on a project row", async () => {
    listAccessUseQueryMock.mockReturnValue({
      data: {
        pluginCatalog,
        rows: [
          makeProjectRow({}, [
            makePluginRow("contact_form", {
              state: "enabled",
              projectPluginStatus: "enabled",
            }),
            makePluginRow("analytics", {
              state: "disabled",
            }),
          ]),
        ],
        total: 1,
      },
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
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
    const rows = Array.from({ length: 101 }, (_unused, index) => {
      const projectNumber = String(index + 1).padStart(3, "0");
      return makeProjectRow(
        {
          projectSlug: `site-${projectNumber}`,
          projectTitle: `Site ${projectNumber}`,
          isDeployed: false,
          deployedDomain: null,
        },
        [
          makePluginRow("contact_form", {
            projectSlug: `site-${projectNumber}`,
            state: "enabled",
            projectPluginStatus: "enabled",
          }),
          makePluginRow("analytics", {
            projectSlug: `site-${projectNumber}`,
            state: "disabled",
          }),
        ],
      );
    });

    listAccessUseQueryMock.mockReturnValue({
      data: {
        pluginCatalog,
        rows,
        total: rows.length,
      },
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
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
