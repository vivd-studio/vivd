import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useAppConfigMock,
  useUtilsMock,
  getInstanceSettingsUseQueryMock,
  getInstanceSoftwareUseQueryMock,
  updateInstanceSettingsUseMutationMock,
  updateInstanceSettingsMutateMock,
  updateSelfHostNetworkSettingsUseMutationMock,
  updateSelfHostNetworkSettingsMutateMock,
  startSelfHostManagedUpdateUseMutationMock,
  startSelfHostManagedUpdateMutateMock,
} = vi.hoisted(() => ({
  useAppConfigMock: vi.fn(),
  useUtilsMock: vi.fn(),
  getInstanceSettingsUseQueryMock: vi.fn(),
  getInstanceSoftwareUseQueryMock: vi.fn(),
  updateInstanceSettingsUseMutationMock: vi.fn(),
  updateInstanceSettingsMutateMock: vi.fn(),
  updateSelfHostNetworkSettingsUseMutationMock: vi.fn(),
  updateSelfHostNetworkSettingsMutateMock: vi.fn(),
  startSelfHostManagedUpdateUseMutationMock: vi.fn(),
  startSelfHostManagedUpdateMutateMock: vi.fn(),
}));

vi.mock("@/lib/AppConfigContext", () => ({
  useAppConfig: useAppConfigMock,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    superadmin: {
      getInstanceSettings: {
        useQuery: getInstanceSettingsUseQueryMock,
      },
      getInstanceSoftware: {
        useQuery: getInstanceSoftwareUseQueryMock,
      },
      updateInstanceSettings: {
        useMutation: updateInstanceSettingsUseMutationMock,
      },
      updateSelfHostNetworkSettings: {
        useMutation: updateSelfHostNetworkSettingsUseMutationMock,
      },
      startSelfHostManagedUpdate: {
        useMutation: startSelfHostManagedUpdateUseMutationMock,
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

function renderTab(path = "/vivd-studio/superadmin?section=instance") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <InstanceSettingsTab />
    </MemoryRouter>,
  );
}

describe("InstanceSettingsTab", () => {
  const originalLocation = window.location;
  const scrollIntoViewMock = vi.fn();
  const softwareRefetchMock = vi.fn();

  beforeEach(() => {
    useAppConfigMock.mockReset();
    useUtilsMock.mockReset();
    getInstanceSettingsUseQueryMock.mockReset();
    getInstanceSoftwareUseQueryMock.mockReset();
    updateInstanceSettingsUseMutationMock.mockReset();
    updateInstanceSettingsMutateMock.mockReset();
    updateSelfHostNetworkSettingsUseMutationMock.mockReset();
    updateSelfHostNetworkSettingsMutateMock.mockReset();
    startSelfHostManagedUpdateUseMutationMock.mockReset();
    startSelfHostManagedUpdateMutateMock.mockReset();
    scrollIntoViewMock.mockReset();
    softwareRefetchMock.mockReset();
    window.sessionStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoViewMock,
    });

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

    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "platform",
        experimentalSoloModeEnabled: false,
        selfHostAdminFeaturesEnabled: false,
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

    getInstanceSoftwareUseQueryMock.mockReturnValue({
      data: {
        currentVersion: "1.1.33",
        currentRevision: "abc123def456",
        currentImage: "ghcr.io/vivd-studio/vivd-server:1.1.33",
        currentImageTag: "1.1.33",
        latestVersion: "1.1.34",
        latestTag: "1.1.34",
        latestImage: "ghcr.io/vivd-studio/vivd-server:1.1.34",
        releaseStatus: "available",
        managedUpdate: {
          enabled: false,
          reason: "Platform deployments stay deployment-managed for now.",
          helperImage: null,
          workdir: null,
        },
      },
      isLoading: false,
      isFetching: false,
      refetch: softwareRefetchMock.mockResolvedValue({}),
    });

    updateInstanceSettingsUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: updateInstanceSettingsMutateMock,
    });

    updateSelfHostNetworkSettingsUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: updateSelfHostNetworkSettingsMutateMock,
    });

    startSelfHostManagedUpdateUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: startSelfHostManagedUpdateMutateMock,
    });
  });

  it("keeps the platform view focused on version details", () => {
    renderTab();

    expect(screen.getByText("Hosted control plane profile")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
    expect(screen.getByText("1.1.33")).toBeInTheDocument();
    expect(screen.getByText("1.1.34")).toBeInTheDocument();
    expect(
      screen.getByText("Review the running deployment version and release status."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update to/i })).not.toBeInTheDocument();
    expect(screen.getByText("https://app.example.com")).toBeInTheDocument();
    expect(screen.queryByText("Network")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save network" })).not.toBeInTheDocument();
  });

  it("keeps extra admin features hidden in solo mode", () => {
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "solo",
        experimentalSoloModeEnabled: true,
        selfHostAdminFeaturesEnabled: false,
      },
    });

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

    getInstanceSoftwareUseQueryMock.mockReturnValue({
      data: {
        currentVersion: "1.1.33",
        currentRevision: "abc123def456",
        currentImage: "ghcr.io/vivd-studio/vivd-server:latest",
        currentImageTag: "latest",
        latestVersion: "1.1.34",
        latestTag: "1.1.34",
        latestImage: "ghcr.io/vivd-studio/vivd-server:1.1.34",
        releaseStatus: "unknown",
        managedUpdate: {
          enabled: true,
          reason: null,
          helperImage: "docker:28-cli",
          workdir: "/srv/selfhost",
        },
      },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderTab();

    expect(screen.getByText("Internal compatibility profile")).toBeInTheDocument();
    expect(screen.getByText("1.1.33")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply latest release" })).not.toBeInTheDocument();
    expect(screen.queryByText("Network")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
    expect(screen.queryByText("Capabilities")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save capabilities" }),
    ).not.toBeInTheDocument();
  });

  it("scrolls the software section into view when opened via the version link", async () => {
    renderTab("/vivd-studio/superadmin?section=instance#instance-software");

    expect(screen.getByText("Software")).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled();
    });
  });

  it("locks the updater after the managed update starts", async () => {
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "solo",
        experimentalSoloModeEnabled: true,
        selfHostAdminFeaturesEnabled: true,
      },
    });

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
          publicHost: "49.13.48.211",
          publicOrigin: "http://49.13.48.211",
          tlsMode: "off",
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

    getInstanceSoftwareUseQueryMock.mockReturnValue({
      data: {
        currentVersion: "1.1.38",
        currentRevision: "abc123def456",
        currentImage: "ghcr.io/vivd-studio/vivd-server:latest",
        currentImageTag: "latest",
        latestVersion: "1.1.39",
        latestTag: "1.1.39",
        latestImage: "ghcr.io/vivd-studio/vivd-server:1.1.39",
        releaseStatus: "available",
        managedUpdate: {
          enabled: true,
          reason: null,
          helperImage: "docker:28-cli",
          workdir: "/srv/selfhost",
        },
      },
      isLoading: false,
      isFetching: false,
      refetch: softwareRefetchMock.mockResolvedValue({}),
    });

    startSelfHostManagedUpdateUseMutationMock.mockImplementation((options) => ({
      isPending: false,
      mutate: () => {
        options.onSuccess?.({
          started: true,
          helperContainerId: "helper-1",
          helperImage: "docker:28-cli",
          targetTag: "1.1.39",
        });
      },
    }));

    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Update to 1.1.39" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Updating to 1.1.39" })).toBeDisabled();
    });
    expect(window.sessionStorage.getItem("vivd.instance-software.pending-update")).toContain(
      "\"targetTag\":\"1.1.39\"",
    );
    expect(screen.getByText(/update to 1.1.39 is running/i)).toBeInTheDocument();
  });

  it("reloads only after the target version is reported as current", async () => {
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "solo",
        experimentalSoloModeEnabled: true,
        selfHostAdminFeaturesEnabled: true,
      },
    });

    window.sessionStorage.setItem(
      "vivd.instance-software.pending-update",
      JSON.stringify({
        targetTag: "1.1.39",
        startedAt: Date.now(),
      }),
    );

    const locationSnapshot = window.location;
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...locationSnapshot,
        reload: reloadMock,
      },
    });

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
          publicHost: "49.13.48.211",
          publicOrigin: "http://49.13.48.211",
          tlsMode: "off",
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

    getInstanceSoftwareUseQueryMock.mockReturnValue({
      data: {
        currentVersion: "1.1.39",
        currentRevision: "abc123def456",
        currentImage: "ghcr.io/vivd-studio/vivd-server:latest",
        currentImageTag: "latest",
        latestVersion: "1.1.39",
        latestTag: "1.1.39",
        latestImage: "ghcr.io/vivd-studio/vivd-server:1.1.39",
        releaseStatus: "current",
        managedUpdate: {
          enabled: true,
          reason: null,
          helperImage: "docker:28-cli",
          workdir: "/srv/selfhost",
        },
      },
      isLoading: false,
      isFetching: false,
      refetch: softwareRefetchMock.mockResolvedValue({}),
    });

    renderTab();

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
    expect(window.sessionStorage.getItem("vivd.instance-software.pending-update")).toBeNull();
  });

  it("clears the pending update when the instance comes back on a newer version", async () => {
    useAppConfigMock.mockReturnValue({
      isLoading: false,
      config: {
        installProfile: "solo",
        experimentalSoloModeEnabled: true,
        selfHostAdminFeaturesEnabled: true,
      },
    });

    window.sessionStorage.setItem(
      "vivd.instance-software.pending-update",
      JSON.stringify({
        targetTag: "1.1.39",
        startedAt: Date.now(),
      }),
    );

    const locationSnapshot = window.location;
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...locationSnapshot,
        reload: reloadMock,
      },
    });

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
          publicHost: "49.13.48.211",
          publicOrigin: "http://49.13.48.211",
          tlsMode: "off",
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

    getInstanceSoftwareUseQueryMock.mockReturnValue({
      data: {
        currentVersion: "1.1.40",
        currentRevision: "abc123def456",
        currentImage: "ghcr.io/vivd-studio/vivd-server:latest",
        currentImageTag: "latest",
        latestVersion: "1.1.40",
        latestTag: "1.1.40",
        latestImage: "ghcr.io/vivd-studio/vivd-server:1.1.40",
        releaseStatus: "current",
        managedUpdate: {
          enabled: true,
          reason: null,
          helperImage: "docker:28-cli",
          workdir: "/srv/selfhost",
        },
      },
      isLoading: false,
      isFetching: false,
      refetch: softwareRefetchMock.mockResolvedValue({}),
    });

    renderTab();

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
    expect(window.sessionStorage.getItem("vivd.instance-software.pending-update")).toBeNull();
  });
});
