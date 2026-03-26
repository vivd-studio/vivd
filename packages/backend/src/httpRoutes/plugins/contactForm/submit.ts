import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Multer } from "multer";
import { z } from "zod";
import { db } from "../../../db";
import { contactFormSubmission, projectPluginInstance } from "../../../db/schema";
import { contactFormPluginConfigSchema } from "../../../services/plugins/contactForm/config";
import { pluginEntitlementService } from "../../../services/plugins/PluginEntitlementService";
import { inferContactFormAutoSourceHosts } from "../../../services/plugins/contactForm/sourceHosts";
import { contactFormTurnstileService } from "../../../services/plugins/contactForm/turnstile";
import { getEmailDeliveryService } from "../../../services/integrations/EmailDeliveryService";
import { buildContactSubmissionEmail } from "../../../services/email/templates";
import { emailDeliverabilityService } from "../../../services/email/deliverability";
import {
  extractSourceHostFromHeaders,
  isHostAllowed,
  resolveDefaultSuccessRedirectTarget,
  resolveEffectiveRedirectHosts,
  resolveEffectiveSourceHosts,
  resolveRedirectTarget,
} from "./helpers";

export type ContactFormPublicRouterDeps = {
  upload: Pick<Multer, "none">;
};

const emailFieldSchema = z.string().email();
const DEFAULT_MIN_REPEAT_SECONDS = 2;
const DEFAULT_RATE_LIMIT_PER_IP_PER_MINUTE = 10;
const DEFAULT_RATE_LIMIT_PER_IP_PER_HOUR = 120;
const DEFAULT_RATE_LIMIT_PER_TOKEN_PER_MINUTE = 60;
const DEFAULT_RATE_LIMIT_PER_TOKEN_PER_HOUR = 1000;
const DEFAULT_DUPLICATE_WINDOW_SECONDS = 45;
const DEFAULT_MAX_TOTAL_FIELD_CHARS = 8_000;
const DEFAULT_MAX_SINGLE_FIELD_CHARS = 2_000;
const DEFAULT_MAX_LINKS_PER_SUBMISSION = 5;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function getContactFormAbuseConfig() {
  return {
    minRepeatSeconds: readPositiveIntEnv(
      "VIVD_CONTACT_FORM_MIN_REPEAT_SECONDS",
      DEFAULT_MIN_REPEAT_SECONDS,
    ),
    rateLimitPerIpPerMinute: readPositiveIntEnv(
      "VIVD_CONTACT_FORM_RATE_LIMIT_PER_IP_PER_MINUTE",
      DEFAULT_RATE_LIMIT_PER_IP_PER_MINUTE,
    ),
    rateLimitPerIpPerHour: readPositiveIntEnv(
      "VIVD_CONTACT_FORM_RATE_LIMIT_PER_IP_PER_HOUR",
      DEFAULT_RATE_LIMIT_PER_IP_PER_HOUR,
    ),
    rateLimitPerTokenPerMinute: readPositiveIntEnv(
      "VIVD_CONTACT_FORM_RATE_LIMIT_PER_TOKEN_PER_MINUTE",
      DEFAULT_RATE_LIMIT_PER_TOKEN_PER_MINUTE,
    ),
    rateLimitPerTokenPerHour: readPositiveIntEnv(
      "VIVD_CONTACT_FORM_RATE_LIMIT_PER_TOKEN_PER_HOUR",
      DEFAULT_RATE_LIMIT_PER_TOKEN_PER_HOUR,
    ),
    duplicateWindowSeconds: readPositiveIntEnv(
      "VIVD_CONTACT_FORM_DUPLICATE_WINDOW_SECONDS",
      DEFAULT_DUPLICATE_WINDOW_SECONDS,
    ),
    maxTotalFieldChars: readPositiveIntEnv(
      "VIVD_CONTACT_FORM_MAX_TOTAL_FIELD_CHARS",
      DEFAULT_MAX_TOTAL_FIELD_CHARS,
    ),
    maxSingleFieldChars: readPositiveIntEnv(
      "VIVD_CONTACT_FORM_MAX_SINGLE_FIELD_CHARS",
      DEFAULT_MAX_SINGLE_FIELD_CHARS,
    ),
    maxLinksPerSubmission: readPositiveIntEnv(
      "VIVD_CONTACT_FORM_MAX_LINKS_PER_SUBMISSION",
      DEFAULT_MAX_LINKS_PER_SUBMISSION,
    ),
  };
}

function normalizeFieldValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
      if (typeof entry === "number" || typeof entry === "boolean") {
        return String(entry);
      }
    }
  }
  return "";
}

function readRequestFields(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const entries = Object.entries(body as Record<string, unknown>);
  return Object.fromEntries(entries.map(([key, value]) => [key, normalizeFieldValue(value)]));
}

function extractClientIp(req: express.Request): string | null {
  const cfConnectingIp = req.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  const xRealIp = req.get("x-real-ip")?.trim();
  if (xRealIp) return xRealIp;

  const forwarded = req.get("x-forwarded-for");
  if (forwarded) {
    // Use the right-most value: reverse proxies append to x-forwarded-for.
    const forwardedParts = forwarded
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const forwardedIp =
      forwardedParts.length > 0
        ? forwardedParts[forwardedParts.length - 1]
        : undefined;
    if (forwardedIp) return forwardedIp;
  }

  const requestIp = req.ip?.trim();
  if (requestIp) return requestIp;
  return null;
}

function hashClientIp(value: string | null): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSubmissionPayload(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, raw]) => [
      key,
      normalizeFieldValue(raw),
    ]),
  );
}

function serializeSubmissionPayload(
  payload: Record<string, string>,
): string {
  const sortedEntries = Object.entries(payload).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify(sortedEntries);
}

function isWithinWindow(
  value: Date,
  now: Date,
  windowMs: number,
): boolean {
  return now.getTime() - value.getTime() < windowMs;
}

function countLinksInText(value: string): number {
  if (!value) return 0;
  const matches = value.match(/\b(?:https?:\/\/|www\.)/gi);
  return matches?.length ?? 0;
}

function sanitizeSubject(rawSubject: string, projectSlug: string): string {
  const fallback = `New message from ${projectSlug}`;
  const candidate = rawSubject
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 160);
  return candidate || fallback;
}

function formatSubmittedAtForEmail(submittedAt: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(submittedAt);
}

type SubmittedContactField = {
  key: string;
  label: string;
  type: "text" | "email" | "textarea";
  required: boolean;
  value: string;
};

function collectSubmittedFormFields(
  fields: Record<string, string>,
  configuredFields: {
    key: string;
    label: string;
    type: "text" | "email" | "textarea";
    required: boolean;
  }[],
): SubmittedContactField[] {
  return configuredFields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    value: fields[field.key] || "",
  }));
}

function collectNonEmptyFields(
  fields: SubmittedContactField[],
): SubmittedContactField[] {
  return fields.filter((field) => field.value.trim().length > 0);
}

function collectMissingRequiredFieldLabels(
  fields: SubmittedContactField[],
): string[] {
  return fields
    .filter((field) => field.required && field.value.trim().length === 0)
    .map((field) => field.label);
}

function collectInvalidEmailFieldLabels(
  fields: SubmittedContactField[],
): string[] {
  return fields
    .filter((field) => {
      if (field.type !== "email") return false;
      if (field.value.trim().length === 0) return false;
      return !emailFieldSchema.safeParse(field.value).success;
    })
    .map((field) => field.label);
}

function collectUnknownFields(
  fields: Record<string, string>,
  ignoredKeys: Set<string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => {
      if (ignoredKeys.has(key)) return false;
      return value.trim().length > 0;
    }),
  );
}

function requestWantsJson(req: express.Request): boolean {
  if (req.is("application/json")) return true;

  const acceptHeader = (req.get("accept") || "").toLowerCase();
  if (!acceptHeader) return false;
  if (acceptHeader.includes("text/html")) return false;
  return acceptHeader.includes("application/json");
}

