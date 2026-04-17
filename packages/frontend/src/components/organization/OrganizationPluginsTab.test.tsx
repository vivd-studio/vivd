import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pluginsOverviewUseQueryMock } = vi.hoisted(() => ({
  pluginsOverviewUseQueryMock: vi.fn(),
}));

const {
  useUtilsMock,
  ensureUseMutationMock,
  ensureMutateMock,
} = vi.hoisted(() => ({
  useUtilsMock: vi.fn(),
  ensureUseMutationMock: vi.fn(),
  ensureMutateMock: vi.fn(),
}));

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    organization: {
      pluginsOverview: {
        useQuery: pluginsOverviewUseQueryMock,
      },
    },
    plugins: {
      ensure: {
        useMutation: ensureUseMutationMock,
      },
    },
    project: {
      list: {
        useQuery: vi.fn(),
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

import { OrganizationPluginsTab } from "./OrganizationPluginsTab";

describe("OrganizationPluginsTab", () => {
  beforeEach(() => {
    pluginsOverviewUseQueryMock.mockReset();
    useUtilsMock.mockReset();
    ensureUseMutationMock.mockReset();
    ensureMutateMock.mockReset();
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
      organization: {
        pluginsOverview: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
      project: {
        list: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    ensureUseMutationMock.mockReturnValue({
      mutate: ensureMutateMock,
      isPending: false,
      variables: undefined,
    });
    pluginsOverviewUseQueryMock.mockReturnValue({
      data: {
        rows: [
          {
            projectSlug: "acme-site",
            projectTitle: "Acme Site",
            updatedAt: "2026-02-25T11:00:00.000Z",
            deployedDomain: "acme.example.com",
            plugins: [
              {
                pluginId: "contact_form",
                catalog: {
                  pluginId: "contact_form",
                  name: "Contact Form",
                  description: "Collect visitor inquiries and store submissions in Vivd.",
                },
                installState: "enabled",
                instanceId: "ppi-1",
                summaryLines: [
                  "Recipients configured: 0",
                  "Pending verification: 2",
                ],
                badges: [
                  {
                    label: "Turnstile syncing",
                    tone: "destructive",
                  },
                ],
              },
              {
                pluginId: "analytics",
                catalog: {
                  pluginId: "analytics",
                  name: "Analytics",
                  description: "Track page traffic and visitor behavior for your project.",
                },
                installState: "disabled",
                instanceId: null,
                summaryLines: [],
                badges: [],
              },
            ],
            issues: [
              {
                code: "contact_no_recipients",
                severity: "warning",
                message:
                  "Contact Form is enabled but has no verified recipients configured.",
              },
            ],
          },
        ],
      },
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
  });

  it("renders project plugin health and deep-links to project plugin config", () => {
    render(
      <MemoryRouter>
        <OrganizationPluginsTab />
      </MemoryRouter>,
    );

    expect(screen.getByText("Acme Site")).toBeInTheDocument();
    expect(screen.getByText("Published: acme.example.com")).toBeInTheDocument();
    expect(screen.getByText("Contact Form")).toBeInTheDocument();
    expect(screen.getByText("Recipients configured: 0")).toBeInTheDocument();
    expect(screen.getByText("Pending verification: 2")).toBeInTheDocument();
    expect(screen.getByText("Turnstile syncing")).toBeInTheDocument();
    expect(
      screen.getByText("Contact Form is enabled but has no verified recipients configured."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open plugins" })).toHaveAttribute(
      "href",
      "/vivd-studio/projects/acme-site/plugins",
    );
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("filters rows by project, plugin, and issue search terms", () => {
    render(
      <MemoryRouter>
        <OrganizationPluginsTab />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText("Search projects, plugins, or issues"), {
      target: { value: "unrelated term" },
    });
    expect(screen.getByText("No projects match this search.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search projects, plugins, or issues"), {
      target: { value: "turnstile syncing" },
    });
    expect(screen.getByText("Acme Site")).toBeInTheDocument();
  });

  it("offers a quick enable action for super-admin users", () => {
    render(
      <MemoryRouter>
        <OrganizationPluginsTab />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    expect(ensureMutateMock).toHaveBeenCalledWith({
      slug: "acme-site",
      pluginId: "analytics",
    });
  });
});
