import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useAppConfigMock,
  useUtilsMock,
  listOrganizationsUseQueryMock,
  createOrganizationUseMutationMock,
} = vi.hoisted(() => ({
  useAppConfigMock: vi.fn(),
  useUtilsMock: vi.fn(),
  listOrganizationsUseQueryMock: vi.fn(),
  createOrganizationUseMutationMock: vi.fn(),
}));

vi.mock("@/lib/AppConfigContext", () => ({
  useAppConfig: useAppConfigMock,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    superadmin: {
      listOrganizations: {
        useQuery: listOrganizationsUseQueryMock,
      },
      createOrganization: {
        useMutation: createOrganizationUseMutationMock,
      },
    },
  },
}));

vi.mock("@/components/admin/instance/InstanceSettingsTab", () => ({
  InstanceSettingsTab: () => <div>Instance content</div>,
}));

vi.mock("@/components/admin/organizations/OrganizationsTab", () => ({
  OrganizationsTab: () => <div>Organizations content</div>,
}));

vi.mock("@/components/admin/users/UsersTab", () => ({
  UsersTab: () => <div>Users content</div>,
}));

vi.mock("@/components/admin/maintenance/MaintenanceTab", () => ({
  MaintenanceTab: () => <div>Maintenance content</div>,
}));

vi.mock("@/components/admin/machines/MachinesTab", () => ({
  MachinesTab: () => <div>Machines content</div>,
}));

vi.mock("@/components/admin/plugins/PluginsTab", () => ({
  PluginsTab: () => <div>Plugins content</div>,
}));

vi.mock("@/components/admin/email/EmailTab", () => ({
  EmailTab: () => <div>Email content</div>,
}));

import SuperAdmin from "./SuperAdmin";

function renderSuperAdmin(path = "/vivd-studio/superadmin?section=instance") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SuperAdmin />
    </MemoryRouter>,
  );
}

describe("SuperAdmin", () => {
  beforeEach(() => {
    useAppConfigMock.mockReset();
    useUtilsMock.mockReset();
    listOrganizationsUseQueryMock.mockReset();
    createOrganizationUseMutationMock.mockReset();

    useAppConfigMock.mockReturnValue({
      config: {
        installProfile: "solo",
        instanceAdminLabel: "Instance Settings",
        instanceSectionLabel: "General",
        showPlatformAdminSections: false,
      },
    });
    useUtilsMock.mockReturnValue({
      superadmin: {
        listOrganizations: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    listOrganizationsUseQueryMock.mockReturnValue({
      data: { organizations: [] },
      isLoading: false,
    });
    createOrganizationUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
  });

  it("labels the instance section as Instance", async () => {
    renderSuperAdmin();

    await screen.findByText("Instance content");
    expect(
      screen.getByRole("heading", { level: 1, name: "Instance" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        level: 1,
        name: "Instance Settings",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Instance/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /General/ }),
    ).not.toBeInTheDocument();
  });
});
