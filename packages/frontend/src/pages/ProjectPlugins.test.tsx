import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  analyticsEnsureMutateMock,
  analyticsEnsureUseMutationMock,
  analyticsInfoUseQueryMock,
  catalogUseQueryMock,
  contactEnsureMutateMock,
  contactEnsureUseMutationMock,
  contactInfoUseQueryMock,
  contactRequestRecipientVerificationUseMutationMock,
  contactUpdateConfigUseMutationMock,
  genericEnsureMutateMock,
  genericEnsureUseMutationMock,
  projectListUseQueryMock,
  useParamsMock,
  useUtilsMock,
} = vi.hoisted(() => ({
  analyticsEnsureMutateMock: vi.fn(),
  analyticsEnsureUseMutationMock: vi.fn(),
  analyticsInfoUseQueryMock: vi.fn(),
  catalogUseQueryMock: vi.fn(),
  contactEnsureMutateMock: vi.fn(),
  contactEnsureUseMutationMock: vi.fn(),
  contactInfoUseQueryMock: vi.fn(),
  contactRequestRecipientVerificationUseMutationMock: vi.fn(),
  contactUpdateConfigUseMutationMock: vi.fn(),
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
      contactInfo: {
        useQuery: contactInfoUseQueryMock,
      },
      analyticsInfo: {
        useQuery: analyticsInfoUseQueryMock,
      },
      contactEnsure: {
        useMutation: contactEnsureUseMutationMock,
      },
      analyticsEnsure: {
        useMutation: analyticsEnsureUseMutationMock,
      },
      ensure: {
        useMutation: genericEnsureUseMutationMock,
      },
      contactUpdateConfig: {
        useMutation: contactUpdateConfigUseMutationMock,
      },
      contactRequestRecipientVerification: {
        useMutation: contactRequestRecipientVerificationUseMutationMock,
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
    analyticsEnsureMutateMock.mockReset();
    analyticsEnsureUseMutationMock.mockReset();
    analyticsInfoUseQueryMock.mockReset();
    catalogUseQueryMock.mockReset();
    contactEnsureMutateMock.mockReset();
    contactEnsureUseMutationMock.mockReset();
    contactInfoUseQueryMock.mockReset();
    contactRequestRecipientVerificationUseMutationMock.mockReset();
    contactUpdateConfigUseMutationMock.mockReset();
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
        contactInfo: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
        analyticsInfo: {
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
              dashboardPath: null,
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
              dashboardPath: "/analytics",
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
              dashboardPath: "/plugins/search-console",
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
    });
    contactInfoUseQueryMock.mockReturnValue({
      data: {
        pluginId: "contact_form",
        entitled: true,
        entitlementState: "enabled",
        enabled: false,
        instanceId: null,
        status: null,
        publicToken: null,
        config: null,
        snippets: null,
        usage: {
          submitEndpoint: "/plugins/contact-form/v1/submit",
          expectedFields: ["token", "name", "email", "message"],
          optionalFields: ["_redirect", "_subject", "_honeypot"],
          inferredAutoSourceHosts: [],
          turnstileEnabled: false,
          turnstileConfigured: false,
        },
        recipients: {
          options: [],
          pending: [],
        },
        instructions: [],
      },
      error: null,
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    analyticsInfoUseQueryMock.mockReturnValue({
      data: {
        pluginId: "analytics",
        entitled: true,
        entitlementState: "enabled",
        enabled: false,
        instanceId: null,
        status: null,
        publicToken: null,
        config: null,
        snippets: null,
        usage: {
          scriptEndpoint: "/plugins/analytics/v1/script.js",
          trackEndpoint: "/plugins/analytics/v1/track",
          eventTypes: [],
          respectDoNotTrack: true,
          captureQueryString: false,
          enableClientTracking: true,
        },
        instructions: [],
      },
      error: null,
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    contactEnsureUseMutationMock.mockReturnValue({
      mutate: contactEnsureMutateMock,
      isPending: false,
    });
    analyticsEnsureUseMutationMock.mockReturnValue({
      mutate: analyticsEnsureMutateMock,
      isPending: false,
    });
    genericEnsureUseMutationMock.mockReturnValue({
      mutate: genericEnsureMutateMock,
      isPending: false,
      variables: undefined,
    });
    contactUpdateConfigUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    contactRequestRecipientVerificationUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
  });

  it("shows project enable actions when plugins are instance-entitled but not yet created for the project", () => {
    render(
      <MemoryRouter>
        <ProjectPlugins />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "Contact Form is available for this instance but has not been enabled for this project yet.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Analytics is available for this instance but has not been enabled for this project yet.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Contact Form is disabled for this instance. Open Instance Settings -> Plugins to enable it.",
      ),
    ).not.toBeInTheDocument();

    const enableButtons = screen.getAllByRole("button", {
      name: "Enable for this project",
    });
    expect(enableButtons).toHaveLength(2);

    fireEvent.click(enableButtons[0]!);
    expect(contactEnsureMutateMock).toHaveBeenCalledWith({ slug: "site-1" });
  });

  it("renders generic registry-backed plugin cards beyond contact form and analytics", () => {
    render(
      <MemoryRouter>
        <ProjectPlugins />
      </MemoryRouter>,
    );

    expect(screen.getByText("Search Console")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This plugin is enabled, but it does not expose in-app configuration here yet.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open dashboard" })).toHaveAttribute(
      "href",
      "/vivd-studio/projects/site-1/plugins/search-console",
    );
  });
});
