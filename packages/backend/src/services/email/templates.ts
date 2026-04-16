import {
  emailTemplateBrandingService,
  type EmailTemplateBranding,
} from "./templateBranding";

type HtmlLayoutInput = {
  branding: EmailTemplateBranding;
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

function uniqueNonEmptyParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const normalized = sanitizeTextLine(part || "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function resolveProductName(branding: EmailTemplateBranding): string {
  return sanitizeTextLine(branding.displayName || "") || "vivd";
}

function renderBrandHeader(branding: EmailTemplateBranding): string {
  if (branding.logoUrl) {
    const logoAlt = `${resolveProductName(branding)} logo`;
    const imageHtml = `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(
      logoAlt,
    )}" width="220" style="display:block;width:220px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />`;

    return branding.websiteUrl
      ? `<a href="${escapeHtml(branding.websiteUrl)}" style="display:inline-block;text-decoration:none;">${imageHtml}</a>`
      : imageHtml;
  }

  if (branding.displayName) {
    return `<div style="font-size:18px;line-height:1.2;font-weight:700;letter-spacing:-0.01em;color:${BRAND_COLORS.text};">${escapeHtml(
      branding.displayName,
    )}</div>`;
  }

  return "";
}

function renderFooterHtml(branding: EmailTemplateBranding): string {
  const lines: string[] = [];
  const identityParts = uniqueNonEmptyParts([
    branding.displayName,
    branding.legalName,
    branding.legalAddress,
  ]);

  if (identityParts.length > 0) {
    lines.push(
      `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${BRAND_COLORS.footerText};">${identityParts
        .map((part) => escapeHtml(part))
        .join(" · ")}</p>`,
    );
  }

  const contactParts: string[] = [];
  if (branding.supportEmail) {
    contactParts.push(
      `Email: <a href="mailto:${escapeHtml(
        branding.supportEmail,
      )}" style="color:${BRAND_COLORS.link};text-decoration:none;">${escapeHtml(
        branding.supportEmail,
      )}</a>`,
    );
  }
  if (branding.websiteUrl) {
    contactParts.push(
      `Website: <a href="${escapeHtml(
        branding.websiteUrl,
      )}" style="color:${BRAND_COLORS.link};text-decoration:none;">${escapeHtml(
        branding.websiteUrl,
      )}</a>`,
    );
  }
  if (contactParts.length > 0) {
    lines.push(
      `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${BRAND_COLORS.footerText};">${contactParts.join(
        " · ",
      )}</p>`,
    );
  }

  const legalLinks: string[] = [];
  if (branding.imprintUrl) {
    legalLinks.push(
      `<a href="${escapeHtml(
        branding.imprintUrl,
      )}" style="color:${BRAND_COLORS.link};text-decoration:none;">Legal notice</a>`,
    );
  }
  if (branding.privacyUrl) {
    legalLinks.push(
      `<a href="${escapeHtml(
        branding.privacyUrl,
      )}" style="color:${BRAND_COLORS.link};text-decoration:none;">Privacy</a>`,
    );
  }
  if (branding.termsUrl) {
    legalLinks.push(
      `<a href="${escapeHtml(
        branding.termsUrl,
      )}" style="color:${BRAND_COLORS.link};text-decoration:none;">Terms</a>`,
    );
  }
  if (legalLinks.length > 0) {
    lines.push(
      `<p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND_COLORS.footerText};">${legalLinks.join(
        " · ",
      )}</p>`,
    );
  }

  if (lines.length === 0) return "";

  return `<div style="max-width:680px;margin:16px auto 0;padding:0 8px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">${lines.join(
    "",
  )}</div>`;
}

function renderHtmlLayout(input: HtmlLayoutInput): string {
  const brandHeaderHtml = renderBrandHeader(input.branding);
  const footerHtml = renderFooterHtml(input.branding);
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
    brandHeaderHtml
      ? `<div style="padding:22px 24px 18px;border-bottom:1px solid ${BRAND_COLORS.border};background:linear-gradient(120deg,#FFFFFF 0%,#F0FDF4 100%);">${brandHeaderHtml}</div>`
      : "",
    `<div style="padding:${brandHeaderHtml ? "28px 24px 30px" : "30px 24px"};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${BRAND_COLORS.text};">`,
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
    footerHtml,
    `</div>`,
    `</div>`,
  ].join("");
}

