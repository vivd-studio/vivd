import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Multer } from "multer";
import { z } from "zod";
import { db } from "../../../db";
import { contactFormSubmission, projectPluginInstance } from "../../../db/schema";
import { contactFormPluginConfigSchema } from "../../../services/plugins/contactForm/config";
import { getEmailDeliveryService } from "../../../services/integrations/EmailDeliveryService";
import {
  extractSourceHostFromHeaders,
  isHostAllowed,
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
  const fallback = `New contact form submission — ${projectSlug}`;
  const candidate = rawSubject
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 160);
  return candidate || fallback;
}

function buildAdditionalFields(
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

function formatAdditionalTextLines(
  additionalFields: Record<string, string>,
): string {
  const entries = Object.entries(additionalFields);
  if (entries.length === 0) return "";

  const lines = entries.map(([key, value]) => `${key}: ${value}`);
  return `\nAdditional fields:\n${lines.join("\n")}`;
}

function formatAdditionalHtml(
  additionalFields: Record<string, string>,
): string {
  const entries = Object.entries(additionalFields);
  if (entries.length === 0) return "";

  return `<p><strong>Additional fields</strong></p><ul>${entries
    .map(
      ([key, value]) =>
        `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`,
    )
    .join("")}</ul>`;
}

function buildSubmissionTextEmail(input: {
  projectSlug: string;
  sourceHost: string | null;
  name: string;
  email: string;
  message: string;
  additionalFields: Record<string, string>;
}): string {
  return [
    "New contact form submission",
    `Project: ${input.projectSlug}`,
    `Source host: ${input.sourceHost || "unknown"}`,
    `Submitted at: ${new Date().toISOString()}`,
    "",
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    "",
    "Message:",
    input.message,
    formatAdditionalTextLines(input.additionalFields),
  ]
    .join("\n")
    .trim();
}

function buildSubmissionHtmlEmail(input: {
  projectSlug: string;
  sourceHost: string | null;
  name: string;
  email: string;
  message: string;
  additionalFields: Record<string, string>;
}): string {
  return [
    "<h2>New contact form submission</h2>",
    `<p><strong>Project:</strong> ${escapeHtml(input.projectSlug)}</p>`,
    `<p><strong>Source host:</strong> ${escapeHtml(input.sourceHost || "unknown")}</p>`,
    `<p><strong>Submitted at:</strong> ${escapeHtml(new Date().toISOString())}</p>`,
    "<hr />",
    `<p><strong>Name:</strong> ${escapeHtml(input.name)}</p>`,
    `<p><strong>Email:</strong> ${escapeHtml(input.email)}</p>`,
    "<p><strong>Message:</strong></p>",
    `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(input.message)}</pre>`,
    formatAdditionalHtml(input.additionalFields),
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

      if (!isHostAllowed(sourceHost, config.sourceHosts)) {
        return sendSubmitError(req, res, 403, "forbidden_source", "source host not allowed");
      }

      const honeypotField = "_honeypot";
      if ((fields[honeypotField] || "").length > 0) {
        return sendSubmitSuccess(req, res, null);
      }

      const name = fields.name || "";
      const email = fields.email || "";
      const message = fields.message || "";
      if (!name || !email || !message) {
        return sendSubmitError(
          req,
          res,
          400,
          "invalid_payload",
          "name, email, and message are required",
        );
      }

      if (!emailFieldSchema.safeParse(email).success) {
        return sendSubmitError(req, res, 400, "invalid_payload", "email is invalid");
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

      const ignoredPayloadKeys = new Set(["token", honeypotField]);

      const payload = Object.fromEntries(
        Object.entries(fields).filter(
          ([key]) => !ignoredPayloadKeys.has(key),
        ),
      );

      const additionalFields = buildAdditionalFields(
        fields,
        new Set([
          "token",
          honeypotField,
          "name",
          "email",
          "message",
          "_redirect",
          "_subject",
        ]),
      );

      await db.insert(contactFormSubmission).values({
        id: randomUUID(),
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
        pluginInstanceId: pluginInstance.id,
        sourceHost,
        ipHash: hashClientIp(req),
        userAgent: (req.get("user-agent") || "").slice(0, 1024) || null,
        payload,
        createdAt: new Date(),
      });

      const emailService = getEmailDeliveryService();
      const emailResult = await emailService.send({
        to: recipientEmails,
        subject: sanitizeSubject(fields._subject || "", pluginInstance.projectSlug),
        text: buildSubmissionTextEmail({
          projectSlug: pluginInstance.projectSlug,
          sourceHost,
          name,
          email,
          message,
          additionalFields,
        }),
        html: buildSubmissionHtmlEmail({
          projectSlug: pluginInstance.projectSlug,
          sourceHost,
          name,
          email,
          message,
          additionalFields,
        }),
        replyTo: email,
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

      const redirectAllowlist =
        config.redirectHostAllowlist.length > 0
          ? config.redirectHostAllowlist
          : config.sourceHosts;

      const redirectTarget = resolveRedirectTarget(fields._redirect, redirectAllowlist);
      return sendSubmitSuccess(req, res, redirectTarget);
    },
  );

  return router;
}
