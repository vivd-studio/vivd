import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useSessionMock,
  signOutMock,
  useAppConfigMock,
  useUtilsMock,
  projectListUseQueryMock,
  getMyMembershipUseQueryMock,
  getMyOrganizationUseQueryMock,
  listMyOrganizationsUseQueryMock,
  setActiveOrganizationUseMutationMock,
} = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  signOutMock: vi.fn(),
  useAppConfigMock: vi.fn(),
  useUtilsMock: vi.fn(),
  projectListUseQueryMock: vi.fn(),
  getMyMembershipUseQueryMock: vi.fn(),
  getMyOrganizationUseQueryMock: vi.fn(),
  listMyOrganizationsUseQueryMock: vi.fn(),
  setActiveOrganizationUseMutationMock: vi.fn(),
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

function renderSidebar({
  path = ROUTES.DASHBOARD,
  sidebarOpen = true,
}: {
  path?: string;
  sidebarOpen?: boolean;
} = {}) {
  return render(
    <SidebarProvider open={sidebarOpen}>
      <MemoryRouter initialEntries={[path]}>
        <AppSidebar />
      </MemoryRouter>
    </SidebarProvider>,
  );
}

describe("AppSidebar search", () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    signOutMock.mockReset();
    useAppConfigMock.mockReset();
    useUtilsMock.mockReset();
    projectListUseQueryMock.mockReset();
    getMyMembershipUseQueryMock.mockReset();
    getMyOrganizationUseQueryMock.mockReset();
    listMyOrganizationsUseQueryMock.mockReset();
    setActiveOrganizationUseMutationMock.mockReset();

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

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "zeta" },
    });

    expect(screen.getByText(/Search results/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Zeta Project$/i })).toBeInTheDocument();
  });

  it("indexes app-wide destinations such as project plugins routes", () => {
    renderSidebar();

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "plugins zeta" },
    });

    expect(
      screen.getByRole("button", { name: /Plugins: Zeta Project/i }),
    ).toBeInTheDocument();
  });

  it("respects role/host gating for super admin search entries", () => {
    const firstRender = renderSidebar();

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "machines" },
    });
    expect(screen.getByText("No sidebar items found.")).toBeInTheDocument();
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
        hasHostOrganizationAccess: true,
        canSelectOrganization: true,
        controlPlaneHost: null,
        isSuperAdminHost: true,
      },
    });

    renderSidebar();
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "machines" },
    });
    expect(screen.getByRole("button", { name: /Machines/i })).toBeInTheDocument();
  });

  it("clears the search query after selecting a search result", () => {
    renderSidebar();

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "settings" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Settings/i }));

    expect(screen.queryByText(/Search results/i)).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("hides the search input while the sidebar is collapsed", () => {
    renderSidebar({ sidebarOpen: false });

    expect(screen.queryByRole("textbox", { name: "Search" })).toBeNull();
  });
});
