import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useUtilsMock,
  getInstanceSettingsUseQueryMock,
  updateInstanceSettingsUseMutationMock,
  updateInstanceSettingsMutateMock,
} = vi.hoisted(() => ({
  useUtilsMock: vi.fn(),
  getInstanceSettingsUseQueryMock: vi.fn(),
  updateInstanceSettingsUseMutationMock: vi.fn(),
  updateInstanceSettingsMutateMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    superadmin: {
      getInstanceSettings: {
        useQuery: getInstanceSettingsUseQueryMock,
      },
      updateInstanceSettings: {
        useMutation: updateInstanceSettingsUseMutationMock,
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { InstanceSettingsTab } from "./InstanceSettingsTab";

describe("InstanceSettingsTab", () => {
  beforeEach(() => {
    useUtilsMock.mockReset();
    getInstanceSettingsUseQueryMock.mockReset();
    updateInstanceSettingsUseMutationMock.mockReset();
    updateInstanceSettingsMutateMock.mockReset();

    useUtilsMock.mockReturnValue({
      superadmin: {
        getInstanceSettings: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
      config: {
        getAppConfig: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    getInstanceSettingsUseQueryMock.mockReturnValue({
      data: {
        installProfile: "platform",
        singleProjectMode: false,
        instanceAdminLabel: "Super Admin",
        capabilities: {
          multiOrg: true,
          tenantHosts: true,
          customDomains: true,
          orgLimitOverrides: true,
          orgPluginEntitlements: true,
          projectPluginEntitlements: true,
          dedicatedPluginHost: true,
        },
        pluginDefaults: {
          contact_form: { enabled: false },
          analytics: { enabled: false },
        },
        limitDefaults: {},
        controlPlane: {
          mode: "host_based",
        },
        pluginRuntime: {
          mode: "dedicated_host",
        },
        network: {
          publicHost: "app.example.com",
          publicOrigin: "https://app.example.com",
          tlsMode: "external",
          acmeEmail: null,
          sources: {
            publicHost: "bootstrap_env",
            tlsMode: "bootstrap_env",
            acmeEmail: "default",
          },
          deploymentManaged: {
            publicHost: false,
          },
        },
      },
      isLoading: false,
    });

    updateInstanceSettingsUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: updateInstanceSettingsMutateMock,
    });
  });

  it("shows network settings as read-only in platform mode", () => {
    render(<InstanceSettingsTab />);

    expect(screen.getByText("Multi-org platform profile")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "This shows the currently resolved host and TLS state. Platform host topology stays deployment-managed for now.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Public host")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save network" })).toBeDisabled();
    expect(screen.getByText("https://app.example.com")).toBeInTheDocument();
  });

  it("hides profile switching and advanced capability editing in solo mode", () => {
    getInstanceSettingsUseQueryMock.mockReturnValue({
      data: {
        installProfile: "solo",
        singleProjectMode: false,
        instanceAdminLabel: "Instance Settings",
        capabilities: {
          multiOrg: false,
          tenantHosts: false,
          customDomains: false,
          orgLimitOverrides: false,
          orgPluginEntitlements: false,
          projectPluginEntitlements: false,
          dedicatedPluginHost: false,
        },
        pluginDefaults: {
          contact_form: { enabled: true },
          analytics: { enabled: true },
        },
        limitDefaults: {},
        controlPlane: {
          mode: "path_based",
        },
        pluginRuntime: {
          mode: "same_host_path",
        },
        network: {
          publicHost: "example.com",
          publicOrigin: "https://example.com",
          tlsMode: "managed",
          acmeEmail: "admin@example.com",
          sources: {
            publicHost: "settings",
            tlsMode: "settings",
            acmeEmail: "settings",
          },
          deploymentManaged: {
            publicHost: false,
          },
        },
      },
      isLoading: false,
    });

    render(<InstanceSettingsTab />);

    expect(screen.getByText("Single-tenant self-host profile")).toBeInTheDocument();
    expect(screen.getByText(/licensed platform deployments/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
    expect(screen.queryByText("Capabilities")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save capabilities" }),
    ).not.toBeInTheDocument();
  });
});
