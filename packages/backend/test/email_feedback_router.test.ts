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

  // Avoid opening sockets in restricted environments by invoking the route handler directly.
  const router = createEmailFeedbackRouter() as unknown as {
    stack?: Array<{
      route?: {
        path?: string;
        stack?: Array<{ handle: (req: any, res: any) => unknown }>;
      };
    }>;
  };
  const resendLayer = router.stack?.find(
    (layer) => layer.route?.path === "/email/v1/feedback/resend",
  );
  const resendStack = resendLayer?.route?.stack;
  const resendHandler =
    resendStack && resendStack.length > 0 ? resendStack[resendStack.length - 1].handle : null;
  if (!resendHandler) {
    throw new Error("Could not resolve resend feedback route handler");
  }

  const headerMap = new Map<string, string>();
  for (const [key, value] of Object.entries({
    "content-type": "application/json",
    "svix-id": "msg_123",
    "svix-timestamp": "1708785600",
    "svix-signature": "v1,test",
    ...(headers || {}),
  })) {
    headerMap.set(key.toLowerCase(), value);
  }

  let statusCode = 200;
  let payload: unknown = null;
  const req = {
    body,
    query: {},
    get(name: string) {
      return headerMap.get(name.toLowerCase()) ?? undefined;
    },
  };
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      payload = value;
      return this;
    },
  };

  await resendHandler(req, res);

  return {
    status: statusCode,
    async json() {
      return payload;
    },
  };
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
