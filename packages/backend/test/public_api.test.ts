import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  ContactRecipientVerificationEndpointUnavailableError,
  buildContactFormSubmitEndpoint,
  buildContactRecipientVerificationEndpoint,
} from "@vivd/plugin-contact-form/backend/publicApi";

const { resolvePolicyMock } = vi.hoisted(() => ({
  resolvePolicyMock: vi.fn(),
}));

vi.mock("../src/services/system/InstallProfileService", () => ({
  installProfileService: {
    resolvePolicy: resolvePolicyMock,
  },
}));

import {
  getControlPlaneOrigin,
  getPublicPluginApiBaseUrl,
} from "../src/services/plugins/runtime/publicApi";

const originalPublicPluginApiBaseUrl = process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL;
const originalAppUrl = process.env.VIVD_APP_URL;
const originalControlPlaneHost = process.env.CONTROL_PLANE_HOST;
const originalDomain = process.env.DOMAIN;
const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;

function restoreEnvVar(
  name: string,
  value: string | undefined,
): void {
  if (typeof value === "string") {
    process.env[name] = value;
    return;
  }
  delete process.env[name];
}

describe("plugin public API helpers", () => {
  beforeEach(() => {
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
    restoreEnvVar(
      "VIVD_PUBLIC_PLUGIN_API_BASE_URL",
      originalPublicPluginApiBaseUrl,
    );
    restoreEnvVar("VIVD_APP_URL", originalAppUrl);
    restoreEnvVar("CONTROL_PLANE_HOST", originalControlPlaneHost);
    restoreEnvVar("DOMAIN", originalDomain);
    restoreEnvVar("BETTER_AUTH_URL", originalBetterAuthUrl);
  });

  it("uses api.vivd.studio as default public base URL", async () => {
    delete process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL;

    await expect(getPublicPluginApiBaseUrl()).resolves.toBe("https://api.vivd.studio");
    await expect(
      getPublicPluginApiBaseUrl().then((baseUrl) =>
        buildContactFormSubmitEndpoint(baseUrl),
      ),
    ).resolves.toBe(
      "https://api.vivd.studio/plugins/contact/v1/submit",
    );
  });

  it("normalizes host override without protocol", async () => {
    process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL = "api.dev.vivd.local/";

    await expect(getPublicPluginApiBaseUrl()).resolves.toBe("https://api.dev.vivd.local");
    await expect(
      getPublicPluginApiBaseUrl().then((baseUrl) =>
        buildContactFormSubmitEndpoint(baseUrl),
      ),
    ).resolves.toBe(
      "https://api.dev.vivd.local/plugins/contact/v1/submit",
    );
  });

  it("uses the same host for plugin endpoints in solo mode", async () => {
    delete process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL;
    process.env.DOMAIN = "https://example.com";
    resolvePolicyMock.mockResolvedValue({
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

    await expect(getPublicPluginApiBaseUrl()).resolves.toBe("https://example.com");
    await expect(
      getPublicPluginApiBaseUrl().then((baseUrl) =>
        buildContactFormSubmitEndpoint(baseUrl),
      ),
    ).resolves.toBe(
      "https://example.com/plugins/contact/v1/submit",
    );
  });

  it("uses request host for recipient verification endpoint", () => {
    delete process.env.VIVD_APP_URL;
    delete process.env.CONTROL_PLANE_HOST;

    const origin = getControlPlaneOrigin({
      requestHost: "felixpahlke.vivd.studio",
    });

    expect(buildContactRecipientVerificationEndpoint(origin)).toBe(
      "https://felixpahlke.vivd.studio/vivd-studio/api/plugins/contact/v1/recipient-verify",
    );
  });

  it("uses local http scheme for localhost control-plane host", () => {
    delete process.env.VIVD_APP_URL;
    process.env.CONTROL_PLANE_HOST = "app.localhost:5173";

    expect(buildContactRecipientVerificationEndpoint(getControlPlaneOrigin())).toBe(
      "http://app.localhost:5173/vivd-studio/api/plugins/contact/v1/recipient-verify",
    );
  });

  it("throws when no control-plane URL is available", () => {
    delete process.env.VIVD_APP_URL;
    delete process.env.CONTROL_PLANE_HOST;
    delete process.env.DOMAIN;
    delete process.env.BETTER_AUTH_URL;

    expect(() => buildContactRecipientVerificationEndpoint(getControlPlaneOrigin())).toThrow(
      ContactRecipientVerificationEndpointUnavailableError,
    );
  });
});
