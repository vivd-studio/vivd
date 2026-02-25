import { afterEach, describe, expect, it } from "vitest";
import {
  getContactFormSubmitEndpoint,
  getContactRecipientVerificationEndpoint,
  getPublicPluginApiBaseUrl,
} from "../src/services/plugins/contactForm/publicApi";

const originalPublicPluginApiBaseUrl = process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL;
const originalAppUrl = process.env.VIVD_APP_URL;
const originalControlPlaneHost = process.env.CONTROL_PLANE_HOST;

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
  afterEach(() => {
    restoreEnvVar(
      "VIVD_PUBLIC_PLUGIN_API_BASE_URL",
      originalPublicPluginApiBaseUrl,
    );
    restoreEnvVar("VIVD_APP_URL", originalAppUrl);
    restoreEnvVar("CONTROL_PLANE_HOST", originalControlPlaneHost);
  });

  it("uses api.vivd.studio as default public base URL", () => {
    delete process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL;

    expect(getPublicPluginApiBaseUrl()).toBe("https://api.vivd.studio");
    expect(getContactFormSubmitEndpoint()).toBe(
      "https://api.vivd.studio/plugins/contact/v1/submit",
    );
  });

  it("normalizes host override without protocol", () => {
    process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL = "api.dev.vivd.local/";

    expect(getPublicPluginApiBaseUrl()).toBe("https://api.dev.vivd.local");
    expect(getContactFormSubmitEndpoint()).toBe(
      "https://api.dev.vivd.local/plugins/contact/v1/submit",
    );
  });

  it("uses request host for recipient verification endpoint", () => {
    delete process.env.VIVD_APP_URL;
    delete process.env.CONTROL_PLANE_HOST;

    expect(
      getContactRecipientVerificationEndpoint({
        requestHost: "felixpahlke.vivd.studio",
      }),
    ).toBe(
      "https://felixpahlke.vivd.studio/vivd-studio/api/plugins/contact/v1/recipient-verify",
    );
  });

  it("uses local http scheme for localhost control-plane host", () => {
    delete process.env.VIVD_APP_URL;
    process.env.CONTROL_PLANE_HOST = "app.localhost:5173";

    expect(getContactRecipientVerificationEndpoint()).toBe(
      "http://app.localhost:5173/vivd-studio/api/plugins/contact/v1/recipient-verify",
    );
  });

  it("falls back to public plugin host when no control-plane URL is available", () => {
    delete process.env.VIVD_APP_URL;
    delete process.env.CONTROL_PLANE_HOST;
    delete process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL;

    expect(getContactRecipientVerificationEndpoint()).toBe(
      "https://api.vivd.studio/plugins/contact/v1/recipient-verify",
    );
  });
});
