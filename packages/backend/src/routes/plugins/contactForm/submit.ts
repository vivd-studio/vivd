import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Multer } from "multer";
import { z } from "zod";
import { db } from "../../../db";
import { contactFormSubmission, projectPluginInstance } from "../../../db/schema";
import { contactFormPluginConfigSchema } from "../../../services/plugins/contactForm/config";
import { inferContactFormAutoSourceHosts } from "../../../services/plugins/contactForm/sourceHosts";
import { getEmailDeliveryService } from "../../../services/integrations/EmailDeliveryService";
import {
  extractSourceHostFromHeaders,
  isHostAllowed,
  resolveEffectiveRedirectHosts,
  resolveEffectiveSourceHosts,
  resolveRedirectTarget,
} from "./helpers";

export type ContactFormPublicRouterDeps = {
  upload: Pick<Multer, "none">;
};

const emailFieldSchema = z.string().email();

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

function hashClientIp(req: express.Request): string | null {
  const forwarded = req.get("x-forwarded-for");
  const forwardedIp = forwarded?.split(",")[0]?.trim();
  const candidateIp = forwardedIp || req.ip;
  if (!candidateIp) return null;
  return createHash("sha256").update(candidateIp).digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

const VIVD_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 100 100" role="img" aria-label="Vivd logo">
  <defs>
    <linearGradient id="vivdMailGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#10B981" />
      <stop offset="100%" stop-color="#F59E0B" />
    </linearGradient>
  </defs>
  <path d="M25 30 L50 75 L75 30" stroke="url(#vivdMailGradient)" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

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

function formatFieldRowsText(fields: SubmittedContactField[]): string {
  return fields
    .map((field) => `${field.label}: ${field.value}`)
    .join("\n");
}

function formatUnknownFieldsText(fields: Record<string, string>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}: ${value}`).join("\n");
}

function formatFieldRowsHtml(fields: SubmittedContactField[]): string {
  return fields
    .map(
      (field) =>
        `<tr><td style="padding:10px 0;vertical-align:top;font-weight:600;color:#111827;width:180px;">${escapeHtml(
          field.label,
        )}</td><td style="padding:10px 0;vertical-align:top;color:#374151;">${escapeHtml(
          field.value,
        )
          .replace(/\n/g, "<br/>")
          .trim()}</td></tr>`,
    )
    .join("");
}

function formatUnknownFieldsHtml(fields: Record<string, string>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return "";
  return entries
    .map(
      ([key, value]) =>
        `<tr><td style="padding:8px 0;vertical-align:top;font-weight:600;color:#374151;width:180px;">${escapeHtml(
          key,
        )}</td><td style="padding:8px 0;vertical-align:top;color:#4B5563;">${escapeHtml(
          value,
        )
          .replace(/\n/g, "<br/>")
          .trim()}</td></tr>`,
    )
    .join("");
}

function buildSubmissionTextEmail(input: {
  projectSlug: string;
  submittedAtLabel: string;
  replyToEmail: string | null;
  submittedFields: SubmittedContactField[];
  unknownFields: Record<string, string>;
}): string {
  const unknownFieldsText = formatUnknownFieldsText(input.unknownFields);
  return [
    "You received a new message from your website contact form.",
    "",
    `Project: ${input.projectSlug}`,
    `Received: ${input.submittedAtLabel}`,
    `Reply email from form: ${input.replyToEmail || "(not provided)"}`,
    "",
    "Submitted details:",
    formatFieldRowsText(input.submittedFields) || "(No fields submitted)",
    unknownFieldsText ? `\nAdditional details:\n${unknownFieldsText}` : "",
  ]
    .join("\n")
    .trim();
}

function buildSubmissionHtmlEmail(input: {
  projectSlug: string;
  submittedAtLabel: string;
  replyToEmail: string | null;
  submittedFields: SubmittedContactField[];
  unknownFields: Record<string, string>;
}): string {
  const unknownFieldsHtml = formatUnknownFieldsHtml(input.unknownFields);
  return [
    `<div style="margin:0;background:#F3F4F6;padding:24px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">`,
    `<div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;">`,
    `<div style="padding:20px 24px;border-bottom:1px solid #E5E7EB;background:#F9FAFB;">`,
    `<div style="display:flex;align-items:center;gap:10px;">${VIVD_LOGO_SVG}<span style="font-size:22px;font-weight:700;letter-spacing:0.01em;color:#0F172A;">vivd</span></div>`,
    `</div>`,
    `<div style="padding:24px;">`,
    `<h2 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111827;">New message from your website</h2>`,
    `<p style="margin:0 0 18px;color:#4B5563;font-size:14px;line-height:1.6;">You received a new contact form submission.</p>`,
    `<div style="margin-bottom:20px;padding:14px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;color:#374151;line-height:1.6;">`,
    `<div><strong style="color:#111827;">Project:</strong> ${escapeHtml(input.projectSlug)}</div>`,
    `<div><strong style="color:#111827;">Received:</strong> ${escapeHtml(input.submittedAtLabel)}</div>`,
    `<div><strong style="color:#111827;">Reply email from form:</strong> ${escapeHtml(input.replyToEmail || "Not provided")}</div>`,
    `</div>`,
    `<h3 style="margin:0 0 8px;font-size:16px;color:#111827;">Submitted details</h3>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">${formatFieldRowsHtml(
      input.submittedFields,
    )}</table>`,
    unknownFieldsHtml
      ? `<h3 style="margin:20px 0 8px;font-size:15px;color:#111827;">Additional details</h3><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">${unknownFieldsHtml}</table>`
      : "",
    `<p style="margin:24px 0 0;color:#6B7280;font-size:13px;line-height:1.6;">Use the reply email from the form details above when responding.</p>`,
    `</div>`,
    `</div>`,
    `</div>`,
  ].join("");
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

      if (!isHostAllowed(sourceHost, effectiveSourceHosts)) {
        return sendSubmitError(req, res, 403, "forbidden_source", "source host not allowed");
      }

      const honeypotField = "_honeypot";
      if ((fields[honeypotField] || "").length > 0) {
        return sendSubmitSuccess(req, res, null);
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

      const ignoredPayloadKeys = new Set([
        "token",
        honeypotField,
        "_redirect",
        "_subject",
      ]);

      const payload = Object.fromEntries(
        Object.entries(fields).filter(
          ([key]) => !ignoredPayloadKeys.has(key),
        ),
      );

      const unknownFields = collectUnknownFields(
        fields,
        new Set([...ignoredPayloadKeys, ...config.formFields.map((field) => field.key)]),
      );

      const submittedAt = new Date();

      await db.insert(contactFormSubmission).values({
        id: randomUUID(),
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
        pluginInstanceId: pluginInstance.id,
        sourceHost,
        ipHash: hashClientIp(req),
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

      const emailService = getEmailDeliveryService();
      const emailResult = await emailService.send({
        to: recipientEmails,
        subject: sanitizeSubject(fields._subject || "", pluginInstance.projectSlug),
        text: buildSubmissionTextEmail({
          projectSlug: pluginInstance.projectSlug,
          submittedAtLabel,
          replyToEmail,
          submittedFields: nonEmptySubmittedFields,
          unknownFields,
        }),
        html: buildSubmissionHtmlEmail({
          projectSlug: pluginInstance.projectSlug,
          submittedAtLabel,
          replyToEmail,
          submittedFields: nonEmptySubmittedFields,
          unknownFields,
        }),
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

      const redirectAllowlist = resolveEffectiveRedirectHosts(
        config.redirectHostAllowlist,
        effectiveSourceHosts,
      );
      const redirectTarget = resolveRedirectTarget(fields._redirect, redirectAllowlist);
      return sendSubmitSuccess(req, res, redirectTarget);
    },
  );

  return router;
}
