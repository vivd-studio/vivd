type HtmlLayoutInput = {
  preheader: string;
  title: string;
  intro: string;
  bodyHtml: string;
  actionLabel?: string;
  actionUrl?: string;
  outroHtml?: string;
};

export type ContactSubmissionEmailField = {
  label: string;
  value: string;
};

export type ContactSubmissionEmailInput = {
  projectSlug: string;
  submittedAtLabel: string;
  replyToEmail: string | null;
  submittedFields: ContactSubmissionEmailField[];
  unknownFields: Record<string, string>;
};

export type EmailTemplate = {
  subject: string;
  text: string;
  html: string;
};

const DEFAULT_FALLBACK_GREETING = "there";

const legalInfo = {
  displayName: "vivd.studio",
  owner: "Felix Pahlke",
  street: "Dweerblöcken 4",
  city: "22393 Hamburg",
  email: "hello@vivd.studio",
  website: "https://vivd.studio",
  impressumUrl: "https://vivd.studio/impressum",
  privacyUrl: "https://vivd.studio/datenschutz",
  termsUrl: "https://vivd.studio/agb",
};

const VIVD_LOGO_URL = `${legalInfo.website}/images/vivd_logo_transparent.png`;
const VIVD_LOGO_ALT = "vivd.studio logo";

const BRAND_COLORS = {
  text: "#0F172A",
  muted: "#64748B",
  bodyBackground: "#F8FAFC",
  surface: "#FFFFFF",
  border: "#E2E8F0",
  cta: "#000000",
  link: "#0F172A",
  accent: "#22C55E",
  footerText: "#475569",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeTextLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

function formatRichText(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br/>").trim();
}

function toGreetingName(rawName: string | null | undefined): string {
  const candidate = sanitizeTextLine(rawName || "");
  return candidate || DEFAULT_FALLBACK_GREETING;
}

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

function renderHtmlLayout(input: HtmlLayoutInput): string {
  const actionHtml =
    input.actionLabel && input.actionUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr><td style="border-radius:999px;background:${BRAND_COLORS.cta};"><a href="${escapeHtml(
          input.actionUrl,
        )}" style="display:inline-block;padding:13px 24px;font-size:14px;font-weight:600;line-height:1.2;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">${escapeHtml(
          input.actionLabel,
        )}</a></td></tr></table>`
      : "";

  return [
    `<div style="margin:0;padding:0;background:${BRAND_COLORS.bodyBackground};background-image:radial-gradient(circle at top right, rgba(34,197,94,0.16), rgba(248,250,252,0) 48%);">`,
    `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(
      input.preheader,
    )}</span>`,
    `<div style="max-width:680px;margin:0 auto;padding:28px 16px 22px;">`,
    `<div style="border:1px solid ${BRAND_COLORS.border};border-radius:18px;overflow:hidden;background:${BRAND_COLORS.surface};box-shadow:0 14px 36px rgba(15,23,42,0.08);">`,
    `<div style="padding:22px 24px 18px;border-bottom:1px solid ${BRAND_COLORS.border};background:linear-gradient(120deg,#FFFFFF 0%,#F0FDF4 100%);">`,
    `<a href="${escapeHtml(legalInfo.website)}" style="display:inline-block;text-decoration:none;">`,
    `<img src="${escapeHtml(VIVD_LOGO_URL)}" alt="${escapeHtml(
      VIVD_LOGO_ALT,
    )}" width="220" style="display:block;width:220px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />`,
    `</a>`,
    `</div>`,
    `<div style="padding:28px 24px 30px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${BRAND_COLORS.text};">`,
    `<h2 style="margin:0 0 12px;font-size:30px;line-height:1.16;font-weight:700;letter-spacing:-0.02em;color:${BRAND_COLORS.text};">${escapeHtml(
      input.title,
    )}</h2>`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:${BRAND_COLORS.muted};">${escapeHtml(
      input.intro,
    )}</p>`,
    input.bodyHtml,
    actionHtml,
    input.outroHtml || "",
    `</div>`,
    `</div>`,
    `<div style="max-width:680px;margin:16px auto 0;padding:0 8px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">`,
    `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${BRAND_COLORS.footerText};">${legalInfo.displayName} · ${legalInfo.owner} · ${legalInfo.street} · ${legalInfo.city}</p>`,
    `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${BRAND_COLORS.footerText};">E-Mail: <a href="mailto:${escapeHtml(
      legalInfo.email,
    )}" style="color:${BRAND_COLORS.link};text-decoration:none;">${escapeHtml(
      legalInfo.email,
    )}</a> · Website: <a href="${escapeHtml(
      legalInfo.website,
    )}" style="color:${BRAND_COLORS.link};text-decoration:none;">${escapeHtml(
      legalInfo.website,
    )}</a></p>`,
    `<p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND_COLORS.footerText};">`,
    `<a href="${escapeHtml(legalInfo.impressumUrl)}" style="color:${BRAND_COLORS.link};text-decoration:none;">Impressum</a> · `,
    `<a href="${escapeHtml(legalInfo.privacyUrl)}" style="color:${BRAND_COLORS.link};text-decoration:none;">Datenschutz</a> · `,
    `<a href="${escapeHtml(legalInfo.termsUrl)}" style="color:${BRAND_COLORS.link};text-decoration:none;">AGB</a>`,
    `</p>`,
    `</div>`,
    `</div>`,
    `</div>`,
  ].join("");
}

