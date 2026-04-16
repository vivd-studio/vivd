import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  catalogUseQueryMock,
  genericEnsureMutateMock,
  genericEnsureUseMutationMock,
  projectListUseQueryMock,
  useParamsMock,
  useUtilsMock,
} = vi.hoisted(() => ({
  catalogUseQueryMock: vi.fn(),
  genericEnsureMutateMock: vi.fn(),
  genericEnsureUseMutationMock: vi.fn(),
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
    });
    useUtilsMock.mockReturnValue({
      plugins: {
        catalog: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
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
            catalog: {
              pluginId: "contact_form",
              name: "Contact Form",
              description: "Collect visitor inquiries and store submissions in Vivd.",
            },
          },
          {
            pluginId: "analytics",
            installState: "available",
            instanceId: null,
            instanceStatus: null,
            updatedAt: null,
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
  });

  it("shows project enable actions for available plugins", () => {
    render(
      <MemoryRouter>
        <ProjectPlugins />
      </MemoryRouter>,
    );

    expect(
      screen.getAllByRole("button", { name: "Enable for this project" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByText(
        "This plugin is available for this project but has not been enabled yet.",
      ),
    ).toHaveLength(2);

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

    expect(screen.getByText("Search Console")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Open this plugin to view details, configuration, snippets, and plugin-specific actions.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open plugin" })).toHaveAttribute(
      "href",
      "/vivd-studio/projects/site-1/plugins/search_console",
    );
  });
});
