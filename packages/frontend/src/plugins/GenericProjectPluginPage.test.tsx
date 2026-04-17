import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Plug } from "lucide-react";

const {
  useUtilsMock,
  infoUseQueryMock,
  ensureUseMutationMock,
  ensureMutateMock,
  requestAccessUseMutationMock,
  updateConfigUseMutationMock,
  projectListUseQueryMock,
} = vi.hoisted(() => ({
  useUtilsMock: vi.fn(),
  infoUseQueryMock: vi.fn(),
  ensureUseMutationMock: vi.fn(),
  ensureMutateMock: vi.fn(),
  requestAccessUseMutationMock: vi.fn(),
  updateConfigUseMutationMock: vi.fn(),
  projectListUseQueryMock: vi.fn(),
}));

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
}));

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
}));

vi.mock("@/lib/AppConfigContext", () => ({
  useAppConfig: () => ({
    config: {
      supportEmail: "support@vivd.studio",
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    plugins: {
      info: {
        useQuery: infoUseQueryMock,
      },
      ensure: {
        useMutation: ensureUseMutationMock,
      },
      requestAccess: {
        useMutation: requestAccessUseMutationMock,
      },
      updateConfig: {
        useMutation: updateConfigUseMutationMock,
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

vi.mock("./presentation", () => ({
  getPluginAccessRequestLabel: vi.fn(() => "Request access"),
  getProjectPluginPresentation: vi.fn(() => ({
    pluginId: "analytics",
    title: "Analytics",
    openLabel: "Open plugin",
    icon: Plug,
    path: null,
  })),
  isPluginAccessRequestPending: vi.fn(() => false),
}));

import GenericProjectPluginPage from "./GenericProjectPluginPage";

describe("GenericProjectPluginPage", () => {
  beforeEach(() => {
    useUtilsMock.mockReset();
    infoUseQueryMock.mockReset();
    ensureUseMutationMock.mockReset();
    ensureMutateMock.mockReset();
    requestAccessUseMutationMock.mockReset();
    updateConfigUseMutationMock.mockReset();
    projectListUseQueryMock.mockReset();
    useSessionMock.mockReset();

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
        info: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
      project: {
        list: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    infoUseQueryMock.mockReturnValue({
      data: {
        pluginId: "analytics",
        catalog: {
          pluginId: "analytics",
          name: "Analytics",
          description: "Track page traffic and visitor behavior for your project.",
        },
        entitlementState: "disabled",
        enabled: false,
        config: {},
        defaultConfig: {},
        snippets: {},
        instructions: [],
        capabilities: {},
        accessRequest: {
          status: "not_requested",
          requestedAt: null,
          requestedByUserId: null,
          requesterEmail: null,
        },
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

    ensureUseMutationMock.mockReturnValue({
      mutate: ensureMutateMock,
      isPending: false,
    });
    requestAccessUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    updateConfigUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
  });

  it("shows a super-admin quick enable action for disabled plugins", () => {
    render(
      <MemoryRouter>
        <GenericProjectPluginPage projectSlug="site-1" pluginId="analytics" />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Analytics is not active for this project yet. You can enable it directly here."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enable for this project" }));

    expect(ensureMutateMock).toHaveBeenCalledWith({
      slug: "site-1",
      pluginId: "analytics",
    });
  });
});
