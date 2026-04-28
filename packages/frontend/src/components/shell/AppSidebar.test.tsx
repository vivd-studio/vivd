import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useSessionMock,
  signOutMock,
  useAppConfigMock,
  useUtilsMock,
  projectListUseQueryMock,
  getInstanceSoftwareUseQueryMock,
  getMyMembershipUseQueryMock,
  getMyOrganizationUseQueryMock,
  listMyOrganizationsUseQueryMock,
  setActiveOrganizationUseMutationMock,
  scrollIntoViewMock,
} = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  signOutMock: vi.fn(),
  useAppConfigMock: vi.fn(),
  useUtilsMock: vi.fn(),
  projectListUseQueryMock: vi.fn(),
  getInstanceSoftwareUseQueryMock: vi.fn(),
  getMyMembershipUseQueryMock: vi.fn(),
  getMyOrganizationUseQueryMock: vi.fn(),
  listMyOrganizationsUseQueryMock: vi.fn(),
  setActiveOrganizationUseMutationMock: vi.fn(),
  scrollIntoViewMock: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: useSessionMock,
    signOut: signOutMock,
  },
}));

vi.mock("@/lib/AppConfigContext", () => ({
  useAppConfig: useAppConfigMock,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    project: {
      list: {
        useQuery: projectListUseQueryMock,
      },
    },
    superadmin: {
      getInstanceSoftware: {
        useQuery: getInstanceSoftwareUseQueryMock,
      },
    },
    organization: {
      getMyMembership: {
        useQuery: getMyMembershipUseQueryMock,
      },
      getMyOrganization: {
        useQuery: getMyOrganizationUseQueryMock,
      },
      listMyOrganizations: {
        useQuery: listMyOrganizationsUseQueryMock,
      },
      setActiveOrganization: {
        useMutation: setActiveOrganizationUseMutationMock,
      },
    },
  },
}));

import { ROUTES } from "@/app/router";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { NavigationSearchProvider } from "./NavigationSearch";

function renderSidebar({
  path = ROUTES.DASHBOARD,
  sidebarOpen = true,
  desktopMode = "default",
}: {
  path?: string;
  sidebarOpen?: boolean;
  desktopMode?: "default" | "immersive";
} = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider
        open={sidebarOpen}
        desktopMode={desktopMode}
        immersiveKey={desktopMode === "immersive" ? "project-alpha" : undefined}
      >
        <NavigationSearchProvider>
          <AppSidebar />
        </NavigationSearchProvider>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

function openSearchDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Open search" }));
  return screen.getByRole("dialog", { name: "Search navigation" });
}

function getSelectedResults(dialog: HTMLElement) {
  return within(dialog).getAllByRole("button").filter((button) => {
    return button.getAttribute("data-selected") === "true";
  });
}

