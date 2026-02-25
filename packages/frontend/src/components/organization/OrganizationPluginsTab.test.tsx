import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pluginsOverviewUseQueryMock } = vi.hoisted(() => ({
  pluginsOverviewUseQueryMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    organization: {
      pluginsOverview: {
        useQuery: pluginsOverviewUseQueryMock,
      },
    },
  },
}));

import { OrganizationPluginsTab } from "./OrganizationPluginsTab";

describe("OrganizationPluginsTab", () => {
  beforeEach(() => {
    pluginsOverviewUseQueryMock.mockReset();
    pluginsOverviewUseQueryMock.mockReturnValue({
      data: {
        rows: [
          {
            projectSlug: "acme-site",
            projectTitle: "Acme Site",
            updatedAt: "2026-02-25T11:00:00.000Z",
            deployedDomain: "acme.example.com",
            contactForm: {
              status: "enabled",
              configuredRecipientCount: 0,
              pendingRecipientCount: 2,
              turnstileEnabled: true,
              turnstileReady: false,
            },
            analytics: {
              status: "enabled",
            },
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
  });

  it("filters rows by project and issue search terms", () => {
    render(
      <MemoryRouter>
        <OrganizationPluginsTab />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText("Search projects or issues"), {
      target: { value: "unrelated term" },
    });
    expect(screen.getByText("No projects match this search.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search projects or issues"), {
      target: { value: "verified recipients" },
    });
    expect(screen.getByText("Acme Site")).toBeInTheDocument();
  });
});
