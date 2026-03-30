import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useSessionMock,
  signOutMock,
  useAppConfigMock,
  usePermissionsMock,
  getMyMembershipUseQueryMock,
  getMyAssignedProjectUseQueryMock,
  projectListUseQueryMock,
  useLocationMock,
  useParamsMock,
} = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  signOutMock: vi.fn(),
  useAppConfigMock: vi.fn(),
  usePermissionsMock: vi.fn(),
  getMyMembershipUseQueryMock: vi.fn(),
  getMyAssignedProjectUseQueryMock: vi.fn(),
  projectListUseQueryMock: vi.fn(),
  useLocationMock: vi.fn(),
  useParamsMock: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => (
      <div data-testid="navigate" data-to={to}>
        navigate:{to}
      </div>
    ),
    useLocation: useLocationMock,
    useParams: useParamsMock,
  };
});

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: useSessionMock,
    signOut: signOutMock,
  },
}));

vi.mock("@/lib/AppConfigContext", () => ({
  useAppConfig: useAppConfigMock,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: usePermissionsMock,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    organization: {
      getMyMembership: {
        useQuery: getMyMembershipUseQueryMock,
      },
    },
    user: {
      getMyAssignedProject: {
        useQuery: getMyAssignedProjectUseQueryMock,
      },
    },
    project: {
      list: {
        useQuery: projectListUseQueryMock,
      },
    },
  },
}));

import {
  DashboardClientEditorGuard,
  getCanonicalControlPlaneUrl,
  RequireAssignedProject,
  RequireAuth,
} from "./guards";
import { ROUTES } from "./paths";

function expectNavigate(to: string): void {
  const node = screen.getByTestId("navigate");
  expect(node.getAttribute("data-to")).toBe(to);
}

describe("router guards", () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    signOutMock.mockReset();
    useAppConfigMock.mockReset();
    usePermissionsMock.mockReset();
    getMyMembershipUseQueryMock.mockReset();
    getMyAssignedProjectUseQueryMock.mockReset();
    projectListUseQueryMock.mockReset();
    useLocationMock.mockReset();
    useParamsMock.mockReset();

    useSessionMock.mockReturnValue({
      data: {
        user: { role: "admin" },
      },
    });
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        hasHostOrganizationAccess: true,
        controlPlaneHost: null,
        isSuperAdminHost: true,
        singleProjectMode: false,
      },
    });
    usePermissionsMock.mockReturnValue({
      isClientEditor: false,
    });
    getMyMembershipUseQueryMock.mockReturnValue({
      data: { isOrganizationAdmin: true },
      isLoading: false,
    });
    getMyAssignedProjectUseQueryMock.mockReturnValue({
      data: { projectSlug: "client-site" },
      isLoading: false,
    });
    projectListUseQueryMock.mockReturnValue({
      data: { projects: [{ slug: "client-site" }] },
      isLoading: false,
    });
    useLocationMock.mockReturnValue({
      pathname: ROUTES.DASHBOARD,
    });
    useParamsMock.mockReturnValue({});
    signOutMock.mockResolvedValue(undefined);
  });

  it("RequireAuth redirects unauthenticated users to login", () => {
    useSessionMock.mockReturnValueOnce({ data: null });

    render(
      <RequireAuth>
        <div>protected</div>
      </RequireAuth>,
    );

    expectNavigate(ROUTES.LOGIN);
  });

  it("RequireAuth shows wrong-tenant message with control-plane link", () => {
    useAppConfigMock.mockReturnValueOnce({
      isLoading: false,
      config: {
        hasHostOrganizationAccess: false,
        controlPlaneHost: "app.localhost",
        isSuperAdminHost: false,
        singleProjectMode: false,
      },
    });

    render(
      <RequireAuth>
        <div>protected</div>
      </RequireAuth>,
    );

    expect(screen.getByText("Wrong tenant host")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Go to control plane" });
    expect(link.getAttribute("href")).toBe(`http://app.localhost${ROUTES.DASHBOARD}`);
  });

  it("computes a canonical control-plane redirect for host-based local platform routes", () => {
    expect(
      getCanonicalControlPlaneUrl({
        controlPlaneMode: "host_based",
        controlPlaneHost: "app.localhost",
        currentHost: "localhost",
        pathname: ROUTES.PROJECT("site-1"),
        search: "?view=studio&version=1",
        hash: "",
      }),
    ).toBe(
      `http://app.localhost${ROUTES.PROJECT("site-1")}?view=studio&version=1`,
    );
  });

  it("does not compute a redirect when already on the canonical control-plane host", () => {
    expect(
      getCanonicalControlPlaneUrl({
        controlPlaneMode: "host_based",
        controlPlaneHost: "app.localhost",
        currentHost: "app.localhost",
        pathname: ROUTES.DASHBOARD,
      }),
    ).toBeNull();
  });

  it("does not compute a redirect for production tenant hosts in host-based mode", () => {
    expect(
      getCanonicalControlPlaneUrl({
        controlPlaneMode: "host_based",
        controlPlaneHost: "app.vivd.studio",
        currentHost: "felix.vivd.studio",
        pathname: ROUTES.PROJECT("site-1"),
        search: "?view=studio&version=1",
      }),
    ).toBeNull();
  });

  it("RequireAssignedProject redirects client editors away from non-assigned projects", () => {
    usePermissionsMock.mockReturnValueOnce({
      isClientEditor: true,
    });
    useParamsMock.mockReturnValueOnce({ projectSlug: "other-site" });
    getMyAssignedProjectUseQueryMock.mockReturnValueOnce({
      data: { projectSlug: "client-site" },
      isLoading: false,
    });

    render(
      <RequireAssignedProject>
        <div>project content</div>
      </RequireAssignedProject>,
    );

    expectNavigate(ROUTES.PROJECT_FULLSCREEN("client-site"));
  });

  it("DashboardClientEditorGuard sends client editors without assignment to no-project page", () => {
    usePermissionsMock.mockReturnValueOnce({
      isClientEditor: true,
    });
    getMyAssignedProjectUseQueryMock.mockReturnValueOnce({
      data: null,
      isLoading: false,
    });

    render(
      <DashboardClientEditorGuard>
        <div>dashboard</div>
      </DashboardClientEditorGuard>,
    );

    expectNavigate(ROUTES.NO_PROJECT);
  });

  it("DashboardClientEditorGuard redirects non-client users in single-project mode", () => {
    useAppConfigMock.mockReturnValueOnce({
      isLoading: false,
      config: {
        hasHostOrganizationAccess: true,
        controlPlaneHost: null,
        isSuperAdminHost: false,
        singleProjectMode: true,
      },
    });
    usePermissionsMock.mockReturnValueOnce({
      isClientEditor: false,
    });

    render(
      <DashboardClientEditorGuard>
        <div>dashboard</div>
      </DashboardClientEditorGuard>,
    );

    expectNavigate(ROUTES.SINGLE_PROJECT);
  });
});