function sendSubmitSuccess(
  req: express.Request,
  res: express.Response,
  redirectTarget: string | null,
) {
  if (!requestWantsJson(req) && redirectTarget) {
    return res.redirect(303, redirectTarget);
  }

  if (requestWantsJson(req)) {
    return res.status(200).json({ ok: true });
  }

  return res.status(200).send("ok");
}

function sendSubmitError(
  req: express.Request,
  res: express.Response,
  status: number,
  code: string,
  message: string,
) {
  if (requestWantsJson(req)) {
    return res.status(status).json({ ok: false, error: { code, message } });
  }

  return res.status(status).send(message);
}

export function createContactFormPublicRouter(
  deps: ContactFormPublicRouterDeps,
) {
  const router = express.Router();
  const formParser = express.urlencoded({ extended: false, limit: "256kb" });
  const jsonParser = express.json({ limit: "256kb" });

  router.post(
    "/contact/v1/submit",
    deps.upload.none(),
    formParser,
    jsonParser,
    async (req, res) => {
      const fields = readRequestFields(req.body);
      const token = fields.token;
      if (!token) {
        return sendSubmitError(req, res, 400, "missing_token", "token is required");
      }

      const pluginInstance = await db.query.projectPluginInstance.findFirst({
        where: and(
          eq(projectPluginInstance.publicToken, token),
          eq(projectPluginInstance.pluginId, "contact_form"),
          eq(projectPluginInstance.status, "enabled"),
        ),
      });

      if (!pluginInstance) {
        return sendSubmitError(req, res, 404, "invalid_token", "plugin token not found");
      }

      const entitlement = await pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
        pluginId: "contact_form",
      });
      if (entitlement.state !== "enabled") {
        return sendSubmitError(
          req,
          res,
          403,
          "plugin_not_entitled",
          "contact form is not enabled for this project",
        );
      }

      const configResult = contactFormPluginConfigSchema.safeParse(
        pluginInstance.configJson ?? {},
      );
      const config = configResult.success
        ? configResult.data
        : contactFormPluginConfigSchema.parse({});

      const sourceHost = extractSourceHostFromHeaders({
        origin: req.get("origin"),
        referer: req.get("referer"),
      });

      const inferredSourceHosts = await inferContactFormAutoSourceHosts({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
      });
      const effectiveSourceHosts = resolveEffectiveSourceHosts(
        config.sourceHosts,
        inferredSourceHosts,
      );
      const redirectAllowlist = resolveEffectiveRedirectHosts(
        config.redirectHostAllowlist,
        effectiveSourceHosts,
      );
      const redirectTarget = resolveRedirectTarget(fields._redirect, redirectAllowlist);
      const successRedirectTarget =
        redirectTarget ??
        resolveDefaultSuccessRedirectTarget({
          rawReferer: req.get("referer"),
          rawOrigin: req.get("origin"),
          allowlist: redirectAllowlist,
        });

      if (!isHostAllowed(sourceHost, effectiveSourceHosts)) {
        return sendSubmitError(req, res, 403, "forbidden_source", "source host not allowed");
      }

      const honeypotField = "_honeypot";
      if ((fields[honeypotField] || "").length > 0) {
        return sendSubmitSuccess(req, res, successRedirectTarget);
      }

      const submittedFields = collectSubmittedFormFields(fields, config.formFields);
      const missingRequiredFieldLabels = collectMissingRequiredFieldLabels(submittedFields);
      if (missingRequiredFieldLabels.length > 0) {
        return sendSubmitError(
          req,
          res,
          400,
          "invalid_payload",
          `Missing required fields: ${missingRequiredFieldLabels.join(", ")}`,
        );
      }

      const invalidEmailFieldLabels = collectInvalidEmailFieldLabels(submittedFields);
      if (invalidEmailFieldLabels.length > 0) {
        return sendSubmitError(
          req,
          res,
          400,
          "invalid_payload",
          `Invalid email fields: ${invalidEmailFieldLabels.join(", ")}`,
        );
      }

      if (entitlement.turnstileEnabled) {
        const turnstileToken = fields["cf-turnstile-response"] || "";
        if (!turnstileToken.trim()) {
          return sendSubmitError(
            req,
            res,
            400,
            "invalid_payload",
            "Turnstile challenge token is missing",
          );
        }

        const turnstileSecretKey = entitlement.turnstileSecretKey || "";
        if (!turnstileSecretKey) {
          return sendSubmitError(
            req,
            res,
            503,
            "plugin_not_configured",
            "Turnstile is enabled but not fully configured yet",
          );
        }

        const turnstileResult = await contactFormTurnstileService.verifyToken({
          secretKey: turnstileSecretKey,
          token: turnstileToken,
          remoteIp: extractClientIp(req),
        });
        if (!turnstileResult.success) {
          return sendSubmitError(
            req,
            res,
            403,
            "turnstile_verification_failed",
            "Please retry the security check and submit again.",
          );
        }

        if (
          turnstileResult.hostname &&
          !isHostAllowed(turnstileResult.hostname, effectiveSourceHosts)
        ) {
          return sendSubmitError(
            req,
            res,
            403,
            "turnstile_verification_failed",
            "Security check hostname mismatch.",
          );
        }
      }

      const recipientEmails = config.recipientEmails;
      if (recipientEmails.length === 0) {
        return sendSubmitError(
          req,
          res,
          503,
          "plugin_not_configured",
          "Contact form recipient email is not configured",
        );
      }

      const recipientDeliveryFilter =
        await emailDeliverabilityService.filterSuppressedRecipients({
          recipientEmails,
        });
      if (recipientDeliveryFilter.deliverableRecipients.length === 0) {
        console.warn("[PublicPlugins] Contact submission blocked (all recipients suppressed)", {
          organizationId: pluginInstance.organizationId,
          projectSlug: pluginInstance.projectSlug,
          suppressedRecipientCount: recipientDeliveryFilter.suppressedRecipients.length,
        });
        return sendSubmitError(
          req,
          res,
          503,
          "plugin_not_configured",
          "Contact form recipient email is temporarily unavailable",
        );
      }

      const ignoredPayloadKeys = new Set([
        "token",
        honeypotField,
        "cf-turnstile-response",
        "_redirect",
        "_subject",
      ]);

      const payload = Object.fromEntries(
        Object.entries(fields).filter(
          ([key]) => !ignoredPayloadKeys.has(key),
        ),
      );
      const clientIp = extractClientIp(req);
      const clientIpHash = hashClientIp(clientIp);

      const unknownFields = collectUnknownFields(
        fields,
        new Set([...ignoredPayloadKeys, ...config.formFields.map((field) => field.key)]),
      );

      const abuseConfig = getContactFormAbuseConfig();
      const payloadValues = Object.values(payload);
      const totalFieldChars = payloadValues.reduce((sum, value) => sum + value.length, 0);
      if (
        abuseConfig.maxTotalFieldChars > 0 &&
        totalFieldChars > abuseConfig.maxTotalFieldChars
      ) {
        return sendSubmitError(
          req,
          res,
          400,
          "invalid_payload",
          "Submitted content is too large",
        );
      }

      if (
        abuseConfig.maxSingleFieldChars > 0 &&
        payloadValues.some((value) => value.length > abuseConfig.maxSingleFieldChars)
      ) {
        return sendSubmitError(
          req,
          res,
          400,
          "invalid_payload",
          "One or more submitted fields are too long",
        );
      }

      if (abuseConfig.maxLinksPerSubmission > 0) {
        const totalLinks = payloadValues.reduce(
          (sum, value) => sum + countLinksInText(value),
          0,
        );
        if (totalLinks > abuseConfig.maxLinksPerSubmission) {
          return sendSubmitError(
            req,
            res,
            400,
            "suspected_spam",
            "Submission appears to contain too many links",
          );
        }
      }

      const now = new Date();
      const tokenRateMinuteStart = new Date(now.getTime() - 60_000);
      const tokenRateHourStart = new Date(now.getTime() - 60 * 60_000);

      if (
        abuseConfig.rateLimitPerTokenPerMinute > 0 ||
        abuseConfig.rateLimitPerTokenPerHour > 0
      ) {
        const tokenRateRows = await db
          .select({
            minuteCount: sql<number>`count(*) filter (where ${contactFormSubmission.createdAt} >= ${tokenRateMinuteStart})`,
            hourCount: sql<number>`count(*)`,
          })
          .from(contactFormSubmission)
          .where(
            and(
              eq(contactFormSubmission.pluginInstanceId, pluginInstance.id),
              gte(contactFormSubmission.createdAt, tokenRateHourStart),
            ),
          );

        const tokenRateMinuteCount = Number(tokenRateRows[0]?.minuteCount ?? 0);
        const tokenRateHourCount = Number(tokenRateRows[0]?.hourCount ?? 0);
        if (
          abuseConfig.rateLimitPerTokenPerMinute > 0 &&
          tokenRateMinuteCount >= abuseConfig.rateLimitPerTokenPerMinute
        ) {
          return sendSubmitError(
            req,
            res,
            429,
            "rate_limited",
            "Too many submissions. Please try again in a moment.",
          );
        }
        if (
          abuseConfig.rateLimitPerTokenPerHour > 0 &&
          tokenRateHourCount >= abuseConfig.rateLimitPerTokenPerHour
        ) {
          return sendSubmitError(
            req,
            res,
            429,
            "rate_limited",
            "Submission limit reached for this hour. Please try again later.",
          );
        }
      }

      if (clientIpHash) {
        if (
          abuseConfig.rateLimitPerIpPerMinute > 0 ||
          abuseConfig.rateLimitPerIpPerHour > 0
        ) {
          const ipRateMinuteStart = new Date(now.getTime() - 60_000);
          const ipRateHourStart = new Date(now.getTime() - 60 * 60_000);
          const ipRateRows = await db
            .select({
              minuteCount: sql<number>`count(*) filter (where ${contactFormSubmission.createdAt} >= ${ipRateMinuteStart})`,
              hourCount: sql<number>`count(*)`,
            })
            .from(contactFormSubmission)
            .where(
              and(
                eq(contactFormSubmission.pluginInstanceId, pluginInstance.id),
                eq(contactFormSubmission.ipHash, clientIpHash),
                gte(contactFormSubmission.createdAt, ipRateHourStart),
              ),
            );

          const ipRateMinuteCount = Number(ipRateRows[0]?.minuteCount ?? 0);
          const ipRateHourCount = Number(ipRateRows[0]?.hourCount ?? 0);
          if (
            abuseConfig.rateLimitPerIpPerMinute > 0 &&
            ipRateMinuteCount >= abuseConfig.rateLimitPerIpPerMinute
          ) {
            return sendSubmitError(
              req,
              res,
              429,
              "rate_limited",
              "Too many submissions. Please try again in a moment.",
            );
          }
          if (
            abuseConfig.rateLimitPerIpPerHour > 0 &&
            ipRateHourCount >= abuseConfig.rateLimitPerIpPerHour
          ) {
            return sendSubmitError(
              req,
              res,
              429,
              "rate_limited",
              "Submission limit reached for this hour. Please try again later.",
            );
          }
        }

        const ipQueryWindowMs = Math.max(
          abuseConfig.minRepeatSeconds * 1_000,
          abuseConfig.duplicateWindowSeconds * 1_000,
        );
        const ipWindowStart = new Date(now.getTime() - ipQueryWindowMs);
        const recentByIp = await db
          .select({
            createdAt: contactFormSubmission.createdAt,
            payload: contactFormSubmission.payload,
          })
          .from(contactFormSubmission)
          .where(
            and(
              eq(contactFormSubmission.pluginInstanceId, pluginInstance.id),
              eq(contactFormSubmission.ipHash, clientIpHash),
              gte(contactFormSubmission.createdAt, ipWindowStart),
            ),
          )
          .orderBy(desc(contactFormSubmission.createdAt))
          .limit(64);

        if (abuseConfig.minRepeatSeconds > 0 && recentByIp.length > 0) {
          const latestByIp = recentByIp[0];
          const minRepeatMs = abuseConfig.minRepeatSeconds * 1_000;
          if (latestByIp && isWithinWindow(latestByIp.createdAt, now, minRepeatMs)) {
            return sendSubmitError(
              req,
              res,
              429,
              "submission_too_fast",
              "Please wait a few seconds before sending another message.",
            );
          }
        }

        if (abuseConfig.duplicateWindowSeconds > 0) {
          const duplicateWindowMs = abuseConfig.duplicateWindowSeconds * 1_000;
          const incomingPayloadSignature = serializeSubmissionPayload(payload);
          const duplicateFound = recentByIp.some((row) => {
            if (!isWithinWindow(row.createdAt, now, duplicateWindowMs)) return false;
            const existingPayloadSignature = serializeSubmissionPayload(
              normalizeSubmissionPayload(row.payload),
            );
            return existingPayloadSignature === incomingPayloadSignature;
          });

          if (duplicateFound) {
            // Treat short-window duplicate submits as successful no-ops to avoid accidental double-posts.
            return sendSubmitSuccess(req, res, successRedirectTarget);
          }
        }
      }

      if (
        entitlement.hardStop &&
        typeof entitlement.monthlyEventLimit === "number" &&
        entitlement.monthlyEventLimit >= 0
      ) {
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);

        const currentMonthRows = await db
          .select({
            count: sql<number>`count(*)`,
          })
          .from(contactFormSubmission)
          .where(
            and(
              eq(contactFormSubmission.organizationId, pluginInstance.organizationId),
              entitlement.scope === "organization" || entitlement.scope === "instance"
                ? undefined
                : eq(contactFormSubmission.projectSlug, pluginInstance.projectSlug),
              gte(contactFormSubmission.createdAt, monthStart),
            ),
          );
        const currentMonthCount = Number(currentMonthRows[0]?.count ?? 0);
        if (currentMonthCount >= entitlement.monthlyEventLimit) {
          return sendSubmitError(
            req,
            res,
            429,
            "plugin_quota_exceeded",
            "monthly contact form submission limit reached",
          );
        }
      }

      const submittedAt = new Date();

      await db.insert(contactFormSubmission).values({
        id: randomUUID(),
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
        pluginInstanceId: pluginInstance.id,
        sourceHost,
        ipHash: clientIpHash,
        userAgent: (req.get("user-agent") || "").slice(0, 1024) || null,
        payload,
        createdAt: submittedAt,
      });

      const nonEmptySubmittedFields = collectNonEmptyFields(submittedFields);
      const replyToField = nonEmptySubmittedFields.find(
        (field) => field.type === "email" && field.value.length > 0,
      );
      const replyToEmail = replyToField?.value?.trim() || null;
      const submittedAtLabel = formatSubmittedAtForEmail(submittedAt);
      const submissionEmail = await buildContactSubmissionEmail({
        projectSlug: pluginInstance.projectSlug,
        submittedAtLabel,
        replyToEmail,
        submittedFields: nonEmptySubmittedFields.map((field) => ({
          label: field.label,
          value: field.value,
        })),
        unknownFields,
      });

      const emailService = getEmailDeliveryService();
      const emailResult = await emailService.send({
        to: recipientDeliveryFilter.deliverableRecipients,
        subject: sanitizeSubject(fields._subject || "", pluginInstance.projectSlug),
        text: submissionEmail.text,
        html: submissionEmail.html,
        replyTo: replyToEmail || undefined,
        metadata: {
          plugin: "contact_form",
          project: pluginInstance.projectSlug,
          organization: pluginInstance.organizationId,
        },
      });

      if (!emailResult.accepted) {
        console.error("[PublicPlugins] Contact submission email delivery failed", {
          provider: emailResult.provider,
          error: emailResult.error,
          organizationId: pluginInstance.organizationId,
          projectSlug: pluginInstance.projectSlug,
          sourceHost,
        });
        return sendSubmitError(req, res, 502, "delivery_failed", "message delivery failed");
      }

      return sendSubmitSuccess(req, res, successRedirectTarget);
    },
  );

  return router;
}
