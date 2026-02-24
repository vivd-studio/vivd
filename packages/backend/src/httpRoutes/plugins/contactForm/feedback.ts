import express from "express";
import {
  emailDeliverabilityService,
  isSesFeedbackAutoConfirmEnabled,
  type EmailFeedbackEventType,
} from "../../../services/email/deliverability";

const SES_NOTIFICATION_TYPES = new Set(["bounce", "complaint"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== null);
}

function readFirstTagValue(
  tags: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!tags) return null;

  const raw = tags[key];
  if (!raw) return null;

  if (Array.isArray(raw)) {
    for (const value of raw) {
      const parsed = readString(value);
      if (parsed) return parsed;
    }
    return null;
  }

  return readString(raw);
}

function normalizeSesNotificationType(value: unknown): EmailFeedbackEventType | null {
  const parsed = readString(value)?.toLowerCase();
  if (!parsed || !SES_NOTIFICATION_TYPES.has(parsed)) return null;
  return parsed as EmailFeedbackEventType;
}

function parseNotificationBody(rawBody: unknown): Record<string, unknown> | null {
  const record = asRecord(rawBody);
  if (!record) return null;

  const message = record.Message;
  if (typeof message === "string" && message.trim()) {
    try {
      return asRecord(JSON.parse(message));
    } catch {
      return null;
    }
  }

  return record;
}

function parseNotificationRecipients(
  notification: Record<string, unknown>,
  type: EmailFeedbackEventType,
): string[] {
  if (type === "bounce") {
    const bounce = asRecord(notification.bounce);
    if (!bounce) return [];
    const bouncedRecipients = Array.isArray(bounce.bouncedRecipients)
      ? bounce.bouncedRecipients
      : [];

    const emails: string[] = [];
    for (const recipient of bouncedRecipients) {
      const recipientRecord = asRecord(recipient);
      const emailAddress = readString(recipientRecord?.emailAddress);
      if (emailAddress) emails.push(emailAddress);
    }
    return emails;
  }

  const complaint = asRecord(notification.complaint);
  if (!complaint) return [];
  const complainedRecipients = Array.isArray(complaint.complainedRecipients)
    ? complaint.complainedRecipients
    : [];

  const emails: string[] = [];
  for (const recipient of complainedRecipients) {
    const recipientRecord = asRecord(recipient);
    const emailAddress = readString(recipientRecord?.emailAddress);
    if (emailAddress) emails.push(emailAddress);
  }
  return emails;
}

async function confirmSubscription(subscribeUrl: string): Promise<void> {
  if (!isSesFeedbackAutoConfirmEnabled()) return;

  try {
    await fetch(subscribeUrl, { method: "GET" });
  } catch (error) {
    console.error("[EmailFeedback] Failed to auto-confirm SES SNS subscription", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function readWebhookSecret(req: express.Request): string {
  return (
    readString(req.query.secret)?.trim() ||
    req.get("x-vivd-feedback-secret")?.trim() ||
    ""
  );
}

export function createEmailFeedbackRouter() {
  const router = express.Router();
  const jsonParser = express.json({ limit: "256kb" });

  router.post("/email/v1/feedback/ses", jsonParser, async (req, res) => {
    const configuredSecret =
      (process.env.VIVD_SES_FEEDBACK_WEBHOOK_SECRET || "").trim();
    if (configuredSecret) {
      const providedSecret = readWebhookSecret(req);
      if (!providedSecret || providedSecret !== configuredSecret) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }
    }

    const envelope = asRecord(req.body);
    if (!envelope) {
      return res.status(400).json({ ok: false, error: "invalid_payload" });
    }

    const messageType =
      req.get("x-amz-sns-message-type")?.trim() || readString(envelope.Type);

    if (messageType === "SubscriptionConfirmation") {
      const subscribeUrl = readString(envelope.SubscribeURL);
      if (subscribeUrl) {
        await confirmSubscription(subscribeUrl);
      }
      return res.status(200).json({ ok: true });
    }

    const notification = parseNotificationBody(req.body);
    if (!notification) {
      return res.status(202).json({ ok: true, ignored: "unsupported_payload" });
    }

    const type = normalizeSesNotificationType(notification.notificationType);
    if (!type) {
      return res.status(202).json({ ok: true, ignored: "unsupported_notification" });
    }

    const mail = asRecord(notification.mail);
    const tags = asRecord(mail?.tags);
    const organizationId = readFirstTagValue(tags, "organization");
    const projectSlug = readFirstTagValue(tags, "project");

    const recipientEmails = parseNotificationRecipients(notification, type);
    if (recipientEmails.length === 0) {
      recipientEmails.push(...readStringArray(mail?.destination));
    }

    const occurredAt = readString(mail?.timestamp) || undefined;

    const result = await emailDeliverabilityService.recordFeedback({
      type,
      recipientEmails,
      provider: "ses",
      source: "provider_webhook",
      occurredAt,
      organizationId,
      projectSlug,
      flow: readFirstTagValue(tags, "plugin") || "contact_form",
    });

    return res.status(200).json({
      ok: true,
      recordedRecipients: result.appliedRecipientCount,
      suppressedRecipients: result.summary.metrics.suppressedRecipientCount,
    });
  });

  return router;
}
