import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSystemSettingValueMock,
  setSystemSettingValueMock,
  settingsStore,
} = vi.hoisted(() => {
  const settingsStore = new Map<string, string>();
  const getSystemSettingValueMock = vi.fn(async (key: string) =>
    settingsStore.has(key) ? settingsStore.get(key)! : null,
  );
  const setSystemSettingValueMock = vi.fn(
    async (key: string, value: string | null) => {
      if (!value) {
        settingsStore.delete(key);
        return;
      }
      settingsStore.set(key, value);
    },
  );

  return {
    getSystemSettingValueMock,
    setSystemSettingValueMock,
    settingsStore,
  };
});

vi.mock("../src/services/system/SystemSettingsService", () => ({
  getSystemSettingValue: getSystemSettingValueMock,
  setSystemSettingValue: setSystemSettingValueMock,
}));

async function loadEmailDeliverabilityService() {
  const module = await import("../src/services/email/deliverability");
  return module.emailDeliverabilityService;
}

describe("emailDeliverabilityService", () => {
  beforeEach(() => {
    vi.resetModules();
    settingsStore.clear();
    getSystemSettingValueMock.mockClear();
    setSystemSettingValueMock.mockClear();
    delete process.env.VIVD_EMAIL_PROVIDER;
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.VIVD_SES_FROM_EMAIL;
    delete process.env.VIVD_SES_ACCESS_KEY_ID;
    delete process.env.VIVD_SES_SECRET_ACCESS_KEY;
    delete process.env.VIVD_SMTP_URL;
    delete process.env.VIVD_SMTP_HOST;
  });

  it("returns empty overview by default", async () => {
    const service = await loadEmailDeliverabilityService();
    const overview = await service.getOverview();

    expect(overview.metrics.suppressedRecipientCount).toBe(0);
    expect(overview.metrics.bounceEventCount).toBe(0);
    expect(overview.metrics.complaintEventCount).toBe(0);
    expect(overview.policy.autoSuppressBounces).toBe(true);
    expect(overview.policy.autoSuppressComplaints).toBe(true);
  });

  it("updates policy via superadmin settings", async () => {
    const service = await loadEmailDeliverabilityService();

    const overview = await service.updatePolicy({
      autoSuppressBounces: true,
      autoSuppressComplaints: false,
      complaintRateThresholdPercent: 0.2,
      bounceRateThresholdPercent: 4,
    });

    expect(overview.policy.autoSuppressComplaints).toBe(false);
    expect(overview.policy.complaintRateThresholdPercent).toBe(0.2);
    expect(overview.policy.bounceRateThresholdPercent).toBe(4);
  });

  it("records feedback and suppresses recipient emails", async () => {
    const service = await loadEmailDeliverabilityService();

    const result = await service.recordFeedback({
      type: "bounce",
      recipientEmails: ["Owner@Example.com", "owner@example.com", "team@example.com"],
      provider: "ses",
      occurredAt: "2026-02-24T12:00:00.000Z",
      organizationId: "org-1",
      projectSlug: "site-1",
      flow: "contact_form",
    });

    expect(result.appliedRecipientCount).toBe(2);
    expect(result.summary.metrics.suppressedRecipientCount).toBe(2);
    expect(result.summary.metrics.bounceEventCount).toBe(2);
    expect(result.summary.suppressedRecipients.map((entry) => entry.email)).toEqual([
      "owner@example.com",
      "team@example.com",
    ]);
  });

  it("filters and unsuppresses recipients", async () => {
    const service = await loadEmailDeliverabilityService();

    await service.recordFeedback({
      type: "complaint",
      recipientEmails: ["owner@example.com"],
      provider: "ses",
    });

    const filtered = await service.filterSuppressedRecipients({
      recipientEmails: ["owner@example.com", "team@example.com"],
    });

    expect(filtered.deliverableRecipients).toEqual(["team@example.com"]);
    expect(filtered.suppressedRecipients.map((entry) => entry.email)).toEqual([
      "owner@example.com",
    ]);

    const overview = await service.unsuppressRecipient({
      email: "owner@example.com",
    });
    expect(overview.suppressedRecipients).toHaveLength(0);
  });

  it("reports smtp as the configured provider without webhook support", async () => {
    process.env.VIVD_EMAIL_PROVIDER = "smtp";
    process.env.VIVD_SMTP_HOST = "smtp.example.com";

    const service = await loadEmailDeliverabilityService();
    const overview = await service.getOverview();

    expect(overview.provider.name).toBe("smtp");
    expect(overview.provider.webhookSecretConfigured).toBe(false);
    expect(overview.provider.autoConfirmSubscriptionsEnabled).toBe(false);
  });
});
