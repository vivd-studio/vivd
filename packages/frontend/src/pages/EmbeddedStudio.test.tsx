import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useParamsMock,
  useLocationMock,
  useNavigateMock,
  useUtilsMock,
  projectListUseQueryMock,
  startStudioUseMutationMock,
  hardRestartStudioUseMutationMock,
  touchStudioUseMutationMock,
  getStudioUrlUseQueryMock,
  externalPreviewUseQueryMock,
  regenerateThumbnailUseMutationMock,
  setPublicPreviewEnabledUseMutationMock,
  deleteProjectUseMutationMock,
  renameSlugUseMutationMock,
  getMyMembershipUseQueryMock,
  useSessionMock,
  useThemeMock,
  useSidebarMock,
} = vi.hoisted(() => ({
  useParamsMock: vi.fn(),
  useLocationMock: vi.fn(),
  useNavigateMock: vi.fn(),
  useUtilsMock: vi.fn(),
  projectListUseQueryMock: vi.fn(),
  startStudioUseMutationMock: vi.fn(),
  hardRestartStudioUseMutationMock: vi.fn(),
  touchStudioUseMutationMock: vi.fn(),
  getStudioUrlUseQueryMock: vi.fn(),
  externalPreviewUseQueryMock: vi.fn(),
  regenerateThumbnailUseMutationMock: vi.fn(),
  setPublicPreviewEnabledUseMutationMock: vi.fn(),
  deleteProjectUseMutationMock: vi.fn(),
  renameSlugUseMutationMock: vi.fn(),
  getMyMembershipUseQueryMock: vi.fn(),
  useSessionMock: vi.fn(),
  useThemeMock: vi.fn(),
  useSidebarMock: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useParams: useParamsMock,
    useLocation: useLocationMock,
    useNavigate: useNavigateMock,
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    project: {
      list: { useQuery: projectListUseQueryMock },
      startStudio: { useMutation: startStudioUseMutationMock },
      hardRestartStudio: { useMutation: hardRestartStudioUseMutationMock },
      touchStudio: { useMutation: touchStudioUseMutationMock },
      getStudioUrl: { useQuery: getStudioUrlUseQueryMock },
      getExternalPreviewStatus: { useQuery: externalPreviewUseQueryMock },
      regenerateThumbnail: { useMutation: regenerateThumbnailUseMutationMock },
      setPublicPreviewEnabled: { useMutation: setPublicPreviewEnabledUseMutationMock },
      delete: { useMutation: deleteProjectUseMutationMock },
      renameSlug: { useMutation: renameSlugUseMutationMock },
    },
    organization: {
      getMyMembership: { useQuery: getMyMembershipUseQueryMock },
    },
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: useSessionMock,
  },
}));

vi.mock("@/components/theme", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
  useTheme: useThemeMock,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">Sidebar</button>,
  useSidebar: useSidebarMock,
}));

vi.mock("@/components/shell", () => ({
  HeaderProfileMenu: () => <div data-testid="profile-menu" />,
}));

vi.mock("@/components/projects/publish/PublishSiteDialog", () => ({
  PublishSiteDialog: () => <div data-testid="publish-dialog" />,
}));

vi.mock("@/components/common/StudioStartupLoading", () => ({
  StudioStartupLoading: () => <div data-testid="studio-startup-loading" />,
}));

vi.mock("@/lib/brand", () => ({
  formatDocumentTitle: vi.fn((title?: string) => (title ? `${title} - Vivd` : "Vivd")),
}));

import EmbeddedStudio from "./EmbeddedStudio";

function makeProject(slug = "site-1") {
  return {
    slug,
    status: "completed",
    currentVersion: 1,
    publicPreviewEnabled: true,
    versions: [{ version: 1, status: "completed" }],
    thumbnailUrl: null,
  };
}

describe("EmbeddedStudio", () => {
  beforeEach(() => {
    useParamsMock.mockReset();
    useLocationMock.mockReset();
    useNavigateMock.mockReset();
    useUtilsMock.mockReset();
    projectListUseQueryMock.mockReset();
    startStudioUseMutationMock.mockReset();
    hardRestartStudioUseMutationMock.mockReset();
    touchStudioUseMutationMock.mockReset();
    getStudioUrlUseQueryMock.mockReset();
    externalPreviewUseQueryMock.mockReset();
    regenerateThumbnailUseMutationMock.mockReset();
    setPublicPreviewEnabledUseMutationMock.mockReset();
    deleteProjectUseMutationMock.mockReset();
    renameSlugUseMutationMock.mockReset();
    getMyMembershipUseQueryMock.mockReset();
    useSessionMock.mockReset();
    useThemeMock.mockReset();
    useSidebarMock.mockReset();

    useParamsMock.mockReturnValue({ projectSlug: "site-1" });
    useLocationMock.mockReturnValue({ search: "" });
    useNavigateMock.mockReturnValue(vi.fn());

    const invalidateMock = vi.fn().mockResolvedValue(undefined);
    useUtilsMock.mockReturnValue({
      project: {
        getStudioUrl: { invalidate: invalidateMock },
        list: { invalidate: invalidateMock },
      },
    });

    startStudioUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      data: null,
      error: null,
      reset: vi.fn(),
    });
    hardRestartStudioUseMutationMock.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      data: null,
      error: null,
      reset: vi.fn(),
    });
    touchStudioUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
    });
    getStudioUrlUseQueryMock.mockReturnValue({
      data: { status: "stopped" },
    });
    externalPreviewUseQueryMock.mockReturnValue({
      data: { status: "ready", url: "https://preview.example.com/site-1" },
    });
    regenerateThumbnailUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    setPublicPreviewEnabledUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    deleteProjectUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    renameSlugUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    getMyMembershipUseQueryMock.mockReturnValue({
      data: { organizationRole: "owner" },
    });
    useSessionMock.mockReturnValue({
      data: { user: { id: "user-1", role: "admin" } },
    });
    useThemeMock.mockReturnValue({
      theme: "light",
      colorTheme: "blue",
      setTheme: vi.fn(),
      setColorTheme: vi.fn(),
    });
    useSidebarMock.mockReturnValue({
      toggleSidebar: vi.fn(),
    });

    projectListUseQueryMock.mockReturnValue({
      data: { projects: [makeProject()] },
      isLoading: false,
      error: null,
    });
  });

  it("shows loading copy while project list is loading", () => {
    projectListUseQueryMock.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<EmbeddedStudio />);

    expect(screen.getByText("Loading project...")).toBeInTheDocument();
  });

  it("shows backend query error details when project list query fails", () => {
    projectListUseQueryMock.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    });

    render(<EmbeddedStudio />);

    expect(screen.getByText("Error loading project: boom")).toBeInTheDocument();
  });

  it("shows not-found state when slug is missing from returned projects", () => {
    projectListUseQueryMock.mockReturnValueOnce({
      data: { projects: [makeProject("other-site")] },
      isLoading: false,
      error: null,
    });

    render(<EmbeddedStudio />);

    expect(screen.getByText("Project not found")).toBeInTheDocument();
  });
});
