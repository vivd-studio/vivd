import express from "express";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordFeedbackMock, verifyWebhookMock } = vi.hoisted(() => ({
  recordFeedbackMock: vi.fn(),
  verifyWebhookMock: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({
    webhooks: {
      verify: verifyWebhookMock,
    },
  })),
}));

vi.mock("../src/services/email/deliverability", () => ({
  emailDeliverabilityService: {
    recordFeedback: recordFeedbackMock,
  },
  isSesFeedbackAutoConfirmEnabled: vi.fn(() => false),
}));

async function postResendWebhook(body: string, headers?: Record<string, string>) {
  const { createEmailFeedbackRouter } = await import(
    "../src/httpRoutes/plugins/contactForm/feedback"
  );

  const app = express();
  app.use(createEmailFeedbackRouter());
  const server = app.listen(0);

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/email/v1/feedback/resend`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_123",
        "svix-timestamp": "1708785600",
        "svix-signature": "v1,test",
        ...(headers || {}),
      },
      body,
    });

    return response;
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

describe("createEmailFeedbackRouter (Resend)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
    recordFeedbackMock.mockResolvedValue({
      appliedRecipientCount: 1,
      summary: {
        metrics: {
          suppressedRecipientCount: 5,
        },
      },
    });
  });

  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    recordFeedbackMock.mockReset();
    verifyWebhookMock.mockReset();
  });

  it("records bounced events into deliverability suppression flow", async () => {
    verifyWebhookMock.mockReturnValue({
      type: "email.bounced",
      created_at: "2026-02-24T12:00:00.000Z",
      data: {
        to: ["owner@example.com"],
        tags: {
          organization: "org-1",
          project: "site-1",
          plugin: "contact_form",
        },
      },
    });

    const response = await postResendWebhook(JSON.stringify({ hello: "world" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      recordedRecipients: 1,
      suppressedRecipients: 5,
    });
    expect(recordFeedbackMock).toHaveBeenCalledWith({
      type: "bounce",
      recipientEmails: ["owner@example.com"],
      provider: "resend",
      source: "provider_webhook",
      occurredAt: "2026-02-24T12:00:00.000Z",
      organizationId: "org-1",
      projectSlug: "site-1",
      flow: "contact_form",
    });
  });

  it("rejects payloads when signature verification fails", async () => {
    verifyWebhookMock.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const response = await postResendWebhook(JSON.stringify({ hello: "world" }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(recordFeedbackMock).not.toHaveBeenCalled();
  });
});
