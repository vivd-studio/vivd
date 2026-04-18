import type {
  EmailTemplate,
  EmailTemplateBranding,
  EmailTemplateBrandingResolver,
} from "@vivd/plugin-sdk/emailTemplates";
import {
  BRAND_COLORS,
  buildLegalTextFooter,
  escapeHtml,
  formatDurationLabel,
  formatRichText,
  joinNonEmptyTextBlocks,
  renderHtmlLayout,
  resolveEmailTemplateBranding,
  sanitizeTextLine,
} from "@vivd/plugin-sdk/emailTemplates";

type ContactSubmissionEmailField = {
  label: string;
  value: string;
};

type ContactSubmissionEmailInput = {
  projectSlug: string;
  submittedAtLabel: string;
  replyToEmail: string | null;
  submittedFields: ContactSubmissionEmailField[];
  unknownFields: Record<string, string>;
};

function formatFieldsText(fields: ContactSubmissionEmailField[]): string {
  return fields
    .map((field) => `${sanitizeTextLine(field.label)}: ${field.value}`)
    .join("\n");
}

function formatUnknownFieldsText(fields: Record<string, string>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => `${sanitizeTextLine(key)}: ${value}`)
    .join("\n");
}

function formatFieldsHtml(
  fields: ContactSubmissionEmailField[],
  options: {
    labelColor: string;
    valueColor: string;
    rowPadding: string;
  },
): string {
  return fields
    .map(
      (field) =>
        `<tr><td style="padding:${options.rowPadding};vertical-align:top;font-weight:600;color:${options.labelColor};width:190px;">${escapeHtml(
          sanitizeTextLine(field.label),
        )}</td><td style="padding:${options.rowPadding};vertical-align:top;color:${options.valueColor};">${formatRichText(
          field.value,
        )}</td></tr>`,
    )
    .join("");
}

function formatUnknownFieldsHtml(fields: Record<string, string>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return "";

  return entries
    .map(
      ([key, value]) =>
        `<tr><td style="padding:8px 0;vertical-align:top;font-weight:600;color:${BRAND_COLORS.text};width:190px;">${escapeHtml(
          sanitizeTextLine(key),
        )}</td><td style="padding:8px 0;vertical-align:top;color:${BRAND_COLORS.muted};">${formatRichText(
          value,
        )}</td></tr>`,
    )
    .join("");
}

export async function buildContactSubmissionEmail(
  input: ContactSubmissionEmailInput,
  brandingResolver: EmailTemplateBrandingResolver,
  brandingOverride?: EmailTemplateBranding,
): Promise<Pick<EmailTemplate, "text" | "html">> {
  const branding = await resolveEmailTemplateBranding(
    brandingResolver,
    brandingOverride,
  );
  const unknownFieldsText = formatUnknownFieldsText(input.unknownFields);
  const unknownFieldsHtml = formatUnknownFieldsHtml(input.unknownFields);
  const textBody = joinNonEmptyTextBlocks([
    "You received a new message from your website contact form.",
    `Project: ${input.projectSlug}\nReceived: ${input.submittedAtLabel}\nReply email from form: ${
      input.replyToEmail || "(not provided)"
    }`,
    `Submitted details:\n${
      formatFieldsText(input.submittedFields) || "(No fields submitted)"
    }`,
    unknownFieldsText ? `Additional details:\n${unknownFieldsText}` : "",
    "Use the reply email from the form details above when responding.",
    buildLegalTextFooter(branding),
  ]);

  const htmlBody = renderHtmlLayout({
    branding,
    preheader: `New contact form submission for ${input.projectSlug}`,
    title: "New message from your website",
    intro: "You received a new contact form submission.",
    bodyHtml: [
      `<div style="margin-bottom:20px;padding:14px 16px;background:#F8FAFC;border:1px solid ${BRAND_COLORS.border};border-left:4px solid ${BRAND_COLORS.accent};border-radius:12px;font-size:14px;color:#334155;line-height:1.7;">`,
      `<div><strong style="color:${BRAND_COLORS.text};">Project:</strong> ${escapeHtml(
        input.projectSlug,
      )}</div>`,
      `<div><strong style="color:${BRAND_COLORS.text};">Received:</strong> ${escapeHtml(
        input.submittedAtLabel,
      )}</div>`,
      `<div><strong style="color:${BRAND_COLORS.text};">Reply email from form:</strong> ${escapeHtml(
        input.replyToEmail || "Not provided",
      )}</div>`,
      `</div>`,
      `<h3 style="margin:0 0 8px;font-size:16px;color:${BRAND_COLORS.text};">Submitted details</h3>`,
      `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">${formatFieldsHtml(
        input.submittedFields,
        {
          labelColor: BRAND_COLORS.text,
          valueColor: BRAND_COLORS.muted,
          rowPadding: "10px 0",
        },
      )}</table>`,
      unknownFieldsHtml
        ? `<h3 style="margin:20px 0 8px;font-size:15px;color:${BRAND_COLORS.text};">Additional details</h3><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">${unknownFieldsHtml}</table>`
        : "",
    ].join(""),
    outroHtml:
      `<p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:${BRAND_COLORS.muted};">Use the reply email from the form details above when responding.</p>`,
  });

  return {
    text: textBody,
    html: htmlBody,
  };
}

export async function buildContactRecipientVerificationEmail(
  input: {
    projectSlug: string;
    verificationUrl: string;
    expiresInSeconds: number;
  },
  brandingResolver: EmailTemplateBrandingResolver,
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveEmailTemplateBranding(
    brandingResolver,
    brandingOverride,
  );
  const projectSlug = sanitizeTextLine(input.projectSlug) || "your project";
  const expiresLabel = formatDurationLabel(input.expiresInSeconds);
  const subject = `Verify contact recipient for ${projectSlug}`;
  const text = joinNonEmptyTextBlocks([
    "Please verify this email address to receive contact form notifications.",
    `Project: ${projectSlug}`,
    `Verify recipient email: ${input.verificationUrl}`,
    `For your security, this link expires in ${expiresLabel}.`,
    "If you did not request this, you can ignore this email.",
    buildLegalTextFooter(branding),
  ]);
  const html = renderHtmlLayout({
    branding,
    preheader: `Verify contact recipient for ${projectSlug}`,
    title: "Verify recipient email",
    intro: "Please confirm this email address for contact form notifications.",
    bodyHtml: joinNonEmptyTextBlocks([
      `<p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:${BRAND_COLORS.muted};"><strong style="color:${BRAND_COLORS.text};">Project:</strong> ${escapeHtml(
        projectSlug,
      )}</p>`,
      `<p style="margin:0;font-size:14px;line-height:1.7;color:${BRAND_COLORS.muted};">For your security, this link expires in <strong style="color:${BRAND_COLORS.text};">${escapeHtml(
        expiresLabel,
      )}</strong>.</p>`,
    ]),
    actionLabel: "Verify recipient email",
    actionUrl: input.verificationUrl,
    outroHtml:
      `<p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:${BRAND_COLORS.muted};">If you did not request this, you can ignore this email.</p>`,
  });

  return {
    subject,
    text,
    html,
  };
}
