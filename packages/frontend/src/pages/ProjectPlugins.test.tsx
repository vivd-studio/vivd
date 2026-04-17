import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  catalogUseQueryMock,
  genericEnsureMutateMock,
  genericEnsureUseMutationMock,
  requestAccessMutateMock,
  requestAccessUseMutationMock,
  projectListUseQueryMock,
  useParamsMock,
  useUtilsMock,
} = vi.hoisted(() => ({
  catalogUseQueryMock: vi.fn(),
  genericEnsureMutateMock: vi.fn(),
  genericEnsureUseMutationMock: vi.fn(),
  requestAccessMutateMock: vi.fn(),
  requestAccessUseMutationMock: vi.fn(),
  projectListUseQueryMock: vi.fn(),
  useParamsMock: vi.fn(),
  useUtilsMock: vi.fn(),
}));

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useParams: useParamsMock,
  };
});

vi.mock("@/components/settings/SettingsPageShell", () => ({
  SettingsPageShell: ({
    title,
    description,
    actions,
    children,
  }: {
    title: string;
    description: string;
    actions: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
  FormContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/lib/AppConfigContext", () => ({
  useAppConfig: () => ({
    config: {
      installProfile: "solo",
      experimentalSoloModeEnabled: false,
      selfHostAdminFeaturesEnabled: false,
      supportEmail: "support@vivd.studio",
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    plugins: {
      catalog: {
        useQuery: catalogUseQueryMock,
      },
      ensure: {
        useMutation: genericEnsureUseMutationMock,
      },
      requestAccess: {
        useMutation: requestAccessUseMutationMock,
      },
    },
    project: {
      list: {
        useQuery: projectListUseQueryMock,
      },
    },
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: useSessionMock,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import ProjectPlugins from "./ProjectPlugins";

describe("ProjectPlugins", () => {
  beforeEach(() => {
    catalogUseQueryMock.mockReset();
    genericEnsureMutateMock.mockReset();
    genericEnsureUseMutationMock.mockReset();
    requestAccessMutateMock.mockReset();
    requestAccessUseMutationMock.mockReset();
    projectListUseQueryMock.mockReset();
    useParamsMock.mockReset();
    useSessionMock.mockReset();
    useUtilsMock.mockReset();

    useParamsMock.mockReturnValue({ projectSlug: "site-1" });
    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: "super_admin",
        },
      },
      isPending: false,
    });
    useUtilsMock.mockReturnValue({
      plugins: {
        catalog: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
      project: {
        list: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    catalogUseQueryMock.mockReturnValue({
      data: {
        project: {
          organizationId: "org-1",
          slug: "site-1",
        },
        plugins: [
          {
            pluginId: "contact_form",
            installState: "available",
            instanceId: null,
            instanceStatus: null,
            updatedAt: null,
            accessRequest: {
              status: "not_requested",
              requestedAt: null,
              requestedByUserId: null,
              requesterEmail: null,
            },
            catalog: {
              pluginId: "contact_form",
              name: "Contact Form",
              description: "Collect visitor inquiries and store submissions in Vivd.",
            },
          },
          {
            pluginId: "analytics",
            installState: "disabled",
            instanceId: null,
            instanceStatus: null,
            updatedAt: null,
            accessRequest: {
              status: "not_requested",
              requestedAt: null,
              requestedByUserId: null,
              requesterEmail: null,
            },
            catalog: {
              pluginId: "analytics",
              name: "Analytics",
              description: "Track page traffic and visitor behavior for your project.",
            },
          },
          {
            pluginId: "search_console",
            installState: "enabled",
            instanceId: "ppi-search-1",
            instanceStatus: "enabled",
            updatedAt: "2026-02-22T10:00:00.000Z",
            accessRequest: {
              status: "not_requested",
              requestedAt: null,
              requestedByUserId: null,
              requesterEmail: null,
            },
            catalog: {
              pluginId: "search_console",
              name: "Search Console",
              description: "Inspect search indexing and performance signals.",
            },
          },
        ],
      },
      error: null,
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    projectListUseQueryMock.mockReturnValue({
      data: {
        projects: [{ slug: "site-1", title: "Site 1" }],
      },
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    genericEnsureUseMutationMock.mockReturnValue({
      mutate: genericEnsureMutateMock,
      isPending: false,
      variables: undefined,
    });
    requestAccessUseMutationMock.mockReturnValue({
      mutate: requestAccessMutateMock,
      isPending: false,
      variables: undefined,
    });
  });

  it("shows quick enable actions for inactive plugins", () => {
    render(
      <MemoryRouter>
        <ProjectPlugins />
      </MemoryRouter>,
    );

    expect(
      screen.getAllByRole("button", { name: "Enable for this project" }),
    ).toHaveLength(2);
    expect(screen.getByText("Available in this instance and ready to enable for this project.")).toBeInTheDocument();
    expect(screen.getByText("Not active for this project. You can enable it here.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact Form details" })).toHaveAttribute(
      "href",
      "/vivd-studio/projects/site-1/plugins/contact_form",
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Enable for this project" })[0]!);
    expect(genericEnsureMutateMock).toHaveBeenCalledWith({
      slug: "site-1",
      pluginId: "contact_form",
    });
  });

  it("renders registry-backed detail links for enabled plugins", () => {
    render(
      <MemoryRouter>
        <ProjectPlugins />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Search Console")).toHaveLength(2);
    expect(screen.getByText("Configured for this project and ready to open.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Search Console details" })).toHaveAttribute(
      "href",
      "/vivd-studio/projects/site-1/plugins/search_console",
    );
  });

  it("offers request access for non-admin users on inactive plugins", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: "user",
          email: "editor@example.com",
        },
      },
      isPending: false,
    });

    render(
      <MemoryRouter>
        <ProjectPlugins />
      </MemoryRouter>,
    );

    const requestButtons = screen.getAllByRole("button", { name: "Request access" });
    fireEvent.click(requestButtons[0]!);
    expect(requestAccessMutateMock).toHaveBeenCalledWith({
      slug: "site-1",
      pluginId: "contact_form",
    });
  });

  it("shows request sent state for pending access requests", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: "user",
          email: "editor@example.com",
        },
      },
      isPending: false,
    });
    catalogUseQueryMock.mockReturnValue({
      data: {
        plugins: [
          {
            pluginId: "contact_form",
            installState: "available",
            instanceId: null,
            instanceStatus: null,
            updatedAt: null,
            accessRequest: {
              status: "pending",
              requestedAt: "2026-04-17T10:00:00.000Z",
              requestedByUserId: "user-1",
              requesterEmail: "editor@example.com",
            },
            catalog: {
              pluginId: "contact_form",
              name: "Contact Form",
              description: "Collect visitor inquiries and store submissions in Vivd.",
            },
          },
        ],
      },
      error: null,
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <MemoryRouter>
        <ProjectPlugins />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Request sent" })).toBeDisabled();
  });

  it("does not show request access while session state is still loading", () => {
    useSessionMock.mockReturnValue({
      data: null,
      isPending: true,
    });

    render(
      <MemoryRouter>
        <ProjectPlugins />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: "Request access" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enable for this project" }),
    ).not.toBeInTheDocument();
  });

  it("shows the overview summary and enabled plugin instance metadata", () => {
    render(
      <MemoryRouter>
        <ProjectPlugins />
      </MemoryRouter>,
    );

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready to enable" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Enabled" })).toBeInTheDocument();
    expect(screen.getByText(/Instance enabled/)).toBeInTheDocument();
  });
});