function buildLegalTextFooter(): string {
  return [
    "---",
    `${legalInfo.displayName} · ${legalInfo.owner}`,
    `${legalInfo.street}, ${legalInfo.city}`,
    `E-Mail: ${legalInfo.email}`,
    `Website: ${legalInfo.website}`,
    `Impressum: ${legalInfo.impressumUrl}`,
    `Datenschutz: ${legalInfo.privacyUrl}`,
    `AGB: ${legalInfo.termsUrl}`,
  ].join("\n");
}

function joinNonEmptyTextBlocks(blocks: string[]): string {
  return blocks
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .join("\n\n")
    .trim();
}

export function formatDurationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "shortly";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 3_600) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (seconds < 86_400) {
    const hours = Math.max(1, Math.round(seconds / 3_600));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.max(1, Math.round(seconds / 86_400));
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function buildContactSubmissionEmail(
  input: ContactSubmissionEmailInput,
): Pick<EmailTemplate, "text" | "html"> {
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
    buildLegalTextFooter(),
  ]);

  const htmlBody = renderHtmlLayout({
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

export function buildVerificationEmail(input: {
  recipientName?: string | null;
  verificationUrl: string;
  expiresInSeconds: number;
}): EmailTemplate {
  const greetingName = toGreetingName(input.recipientName);
  const expiresLabel = formatDurationLabel(input.expiresInSeconds);
  const subject = "Verify your email address for vivd";
  const text = joinNonEmptyTextBlocks([
    `Hello ${greetingName},`,
    "Please confirm your email address to complete your vivd account setup.",
    `Verify email: ${input.verificationUrl}`,
    `For your security, this link expires in ${expiresLabel}.`,
    "If you did not create this account, you can safely ignore this email.",
    buildLegalTextFooter(),
  ]);
  const html = renderHtmlLayout({
    preheader: "Verify your email address for vivd",
    title: "Verify your email address",
    intro: `Hello ${greetingName}, please confirm your email address to complete your vivd account setup.`,
    bodyHtml: `<p style="margin:0;font-size:14px;line-height:1.7;color:${BRAND_COLORS.muted};">For your security, this link expires in <strong style="color:${BRAND_COLORS.text};">${escapeHtml(
      expiresLabel,
    )}</strong>.</p>`,
    actionLabel: "Verify email address",
    actionUrl: input.verificationUrl,
    outroHtml:
      `<p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:${BRAND_COLORS.muted};">If you did not create this account, you can safely ignore this email.</p>`,
  });

  return {
    subject,
    text,
    html,
  };
}

export function buildContactRecipientVerificationEmail(input: {
  projectSlug: string;
  verificationUrl: string;
  expiresInSeconds: number;
}): EmailTemplate {
  const projectSlug = sanitizeTextLine(input.projectSlug) || "your project";
  const expiresLabel = formatDurationLabel(input.expiresInSeconds);
  const subject = `Verify contact recipient for ${projectSlug}`;
  const text = joinNonEmptyTextBlocks([
    "Please verify this email address to receive contact form notifications.",
    `Project: ${projectSlug}`,
    `Verify recipient email: ${input.verificationUrl}`,
    `For your security, this link expires in ${expiresLabel}.`,
    "If you did not request this, you can ignore this email.",
    buildLegalTextFooter(),
  ]);
  const html = renderHtmlLayout({
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

export function buildPasswordResetEmail(input: {
  recipientName?: string | null;
  resetUrl: string;
  expiresInSeconds: number;
}): EmailTemplate {
  const greetingName = toGreetingName(input.recipientName);
  const expiresLabel = formatDurationLabel(input.expiresInSeconds);
  const subject = "Reset your vivd password";
  const text = joinNonEmptyTextBlocks([
    `Hello ${greetingName},`,
    "We received a request to reset your vivd password.",
    `Reset password: ${input.resetUrl}`,
    `For your security, this link expires in ${expiresLabel}.`,
    "If you did not request a password reset, you can ignore this email.",
    buildLegalTextFooter(),
  ]);
  const html = renderHtmlLayout({
    preheader: "Reset your vivd password",
    title: "Reset your password",
    intro: `Hello ${greetingName}, we received a request to reset your vivd password.`,
    bodyHtml: `<p style="margin:0;font-size:14px;line-height:1.7;color:${BRAND_COLORS.muted};">For your security, this link expires in <strong style="color:${BRAND_COLORS.text};">${escapeHtml(
      expiresLabel,
    )}</strong>.</p>`,
    actionLabel: "Set a new password",
    actionUrl: input.resetUrl,
    outroHtml:
      `<p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:${BRAND_COLORS.muted};">If you did not request a password reset, you can ignore this email.</p>`,
  });

  return {
    subject,
    text,
    html,
  };
}
