import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sesSendMock, sesClientCtorMock, resendSendMock, resendCtorMock } = vi.hoisted(() => {
  const sesSendMock = vi.fn();
  const sesClientCtorMock = vi.fn(() => ({ send: sesSendMock }));
  const resendSendMock = vi.fn();
  const resendCtorMock = vi.fn(() => ({
    emails: {
      send: resendSendMock,
    },
  }));
  return { sesSendMock, sesClientCtorMock, resendSendMock, resendCtorMock };
});

vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: sesClientCtorMock,
  SendEmailCommand: vi.fn((input) => input),
}));

vi.mock("resend", () => ({
  Resend: resendCtorMock,
}));

async function loadGetEmailDeliveryService() {
  const module = await import("../src/services/integrations/EmailDeliveryService");
  return module.getEmailDeliveryService;
}

describe("EmailDeliveryService", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.EMAIL_PROVIDER;
    delete process.env.VIVD_EMAIL_PROVIDER;
    delete process.env.VIVD_SES_ACCESS_KEY_ID;
    delete process.env.VIVD_SES_SECRET_ACCESS_KEY;
    delete process.env.VIVD_SES_REGION;
    delete process.env.VIVD_SES_FROM_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.VIVD_EMAIL_FROM;
  });

  afterEach(() => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.VIVD_EMAIL_PROVIDER;
    delete process.env.VIVD_SES_ACCESS_KEY_ID;
    delete process.env.VIVD_SES_SECRET_ACCESS_KEY;
    delete process.env.VIVD_SES_REGION;
    delete process.env.VIVD_SES_FROM_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.VIVD_EMAIL_FROM;
    vi.restoreAllMocks();
    sesSendMock.mockReset();
    sesClientCtorMock.mockClear();
    resendSendMock.mockReset();
    resendCtorMock.mockClear();
  });

  it("uses noop provider by default", async () => {
    const getEmailDeliveryService = await loadGetEmailDeliveryService();
    const service = getEmailDeliveryService();
    const result = await service.send({
      to: ["team@example.com"],
      subject: "Test",
      text: "Hello",
    });

    expect(service.providerName).toBe("noop");
    expect(result.accepted).toBe(true);
    expect(result.provider).toBe("noop");
  });

  it("falls back to noop for unsupported providers", async () => {
    process.env.VIVD_EMAIL_PROVIDER = "unknown-provider";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getEmailDeliveryService = await loadGetEmailDeliveryService();

    const service = getEmailDeliveryService();
    expect(service.providerName).toBe("noop");
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("auto-selects Resend provider when RESEND_API_KEY exists", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.VIVD_EMAIL_FROM = "noreply@mail.vivd.studio";
    resendSendMock.mockResolvedValueOnce({
      data: { id: "resend-message-1" },
      error: null,
      headers: null,
    });
    const getEmailDeliveryService = await loadGetEmailDeliveryService();

    const service = getEmailDeliveryService();
    expect(service.providerName).toBe("resend");

    const result = await service.send({
      to: ["hello@example.com"],
      subject: "Contact",
      text: "Hello",
      replyTo: "person@example.com",
    });

    expect(result.accepted).toBe(true);
    expect(result.provider).toBe("resend");
    expect(result.messageId).toBe("resend-message-1");
    expect(resendCtorMock).toHaveBeenCalledOnce();
    expect(resendSendMock).toHaveBeenCalledOnce();
  });

  it("auto-selects SES provider when SES env configuration exists", async () => {
    process.env.VIVD_SES_REGION = "eu-central-1";
    process.env.VIVD_SES_FROM_EMAIL = "noreply@mail.vivd.studio";
    sesSendMock.mockResolvedValueOnce({ MessageId: "ses-message-1" });
    const getEmailDeliveryService = await loadGetEmailDeliveryService();

    const service = getEmailDeliveryService();
    expect(service.providerName).toBe("ses");

    const result = await service.send({
      to: ["hello@example.com"],
      subject: "Contact",
      text: "Hello",
      replyTo: "person@example.com",
    });

    expect(result.accepted).toBe(true);
    expect(result.provider).toBe("ses");
    expect(result.messageId).toBe("ses-message-1");
    expect(sesClientCtorMock).toHaveBeenCalledOnce();
    expect(sesSendMock).toHaveBeenCalledOnce();
  });
});
