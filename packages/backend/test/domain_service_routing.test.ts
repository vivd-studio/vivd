import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolvePolicyMock } = vi.hoisted(() => ({
  resolvePolicyMock: vi.fn(),
}));

vi.mock("../src/services/system/InstallProfileService", () => ({
  installProfileService: {
    resolvePolicy: resolvePolicyMock,
  },
}));

import { DomainService } from "../src/services/publish/DomainService";

const ORIGINAL_ENV = new Map<string, string | undefined>([
  ["DOMAIN", process.env.DOMAIN],
  ["CONTROL_PLANE_HOST", process.env.CONTROL_PLANE_HOST],
  ["TENANT_BASE_DOMAIN", process.env.TENANT_BASE_DOMAIN],
]);

function restoreEnv(): void {
  for (const [key, value] of ORIGINAL_ENV) {
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

describe("DomainService routing policy", () => {
  beforeEach(() => {
    restoreEnv();
    resolvePolicyMock.mockReset();
    resolvePolicyMock.mockResolvedValue({
      installProfile: "platform",
      singleProjectMode: false,
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
        contact_form: {
          pluginId: "contact_form",
          state: "disabled",
          managedBy: "manual_superadmin",
        },
        analytics: {
          pluginId: "analytics",
          state: "disabled",
          managedBy: "manual_superadmin",
        },
      },
      limitDefaults: {},
      controlPlane: { mode: "host_based" },
      pluginRuntime: { mode: "dedicated_host" },
    });
  });

  afterEach(() => {
    restoreEnv();
  });

  it("uses the primary host for path-based solo control-plane routing", async () => {
    process.env.DOMAIN = "https://example.com";
    process.env.CONTROL_PLANE_HOST = "app.example.com";
    resolvePolicyMock.mockResolvedValueOnce({
      installProfile: "solo",
      singleProjectMode: true,
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
        contact_form: {
          pluginId: "contact_form",
          state: "enabled",
          managedBy: "manual_superadmin",
        },
        analytics: {
          pluginId: "analytics",
          state: "enabled",
          managedBy: "manual_superadmin",
        },
      },
      limitDefaults: {},
      controlPlane: { mode: "path_based" },
      pluginRuntime: { mode: "same_host_path" },
    });

    const service = new DomainService();

    await expect(service.getResolvedControlPlaneHostForRequest("customer.example.com")).resolves.toBe(
      "example.com",
    );
  });

  it("keeps the dedicated control-plane host in platform mode", async () => {
    process.env.DOMAIN = "https://example.com";
    process.env.CONTROL_PLANE_HOST = "app.example.com";

    const service = new DomainService();

    await expect(service.getResolvedControlPlaneHostForRequest("customer.example.com")).resolves.toBe(
      "app.example.com",
    );
  });
});