function buildLegalTextFooter(branding: EmailTemplateBranding): string {
  const lines: string[] = [];
  const identityParts = uniqueNonEmptyParts([
    branding.displayName,
    branding.legalName,
    branding.legalAddress,
  ]);

  if (identityParts.length > 0) {
    lines.push(identityParts.join(" · "));
  }
  if (branding.supportEmail) {
    lines.push(`Email: ${branding.supportEmail}`);
  }
  if (branding.websiteUrl) {
    lines.push(`Website: ${branding.websiteUrl}`);
  }
  if (branding.imprintUrl) {
    lines.push(`Legal notice: ${branding.imprintUrl}`);
  }
  if (branding.privacyUrl) {
    lines.push(`Privacy: ${branding.privacyUrl}`);
  }
  if (branding.termsUrl) {
    lines.push(`Terms: ${branding.termsUrl}`);
  }

  if (lines.length === 0) return "";
  return ["---", ...lines].join("\n");
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

async function resolveBrandingOverride(
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplateBranding> {
  if (brandingOverride) return brandingOverride;
  return emailTemplateBrandingService.getResolvedBranding();
}

export async function buildContactSubmissionEmail(
  input: ContactSubmissionEmailInput,
  brandingOverride?: EmailTemplateBranding,
): Promise<Pick<EmailTemplate, "text" | "html">> {
  const branding = await resolveBrandingOverride(brandingOverride);
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

export async function buildVerificationEmail(
  input: {
    recipientName?: string | null;
    verificationUrl: string;
    expiresInSeconds: number;
  },
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveBrandingOverride(brandingOverride);
  const productName = resolveProductName(branding);
  const greetingName = toGreetingName(input.recipientName);
  const expiresLabel = formatDurationLabel(input.expiresInSeconds);
  const subject = `Verify your email address for ${productName}`;
  const text = joinNonEmptyTextBlocks([
    `Hello ${greetingName},`,
    `Please confirm your email address to complete your ${productName} account setup.`,
    `Verify email: ${input.verificationUrl}`,
    `For your security, this link expires in ${expiresLabel}.`,
    "If you did not create this account, you can safely ignore this email.",
    buildLegalTextFooter(branding),
  ]);
  const html = renderHtmlLayout({
    branding,
    preheader: `Verify your email address for ${productName}`,
    title: "Verify your email address",
    intro: `Hello ${greetingName}, please confirm your email address to complete your ${productName} account setup.`,
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

export async function buildNewsletterConfirmationEmail(
  input: {
    projectTitle: string;
    recipientName?: string | null;
    confirmUrl: string;
    unsubscribeUrl: string;
    expiresInSeconds: number;
    mode: "newsletter" | "waitlist";
  },
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveBrandingOverride(brandingOverride);
  const projectTitle = sanitizeTextLine(input.projectTitle) || "your project";
  const greetingName = toGreetingName(input.recipientName);
  const expiresLabel = formatDurationLabel(input.expiresInSeconds);
  const audienceLabel =
    input.mode === "waitlist" ? "waitlist signup" : "newsletter signup";
  const title =
    input.mode === "waitlist"
      ? "Confirm your waitlist signup"
      : "Confirm your newsletter signup";
  const actionLabel =
    input.mode === "waitlist"
      ? "Confirm waitlist signup"
      : "Confirm newsletter signup";
  const subject =
    input.mode === "waitlist"
      ? `Confirm your waitlist signup for ${projectTitle}`
      : `Confirm your newsletter signup for ${projectTitle}`;

  const text = joinNonEmptyTextBlocks([
    `Hello ${greetingName},`,
    `Please confirm your ${audienceLabel} for ${projectTitle}.`,
    `Confirm signup: ${input.confirmUrl}`,
    `This link expires in ${expiresLabel}.`,
    `If you did not request this, you can ignore this email or cancel the signup here: ${input.unsubscribeUrl}`,
    buildLegalTextFooter(branding),
  ]);

  const html = renderHtmlLayout({
    branding,
    preheader: `${title} for ${projectTitle}`,
    title,
    intro: `Hello ${greetingName}, please confirm your ${audienceLabel} for ${projectTitle}.`,
    bodyHtml: [
      `<div style="margin-bottom:18px;padding:14px 16px;background:#F8FAFC;border:1px solid ${BRAND_COLORS.border};border-left:4px solid ${BRAND_COLORS.accent};border-radius:12px;font-size:14px;color:#334155;line-height:1.7;">`,
      `<div><strong style="color:${BRAND_COLORS.text};">Project:</strong> ${escapeHtml(
        projectTitle,
      )}</div>`,
      `<div><strong style="color:${BRAND_COLORS.text};">Link expires:</strong> ${escapeHtml(
        expiresLabel,
      )}</div>`,
      `</div>`,
      `<p style="margin:0;font-size:14px;line-height:1.7;color:${BRAND_COLORS.muted};">If you did not request this, you can ignore this email or <a href="${escapeHtml(
        input.unsubscribeUrl,
      )}" style="color:${BRAND_COLORS.link};text-decoration:none;font-weight:600;">cancel the signup</a>.</p>`,
    ].join(""),
    actionLabel,
    actionUrl: input.confirmUrl,
  });

  return {
    subject,
    text,
    html,
  };
}

function renderBookingDetailsHtml(input: {
  bookingDateTimeLabel: string;
  partySize: number;
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  notes?: string | null;
}): string {
  const rows = [
    `<div><strong style="color:${BRAND_COLORS.text};">When:</strong> ${escapeHtml(
      input.bookingDateTimeLabel,
    )}</div>`,
    `<div><strong style="color:${BRAND_COLORS.text};">Party size:</strong> ${escapeHtml(
      String(input.partySize),
    )}</div>`,
    input.guestName
      ? `<div><strong style="color:${BRAND_COLORS.text};">Guest:</strong> ${escapeHtml(
          sanitizeTextLine(input.guestName),
        )}</div>`
      : "",
    input.guestEmail
      ? `<div><strong style="color:${BRAND_COLORS.text};">Email:</strong> ${escapeHtml(
          sanitizeTextLine(input.guestEmail),
        )}</div>`
      : "",
    input.guestPhone
      ? `<div><strong style="color:${BRAND_COLORS.text};">Phone:</strong> ${escapeHtml(
          sanitizeTextLine(input.guestPhone),
        )}</div>`
      : "",
    input.notes
      ? `<div><strong style="color:${BRAND_COLORS.text};">Notes:</strong> ${formatRichText(
          input.notes,
        )}</div>`
      : "",
  ].filter(Boolean);

  return [
    `<div style="margin-bottom:18px;padding:14px 16px;background:#F8FAFC;border:1px solid ${BRAND_COLORS.border};border-left:4px solid ${BRAND_COLORS.accent};border-radius:12px;font-size:14px;color:#334155;line-height:1.8;">`,
    rows.join(""),
    `</div>`,
  ].join("");
}

export async function buildGuestBookingConfirmationEmail(
  input: {
    projectTitle: string;
    guestName?: string | null;
    partySize: number;
    bookingDateTimeLabel: string;
    cancelUrl: string;
  },
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveBrandingOverride(brandingOverride);
  const projectTitle = sanitizeTextLine(input.projectTitle) || "your restaurant";
  const greetingName = toGreetingName(input.guestName);
  const subject = `Your table booking is confirmed for ${projectTitle}`;
  const text = joinNonEmptyTextBlocks([
    `Hello ${greetingName},`,
    `Your table booking for ${projectTitle} is confirmed.`,
    `When: ${input.bookingDateTimeLabel}`,
    `Party size: ${input.partySize}`,
    `Cancel booking: ${input.cancelUrl}`,
    buildLegalTextFooter(branding),
  ]);
  const html = renderHtmlLayout({
    branding,
    preheader: `Your booking is confirmed for ${projectTitle}`,
    title: "Booking confirmed",
    intro: `Hello ${greetingName}, your table booking for ${projectTitle} is confirmed.`,
    bodyHtml: [
      renderBookingDetailsHtml({
        bookingDateTimeLabel: input.bookingDateTimeLabel,
        partySize: input.partySize,
      }),
      `<p style="margin:0;font-size:14px;line-height:1.7;color:${BRAND_COLORS.muted};">If your plans change, you can cancel this booking using the link below.</p>`,
    ].join(""),
    actionLabel: "Cancel booking",
    actionUrl: input.cancelUrl,
  });

  return {
    subject,
    text,
    html,
  };
}

export async function buildGuestBookingCancellationEmail(
  input: {
    projectTitle: string;
    guestName?: string | null;
    partySize: number;
    bookingDateTimeLabel: string;
  },
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveBrandingOverride(brandingOverride);
  const projectTitle = sanitizeTextLine(input.projectTitle) || "your restaurant";
  const greetingName = toGreetingName(input.guestName);
  const subject = `Your table booking was cancelled for ${projectTitle}`;
  const text = joinNonEmptyTextBlocks([
    `Hello ${greetingName},`,
    `Your table booking for ${projectTitle} has been cancelled.`,
    `When: ${input.bookingDateTimeLabel}`,
    `Party size: ${input.partySize}`,
    buildLegalTextFooter(branding),
  ]);
  const html = renderHtmlLayout({
    branding,
    preheader: `Your booking was cancelled for ${projectTitle}`,
    title: "Booking cancelled",
    intro: `Hello ${greetingName}, your table booking for ${projectTitle} has been cancelled.`,
    bodyHtml: renderBookingDetailsHtml({
      bookingDateTimeLabel: input.bookingDateTimeLabel,
      partySize: input.partySize,
    }),
  });

  return {
    subject,
    text,
    html,
  };
}

export async function buildStaffNewBookingEmail(
  input: {
    projectTitle: string;
    bookingDateTimeLabel: string;
    partySize: number;
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    notes?: string | null;
  },
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveBrandingOverride(brandingOverride);
  const projectTitle = sanitizeTextLine(input.projectTitle) || "your restaurant";
  const subject = `New table booking for ${projectTitle}`;
  const text = joinNonEmptyTextBlocks([
    `A new table booking was confirmed for ${projectTitle}.`,
    [
      `When: ${input.bookingDateTimeLabel}`,
      `Party size: ${input.partySize}`,
      `Guest: ${sanitizeTextLine(input.guestName)}`,
      `Email: ${sanitizeTextLine(input.guestEmail)}`,
      `Phone: ${sanitizeTextLine(input.guestPhone)}`,
      input.notes ? `Notes: ${input.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    buildLegalTextFooter(branding),
  ]);
  const html = renderHtmlLayout({
    branding,
    preheader: `New table booking for ${projectTitle}`,
    title: "New table booking",
    intro: `A new booking was confirmed for ${projectTitle}.`,
    bodyHtml: renderBookingDetailsHtml({
      bookingDateTimeLabel: input.bookingDateTimeLabel,
      partySize: input.partySize,
      guestName: input.guestName,
      guestEmail: input.guestEmail,
      guestPhone: input.guestPhone,
      notes: input.notes,
    }),
  });

  return {
    subject,
    text,
    html,
  };
}

export async function buildStaffBookingCancellationEmail(
  input: {
    projectTitle: string;
    bookingDateTimeLabel: string;
    partySize: number;
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    cancelledBy: "guest" | "staff";
    notes?: string | null;
  },
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveBrandingOverride(brandingOverride);
  const projectTitle = sanitizeTextLine(input.projectTitle) || "your restaurant";
  const cancelledByLabel =
    input.cancelledBy === "guest" ? "The guest cancelled this booking." : "A staff member cancelled this booking.";
  const subject = `Table booking cancelled for ${projectTitle}`;
  const text = joinNonEmptyTextBlocks([
    `A table booking for ${projectTitle} was cancelled.`,
    cancelledByLabel,
    [
      `When: ${input.bookingDateTimeLabel}`,
      `Party size: ${input.partySize}`,
      `Guest: ${sanitizeTextLine(input.guestName)}`,
      `Email: ${sanitizeTextLine(input.guestEmail)}`,
      `Phone: ${sanitizeTextLine(input.guestPhone)}`,
      input.notes ? `Notes: ${input.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    buildLegalTextFooter(branding),
  ]);
  const html = renderHtmlLayout({
    branding,
    preheader: `Table booking cancelled for ${projectTitle}`,
    title: "Booking cancelled",
    intro: cancelledByLabel,
    bodyHtml: renderBookingDetailsHtml({
      bookingDateTimeLabel: input.bookingDateTimeLabel,
      partySize: input.partySize,
      guestName: input.guestName,
      guestEmail: input.guestEmail,
      guestPhone: input.guestPhone,
      notes: input.notes,
    }),
  });

  return {
    subject,
    text,
    html,
  };
}

export async function buildContactRecipientVerificationEmail(
  input: {
    projectSlug: string;
    verificationUrl: string;
    expiresInSeconds: number;
  },
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveBrandingOverride(brandingOverride);
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

export async function buildPasswordResetEmail(
  input: {
    recipientName?: string | null;
    resetUrl: string;
    expiresInSeconds: number;
  },
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveBrandingOverride(brandingOverride);
  const productName = resolveProductName(branding);
  const greetingName = toGreetingName(input.recipientName);
  const expiresLabel = formatDurationLabel(input.expiresInSeconds);
  const subject = `Reset your ${productName} password`;
  const text = joinNonEmptyTextBlocks([
    `Hello ${greetingName},`,
    `We received a request to reset your ${productName} password.`,
    `Reset password: ${input.resetUrl}`,
    `For your security, this link expires in ${expiresLabel}.`,
    "If you did not request a password reset, you can ignore this email.",
    buildLegalTextFooter(branding),
  ]);
  const html = renderHtmlLayout({
    branding,
    preheader: `Reset your ${productName} password`,
    title: "Reset your password",
    intro: `Hello ${greetingName}, we received a request to reset your ${productName} password.`,
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
