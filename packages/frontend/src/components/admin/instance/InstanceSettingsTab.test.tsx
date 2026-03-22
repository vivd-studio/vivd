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

    expect(
      screen.getByText(
        "This shows the currently resolved host and TLS state. Platform host topology stays deployment-managed for now.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Public host")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save network" })).toBeDisabled();
    expect(screen.getByText("https://app.example.com")).toBeInTheDocument();
  });
});