describe("AppSidebar search", () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    signOutMock.mockReset();
    useAppConfigMock.mockReset();
    useUtilsMock.mockReset();
    projectListUseQueryMock.mockReset();
    getInstanceSoftwareUseQueryMock.mockReset();
    getMyMembershipUseQueryMock.mockReset();
    getMyOrganizationUseQueryMock.mockReset();
    listMyOrganizationsUseQueryMock.mockReset();
    setActiveOrganizationUseMutationMock.mockReset();
    scrollIntoViewMock.mockReset();

    signOutMock.mockResolvedValue(undefined);

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoViewMock,
    });

    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: "Alice",
          email: "alice@example.com",
          image: null,
          role: "admin",
        },
      },
    });

    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "platform",
        instanceAdminLabel: "Super Admin",
        capabilities: {
          multiOrg: true,
          tenantHosts: true,
          customDomains: true,
          orgLimitOverrides: true,
          orgPluginEntitlements: true,
          projectPluginEntitlements: true,
          dedicatedPluginHost: true,
        },
        controlPlaneMode: "host_based",
        pluginRuntime: { mode: "dedicated_host" },
        hasHostOrganizationAccess: true,
        canSelectOrganization: true,
        controlPlaneHost: null,
        isSuperAdminHost: false,
      },
    });

    useUtilsMock.mockReturnValue({
      invalidate: vi.fn().mockResolvedValue(undefined),
    });

    projectListUseQueryMock.mockReturnValue({
      data: {
        projects: [
          {
            slug: "alpha",
            title: "Alpha Project",
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-24T10:00:00.000Z",
          },
          {
            slug: "beta",
            title: "Beta Project",
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-24T09:00:00.000Z",
          },
          {
            slug: "gamma",
            title: "Gamma Project",
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-24T08:00:00.000Z",
          },
          {
            slug: "delta",
            title: "Delta Project",
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-24T07:00:00.000Z",
          },
          {
            slug: "epsilon",
            title: "Epsilon Project",
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-24T06:00:00.000Z",
          },
          {
            slug: "zeta",
            title: "Zeta Project",
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-24T05:00:00.000Z",
          },
        ],
      },
    });

    getInstanceSoftwareUseQueryMock.mockReturnValue({
      data: {
        currentVersion: "1.1.33",
        currentRevision: "abc123def456",
        currentImage: "ghcr.io/vivd-studio/vivd-server:1.1.33",
        currentImageTag: "1.1.33",
        latestVersion: "1.1.34",
        latestTag: "1.1.34",
        latestImage: "ghcr.io/vivd-studio/vivd-server:1.1.34",
        releaseStatus: "available",
        managedUpdate: {
          enabled: false,
          reason: "Platform deployments stay deployment-managed for now.",
          helperImage: null,
          workdir: null,
        },
      },
    });

    getMyMembershipUseQueryMock.mockReturnValue({
      data: {
        isOrganizationAdmin: true,
        organizationRole: "owner",
      },
    });

    getMyOrganizationUseQueryMock.mockReturnValue({
      data: {
        organization: {
          id: "org_1",
          name: "Acme Org",
          status: "active",
        },
      },
    });

    listMyOrganizationsUseQueryMock.mockReturnValue({
      data: {
        organizations: [
          {
            id: "org_1",
            name: "Acme Org",
            status: "active",
            role: "owner",
            isActive: true,
            tenantHost: "acme.localhost",
          },
        ],
      },
    });

    setActiveOrganizationUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
  });

  it("finds project subelements that are not visible in the default top-5 list", () => {
    renderSidebar();

    expect(screen.queryByText("Zeta Project")).toBeNull();

    const dialog = openSearchDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search" }), {
      target: { value: "zeta" },
    });

    expect(within(dialog).getByText(/Search results/i)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Zeta Project" }),
    ).toBeInTheDocument();
  });

  it("indexes app-wide destinations such as project plugins routes", () => {
    renderSidebar();

    const dialog = openSearchDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search" }), {
      target: { value: "plugins zeta" },
    });

    expect(
      within(dialog).getByRole("button", { name: /Plugins: Zeta Project/i }),
    ).toBeInTheDocument();
  });

  it("indexes the organization plugins overview route for org admins", () => {
    renderSidebar();

    const dialog = openSearchDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search" }), {
      target: { value: "organization plugins" },
    });

    expect(
      within(dialog).getByRole("button", { name: /^Plugins$/i }),
    ).toBeInTheDocument();
  });

  it("respects role/host gating for super admin search entries", () => {
    const firstRender = renderSidebar();

    let dialog = openSearchDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search" }), {
      target: { value: "machines" },
    });
    expect(within(dialog).getByText(/No results found/i)).toBeInTheDocument();
    firstRender.unmount();

    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: "Admin",
          email: "admin@example.com",
          image: null,
          role: "super_admin",
        },
      },
    });
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "platform",
        instanceAdminLabel: "Super Admin",
        capabilities: {
          multiOrg: true,
          tenantHosts: true,
          customDomains: true,
          orgLimitOverrides: true,
          orgPluginEntitlements: true,
          projectPluginEntitlements: true,
          dedicatedPluginHost: true,
        },
        controlPlaneMode: "host_based",
        pluginRuntime: { mode: "dedicated_host" },
        hasHostOrganizationAccess: true,
        canSelectOrganization: true,
        controlPlaneHost: null,
        isSuperAdminHost: true,
      },
    });

    renderSidebar();
    dialog = openSearchDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search" }), {
      target: { value: "machines" },
    });
    expect(
      within(dialog).getByRole("button", { name: /Machines/i }),
    ).toBeInTheDocument();
  });

  it("renders the email destination in super admin navigation", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: "Admin",
          email: "admin@example.com",
          image: null,
          role: "super_admin",
        },
      },
    });
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "platform",
        instanceAdminLabel: "Super Admin",
        capabilities: {
          multiOrg: true,
          tenantHosts: true,
          customDomains: true,
          orgLimitOverrides: true,
          orgPluginEntitlements: true,
          projectPluginEntitlements: true,
          dedicatedPluginHost: true,
        },
        controlPlaneMode: "host_based",
        pluginRuntime: { mode: "dedicated_host" },
        hasHostOrganizationAccess: true,
        canSelectOrganization: true,
        controlPlaneHost: null,
        isSuperAdminHost: true,
      },
    });

    renderSidebar({ path: `${ROUTES.SUPERADMIN_BASE}?section=email` });

    expect(screen.getByRole("link", { name: /^Email$/i })).toBeInTheDocument();
  });

  it("shows a subtle sidebar version indicator for super admins", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: "Admin",
          email: "admin@example.com",
          image: null,
          role: "super_admin",
        },
      },
    });
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "platform",
        instanceAdminLabel: "Super Admin",
        capabilities: {
          multiOrg: true,
          tenantHosts: true,
          customDomains: true,
          orgLimitOverrides: true,
          orgPluginEntitlements: true,
          projectPluginEntitlements: true,
          dedicatedPluginHost: true,
        },
        controlPlaneMode: "host_based",
        pluginRuntime: { mode: "dedicated_host" },
        hasHostOrganizationAccess: true,
        canSelectOrganization: true,
        controlPlaneHost: null,
        isSuperAdminHost: true,
      },
    });

    renderSidebar();

    const link = screen.getByRole("link", {
      name: "Vivd v1.1.33 · Update available (1.1.34)",
    });

    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      `${ROUTES.SUPERADMIN_BASE}?section=instance#instance-software`,
    );
    expect(screen.getByText("v1.1.33")).toBeInTheDocument();
  });

  it("keeps the sidebar version link visible when version metadata is unavailable", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: "Admin",
          email: "admin@example.com",
          image: null,
          role: "super_admin",
        },
      },
    });
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "platform",
        instanceAdminLabel: "Super Admin",
        capabilities: {
          multiOrg: true,
          tenantHosts: true,
          customDomains: true,
          orgLimitOverrides: true,
          orgPluginEntitlements: true,
          projectPluginEntitlements: true,
          dedicatedPluginHost: true,
        },
        controlPlaneMode: "host_based",
        pluginRuntime: { mode: "dedicated_host" },
        hasHostOrganizationAccess: true,
        canSelectOrganization: true,
        controlPlaneHost: null,
        isSuperAdminHost: true,
      },
    });
    getInstanceSoftwareUseQueryMock.mockReturnValue({
      data: undefined,
    });

    renderSidebar();

    const link = screen.getByRole("link", {
      name: "Vivd version info unavailable",
    });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      `${ROUTES.SUPERADMIN_BASE}?section=instance#instance-software`,
    );
    expect(screen.getByText("Version")).toBeInTheDocument();
  });

  it("shows instance-first navigation in solo profile", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: "Admin",
          email: "admin@example.com",
          image: null,
          role: "super_admin",
        },
      },
    });
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "solo",
        instanceAdminLabel: "Instance Settings",
        capabilities: {
          multiOrg: false,
          tenantHosts: false,
          customDomains: false,
          orgLimitOverrides: false,
          orgPluginEntitlements: false,
          projectPluginEntitlements: false,
          dedicatedPluginHost: false,
        },
        controlPlaneMode: "path_based",
        pluginRuntime: { mode: "same_host_path" },
        hasHostOrganizationAccess: true,
        canSelectOrganization: false,
        controlPlaneHost: "localhost",
        isSuperAdminHost: true,
      },
    });

    renderSidebar({ path: `${ROUTES.SUPERADMIN_BASE}?section=instance` });

    expect(screen.getByRole("link", { name: /^Instance$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Organization$/i }));
    expect(screen.getByRole("link", { name: /^Members$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Organizations$/i }),
    ).not.toBeInTheDocument();
  });

  it("indexes organization routes in solo profile", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: "Admin",
          email: "admin@example.com",
          image: null,
          role: "super_admin",
        },
      },
    });
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "solo",
        instanceAdminLabel: "Instance Settings",
        capabilities: {
          multiOrg: false,
          tenantHosts: false,
          customDomains: false,
          orgLimitOverrides: false,
          orgPluginEntitlements: false,
          projectPluginEntitlements: false,
          dedicatedPluginHost: false,
        },
        controlPlaneMode: "path_based",
        pluginRuntime: { mode: "same_host_path" },
        hasHostOrganizationAccess: true,
        canSelectOrganization: false,
        controlPlaneHost: "localhost",
        isSuperAdminHost: true,
      },
    });

    renderSidebar();

    const dialog = openSearchDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search" }), {
      target: { value: "capabilities" },
    });

    expect(
      within(dialog).getByRole("button", { name: /^Instance$/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /^General$/i }),
    ).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search" }), {
      target: { value: "organization members" },
    });

    expect(
      within(dialog).getByRole("button", { name: /^Members$/i }),
    ).toBeInTheDocument();
  });

  it("shows organization choices on pinned hosts so switching can redirect", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: "Admin",
          email: "admin@example.com",
          image: null,
          role: "super_admin",
        },
      },
    });
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "platform",
        instanceAdminLabel: "Super Admin",
        capabilities: {
          multiOrg: true,
          tenantHosts: true,
          customDomains: true,
          orgLimitOverrides: true,
          orgPluginEntitlements: true,
          projectPluginEntitlements: true,
          dedicatedPluginHost: true,
        },
        controlPlaneMode: "host_based",
        pluginRuntime: { mode: "dedicated_host" },
        hasHostOrganizationAccess: true,
        canSelectOrganization: false,
        controlPlaneHost: "app.staging.vivd.studio",
        isSuperAdminHost: true,
      },
    });
    listMyOrganizationsUseQueryMock.mockReturnValue({
      data: {
        organizations: [
          {
            id: "org_1",
            name: "Default",
            status: "active",
            role: "owner",
            isActive: true,
            tenantHost: "default.staging.vivd.studio",
          },
          {
            id: "org_2",
            name: "Test GmbH",
            status: "active",
            role: "member",
            isActive: false,
            tenantHost: "test.staging.vivd.studio",
          },
        ],
      },
    });
    getMyOrganizationUseQueryMock.mockReturnValue({
      data: {
        organization: {
          id: "org_1",
          name: "Default",
          status: "active",
        },
      },
    });

    renderSidebar();

    fireEvent.pointerDown(screen.getByRole("button", { name: /Default/i }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.getByRole("menuitem", { name: /Test GmbH/i })).toBeInTheDocument();
    expect(
      screen.getByText("This host is pinned; selecting another org will redirect."),
    ).toBeInTheDocument();
  });

  it("does not show organization choices when multi-org is disabled", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: "Admin",
          email: "admin@example.com",
          image: null,
          role: "super_admin",
        },
      },
    });
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "solo",
        instanceAdminLabel: "Instance Settings",
        capabilities: {
          multiOrg: false,
          tenantHosts: false,
          customDomains: false,
          orgLimitOverrides: false,
          orgPluginEntitlements: false,
          projectPluginEntitlements: false,
          dedicatedPluginHost: false,
        },
        controlPlaneMode: "path_based",
        pluginRuntime: { mode: "same_host_path" },
        hasHostOrganizationAccess: true,
        canSelectOrganization: false,
        controlPlaneHost: "localhost",
        isSuperAdminHost: true,
      },
    });
    listMyOrganizationsUseQueryMock.mockReturnValue({
      data: {
        organizations: [
          {
            id: "org_1",
            name: "Default",
            status: "active",
            role: "owner",
            isActive: true,
            tenantHost: null,
          },
          {
            id: "org_2",
            name: "Test GmbH",
            status: "active",
            role: "member",
            isActive: false,
            tenantHost: null,
          },
        ],
      },
    });
    getMyOrganizationUseQueryMock.mockReturnValue({
      data: {
        organization: {
          id: "org_1",
          name: "Default",
          status: "active",
        },
      },
    });

    renderSidebar();

    fireEvent.pointerDown(screen.getByRole("button", { name: /Default/i }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.queryByRole("menuitem", { name: /Test GmbH/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText("This host is pinned; selecting another org will redirect."),
    ).not.toBeInTheDocument();
  });

  it("clears the search query after selecting a search result", () => {
    renderSidebar();

    let dialog = openSearchDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search" }), {
      target: { value: "settings" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /^Settings$/i }));

    expect(screen.queryByRole("dialog", { name: "Search navigation" })).toBeNull();

    dialog = openSearchDialog();
    expect(
      (within(dialog).getByRole("textbox", { name: "Search" }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("opens the search dialog with the keyboard shortcut", () => {
    renderSidebar();

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(
      screen.getByRole("dialog", { name: "Search navigation" }),
    ).toBeInTheDocument();
  });

  it("scrolls the active result into view during keyboard navigation", () => {
    renderSidebar();

    const dialog = openSearchDialog();
    const searchInput = within(dialog).getByRole("textbox", { name: "Search" });

    fireEvent.change(searchInput, {
      target: { value: "project" },
    });

    const callsBeforeArrowing = scrollIntoViewMock.mock.calls.length;
    fireEvent.keyDown(searchInput, { key: "ArrowDown" });

    expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(callsBeforeArrowing);
  });

  it("does not let stationary hover override keyboard selection", () => {
    renderSidebar();

    const dialog = openSearchDialog();
    const searchInput = within(dialog).getByRole("textbox", { name: "Search" });

    fireEvent.change(searchInput, {
      target: { value: "plug" },
    });

    fireEvent.keyDown(searchInput, { key: "ArrowDown" });

    const selectedAfterKeyboard = getSelectedResults(dialog);
    expect(selectedAfterKeyboard).toHaveLength(1);

    const differentResult = within(dialog).getByRole("button", {
      name: "Plugins: Gamma Project",
    });

    fireEvent.mouseEnter(differentResult);
    expect(getSelectedResults(dialog)[0]).toBe(selectedAfterKeyboard[0]);

    fireEvent.mouseMove(differentResult);
    expect(getSelectedResults(dialog)).toEqual([differentResult]);
  });

  it("keeps search available while the sidebar is collapsed", () => {
    renderSidebar({ sidebarOpen: false });

    fireEvent.click(screen.getByRole("button", { name: "Open search" }));

    expect(
      screen.getByRole("dialog", { name: "Search navigation" }),
    ).toBeInTheDocument();
  });

  it("uses the brand-style sidebar toggle inside the immersive collapsed rail", () => {
    renderSidebar({
      path: ROUTES.PROJECT("alpha"),
      sidebarOpen: false,
      desktopMode: "immersive",
    });

    const headerTrigger = document.querySelector(
      '[data-sidebar="header"] [data-sidebar="trigger"]',
    ) as HTMLElement | null;

    expect(headerTrigger).toBeInTheDocument();
    expect(headerTrigger).toHaveAccessibleName("Toggle Sidebar");
    expect(headerTrigger).toHaveAttribute(
      "data-sidebar-trigger-appearance",
      "brand",
    );
  });

  it.each([
    ["projects index", ROUTES.DASHBOARD],
    ["project preview", ROUTES.PROJECT("alpha")],
    ["new project", ROUTES.NEW_SCRATCH],
  ])("does not draw the docked rail divider on the %s route", (_label, path) => {
    renderSidebar({ path, sidebarOpen: false });

    const sidebarRail = document.querySelector(
      "[data-state][data-overlay-state] > div:nth-of-type(2)",
    ) as HTMLElement | null;

    expect(sidebarRail).toHaveClass("group-data-[side=left]:border-r-0");
  });

  it("shows a persistent docs link derived from the current host", () => {
    renderSidebar();

    const docsLink = screen.getByRole("link", { name: "Docs" });
    expect(docsLink).toHaveAttribute("href", "http://docs.localhost/");
  });
});
