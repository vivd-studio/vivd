import { afterEach, describe, expect, it } from "vitest";
import {
  getContactFormSubmitEndpoint,
  getPublicPluginApiBaseUrl,
} from "../src/services/plugins/contactForm/publicApi";

const originalPublicPluginApiBaseUrl = process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL;

describe("plugin public API helpers", () => {
  afterEach(() => {
    if (typeof originalPublicPluginApiBaseUrl === "string") {
      process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL = originalPublicPluginApiBaseUrl;
      return;
    }
    delete process.env.VIVD_PUBLIC_PLUGIN_API_BASE_URL;
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
});
