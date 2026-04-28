import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMyOrganizationUseQueryMock, usePermissionsMock } = vi.hoisted(
  () => ({
    getMyOrganizationUseQueryMock: vi.fn(),
    usePermissionsMock: vi.fn(),
  }),
);

vi.mock("@/lib/trpc", () => ({
  trpc: {
    organization: {
      getMyOrganization: {
        useQuery: getMyOrganizationUseQueryMock,
      },
    },
  },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: usePermissionsMock,
}));

vi.mock("@/components/settings/TeamSettings", () => ({
  TeamSettings: () => <div>Members content</div>,
}));

vi.mock("@/components/admin/usage/UsageStatsCard", () => ({
  UsageStatsCard: () => <div>Usage content</div>,
}));

vi.mock("@/components/admin/maintenance/TenantMaintenanceTab", () => ({
  TenantMaintenanceTab: () => <div>Maintenance content</div>,
}));

vi.mock("@/components/settings/OrgSettings", () => ({
  OrgSettings: () => <div>General content</div>,
}));

vi.mock("@/components/organization/OrganizationPluginsTab", () => ({
  OrganizationPluginsTab: () => <div>Plugins content</div>,
}));

import Organization from "./Organization";

function renderOrganization(path = "/vivd-studio/org") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Organization />
    </MemoryRouter>,
  );
}

describe("Organization", () => {
  beforeEach(() => {
    getMyOrganizationUseQueryMock.mockReset();
    usePermissionsMock.mockReset();

    getMyOrganizationUseQueryMock.mockReturnValue({
      data: {
        organization: {
          name: "Acme",
          status: "active",
        },
      },
      isLoading: false,
    });
    usePermissionsMock.mockReturnValue({
      organizationRole: "owner",
      isSuperAdmin: false,
    });
  });

  it("uses the active organization section as the page heading", async () => {
    renderOrganization("/vivd-studio/org?tab=plugins");

    await screen.findByText("Plugins content");
    expect(
      screen.getByRole("heading", { level: 1, name: "Plugins" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: "Acme" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Manage plugin access for Acme."),
    ).toBeInTheDocument();
  });
});
