import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSystemSettingJsonValueMock, setSystemSettingJsonValueMock } = vi.hoisted(
  () => ({
    getSystemSettingJsonValueMock: vi.fn(),
    setSystemSettingJsonValueMock: vi.fn(),
  }),
);

vi.mock("../src/services/system/SystemSettingsService", () => ({
  getSystemSettingJsonValue: getSystemSettingJsonValueMock,
  setSystemSettingJsonValue: setSystemSettingJsonValueMock,
  SYSTEM_SETTING_KEYS: {
    emailTemplateBranding: "email_template_branding",
  },
}));

import { EmailTemplateBrandingService } from "../src/services/email/templateBranding";

describe("EmailTemplateBrandingService", () => {
  beforeEach(() => {
    getSystemSettingJsonValueMock.mockReset();
    setSystemSettingJsonValueMock.mockReset();
    getSystemSettingJsonValueMock.mockResolvedValue(null);

    delete process.env.VIVD_APP_URL;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.CONTROL_PLANE_HOST;
    delete process.env.BACKEND_URL;
    delete process.env.DOMAIN;
    delete process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL;
  });

  it("falls back to the hosted Vivd support contact on official control-plane hosts", async () => {
    process.env.CONTROL_PLANE_HOST = "default.vivd.studio";

    const service = new EmailTemplateBrandingService();
    const result = await service.getResolvedBranding();

    expect(result.supportEmail).toBe("hello@vivd.studio");
  });

  it("keeps self-host installs without an implicit support contact", async () => {
    process.env.CONTROL_PLANE_HOST = "app.customer-example.test";

    const service = new EmailTemplateBrandingService();
    const result = await service.getResolvedBranding();

    expect(result.supportEmail).toBeUndefined();
  });

  it("preserves an explicitly configured support contact over the hosted default", async () => {
    process.env.CONTROL_PLANE_HOST = "default.vivd.studio";
    getSystemSettingJsonValueMock.mockResolvedValue({
      supportEmail: "support@vivd.studio",
    });

    const service = new EmailTemplateBrandingService();
    const result = await service.getResolvedBranding();

    expect(result.supportEmail).toBe("support@vivd.studio");
  });
});
