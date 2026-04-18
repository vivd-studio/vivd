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

function toGreetingName(rawName: string | null | undefined): string {
  const candidate = sanitizeTextLine(rawName || "");
  return candidate || DEFAULT_FALLBACK_GREETING;
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
    outroHtml: `<p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:${BRAND_COLORS.muted};">If you did not create this account, you can safely ignore this email.</p>`,
  });

  return {
    subject,
    text,
    html,
  };
}

export async function buildOrganizationInvitationEmail(
  input: {
    recipientName?: string | null;
    organizationName: string;
    inviterName?: string | null;
    inviterEmail?: string | null;
    roleLabel: string;
    projectTitle?: string | null;
    acceptUrl: string;
    expiresInSeconds: number;
    existingAccount: boolean;
  },
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveBrandingOverride(brandingOverride);
  const greetingName = toGreetingName(input.recipientName);
  const productName = resolveProductName(branding);
  const organizationName =
    sanitizeTextLine(input.organizationName) || "your organization";
  const inviterLabel =
    sanitizeTextLine(input.inviterName || "") ||
    sanitizeTextLine(input.inviterEmail || "") ||
    `a ${productName} admin`;
  const expiresLabel = formatDurationLabel(input.expiresInSeconds);
  const accountStep = input.existingAccount
    ? "Sign in with your existing account, then accept the invitation."
    : "Create your account and choose your password from the invite flow.";
  const projectLine = input.projectTitle
    ? `Assigned project: ${sanitizeTextLine(input.projectTitle)}`
    : "";
  const subject = `You've been invited to ${organizationName} on ${productName}`;
  const text = joinNonEmptyTextBlocks([
    `Hello ${greetingName},`,
    `${inviterLabel} invited you to join ${organizationName} on ${productName}.`,
    [`Role: ${sanitizeTextLine(input.roleLabel)}`, projectLine]
      .filter(Boolean)
      .join("\n"),
    accountStep,
    `Accept invitation: ${input.acceptUrl}`,
    `For your security, this link expires in ${expiresLabel}.`,
    "If you were not expecting this invitation, you can ignore this email.",
    buildLegalTextFooter(branding),
  ]);
  const html = renderHtmlLayout({
    branding,
    preheader: `You're invited to ${organizationName} on ${productName}`,
    title: "You're invited",
    intro: `Hello ${greetingName}, ${inviterLabel} invited you to join ${organizationName} on ${productName}.`,
    bodyHtml: [
      `<div style="margin-bottom:18px;padding:14px 16px;background:#F8FAFC;border:1px solid ${BRAND_COLORS.border};border-left:4px solid ${BRAND_COLORS.accent};border-radius:12px;font-size:14px;color:#334155;line-height:1.8;">`,
      `<div><strong style="color:${BRAND_COLORS.text};">Organization:</strong> ${escapeHtml(
        organizationName,
      )}</div>`,
      `<div><strong style="color:${BRAND_COLORS.text};">Role:</strong> ${escapeHtml(
        sanitizeTextLine(input.roleLabel),
      )}</div>`,
      input.projectTitle
        ? `<div><strong style="color:${BRAND_COLORS.text};">Assigned project:</strong> ${escapeHtml(
            sanitizeTextLine(input.projectTitle),
          )}</div>`
        : "",
      `<div><strong style="color:${BRAND_COLORS.text};">Invite sent by:</strong> ${escapeHtml(
        inviterLabel,
      )}</div>`,
      `<div><strong style="color:${BRAND_COLORS.text};">Link expires:</strong> ${escapeHtml(
        expiresLabel,
      )}</div>`,
      `</div>`,
      `<p style="margin:0;font-size:14px;line-height:1.7;color:${BRAND_COLORS.muted};">${escapeHtml(
        accountStep,
      )}</p>`,
    ]
      .filter(Boolean)
      .join(""),
    actionLabel: input.existingAccount
      ? "Sign in and accept invite"
      : "Accept invitation",
    actionUrl: input.acceptUrl,
    outroHtml: `<p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:${BRAND_COLORS.muted};">If you were not expecting this invitation, you can ignore this email.</p>`,
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
    outroHtml: `<p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:${BRAND_COLORS.muted};">If you did not request a password reset, you can ignore this email.</p>`,
  });

  return {
    subject,
    text,
    html,
  };
}
