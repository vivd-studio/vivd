import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCard } from "./ProjectCard";

const {
  membershipUseQueryMock,
  mutateMock,
  updateTitleMutateMock,
  updateTitleUseMutationMock,
  useNavigateMock,
  useSessionMock,
  useUtilsMock,
} = vi.hoisted(() => ({
  membershipUseQueryMock: vi.fn(),
  mutateMock: vi.fn(),
  updateTitleMutateMock: vi.fn(),
  updateTitleUseMutationMock: vi.fn(),
  useNavigateMock: vi.fn(),
  useSessionMock: vi.fn(),
  useUtilsMock: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useNavigate: () => useNavigateMock,
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    organization: {
      getMyMembership: {
        useQuery: membershipUseQueryMock,
      },
    },
    project: {
      setStatus: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
      setCurrentVersion: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
      regenerateThumbnail: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
      updateTags: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
      deleteTag: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
      renameTag: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
      setTagColor: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
      renameSlug: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
      updateTitle: { useMutation: updateTitleUseMutationMock },
      setPublicPreviewEnabled: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
    },
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: useSessionMock,
  },
}));

vi.mock("@/lib/AppConfigContext", () => ({
  useAppConfig: () => ({
    config: {
      hasHostOrganizationAccess: true,
      activeOrganizationTenantHost: null,
    },
  }),
}));

vi.mock("@/plugins/shortcuts", () => ({
  getProjectPluginShortcuts: () => [],
}));

vi.mock("@/plugins/presentation", () => ({
  getProjectPluginPresentation: () => ({
    pluginId: "contact_form",
    title: "Contact Form",
    path: "/plugins/contact_form",
    icon: () => null,
  }),
  listEnabledNativeProjectPluginPresentations: () => [],
}));

vi.mock("../versioning/VersionSelector", () => ({
  VersionSelector: ({ selectedVersion }: { selectedVersion: number }) => (
    <div>v{selectedVersion}</div>
  ),
}));

vi.mock("../versioning/VersionManagementPanel", () => ({
  VersionManagementPanel: () => null,
}));

vi.mock("../publish/PublishSiteDialog", () => ({
  PublishSiteDialog: () => null,
}));

vi.mock("./ProjectTagsPopover", () => ({
  ProjectTagsPopover: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  TagChip: ({ tag }: { tag: string }) => <span>{tag}</span>,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderProjectCard() {
  return render(
    <MemoryRouter>
      <ProjectCard
        project={{
          slug: "fancy-site",
          title: "Fancy Site",
          url: "https://example.com",
          source: "url",
          status: "completed",
          createdAt: "2026-04-17T00:00:00.000Z",
          currentVersion: 1,
          totalVersions: 1,
          versions: [
            {
              version: 1,
              createdAt: "2026-04-17T00:00:00.000Z",
              status: "completed",
            },
          ],
          enabledPlugins: [],
        }}
        availableTags={[]}
        tagColorMap={{}}
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
        isRegenerating={false}
      />
    </MemoryRouter>,
  );
}

describe("ProjectCard inline title editing", () => {
  beforeEach(() => {
    membershipUseQueryMock.mockReset();
    mutateMock.mockReset();
    updateTitleMutateMock.mockReset();
    updateTitleUseMutationMock.mockReset();
    useNavigateMock.mockReset();
    useSessionMock.mockReset();
    useUtilsMock.mockReset();

    membershipUseQueryMock.mockReturnValue({
      data: { organizationRole: "owner" },
    });
    updateTitleUseMutationMock.mockReturnValue({
      mutate: updateTitleMutateMock,
      isPending: false,
    });
    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: "super_admin",
        },
      },
    });
    useUtilsMock.mockReturnValue({
      project: {
        list: { invalidate: vi.fn().mockResolvedValue(undefined) },
        status: { invalidate: vi.fn().mockResolvedValue(undefined) },
        listTags: { invalidate: vi.fn().mockResolvedValue(undefined) },
        getExternalPreviewStatus: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
  });

  it("renders the human title as the primary heading and omits the slug row", () => {
    renderProjectCard();

    expect(screen.getByText("Fancy Site")).toBeInTheDocument();
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
    expect(screen.queryByText("fancy-site")).toBeNull();
  });

  it("starts inline title editing on double click and saves on Enter", () => {
    renderProjectCard();

    fireEvent.dblClick(screen.getByText("Fancy Site"));

    const input = screen.getByRole("textbox", {
      name: "Edit title for fancy-site",
    });
    fireEvent.change(input, { target: { value: "Better Site" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateTitleMutateMock).toHaveBeenCalledWith({
      slug: "fancy-site",
      title: "Better Site",
    });
    expect(useNavigateMock).not.toHaveBeenCalled();
  });
});
