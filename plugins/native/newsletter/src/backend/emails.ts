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
  toGreetingName,
} from "@vivd/plugin-sdk/emailTemplates";

export async function buildNewsletterConfirmationEmail(
  input: {
    projectTitle: string;
    recipientName?: string | null;
    confirmUrl: string;
    unsubscribeUrl: string;
    expiresInSeconds: number;
    mode: "newsletter" | "waitlist";
  },
  brandingResolver: EmailTemplateBrandingResolver,
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveEmailTemplateBranding(
    brandingResolver,
    brandingOverride,
  );
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

export async function buildNewsletterCampaignEmail(
  input: {
    projectTitle: string;
    recipientName?: string | null;
    subject: string;
    body: string;
    unsubscribeUrl?: string | null;
    mode: "newsletter" | "waitlist";
    isTest?: boolean;
  },
  brandingResolver: EmailTemplateBrandingResolver,
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveEmailTemplateBranding(
    brandingResolver,
    brandingOverride,
  );
  const projectTitle = sanitizeTextLine(input.projectTitle) || "your project";
  const greetingName = toGreetingName(input.recipientName);
  const subject = sanitizeTextLine(input.subject) || `Update from ${projectTitle}`;
  const body = input.body.trim();
  const isTest = Boolean(input.isTest);
  const streamLabel = input.mode === "waitlist" ? "waitlist" : "newsletter";
  const subjectLine = isTest ? `[Test] ${subject}` : subject;

  const text = joinNonEmptyTextBlocks([
    `Hello ${greetingName},`,
    isTest
      ? `This is a test send for the ${projectTitle} ${streamLabel} campaign.`
      : `Here is the latest ${streamLabel} update from ${projectTitle}.`,
    body,
    input.unsubscribeUrl
      ? `Unsubscribe: ${input.unsubscribeUrl}`
      : isTest
        ? "This was only a test send. No subscriber delivery was triggered."
        : "",
    buildLegalTextFooter(branding),
  ]);

  const bodyLinesHtml = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:${BRAND_COLORS.text};">${formatRichText(
          block,
        )}</p>`,
    )
    .join("");

  const testNoteHtml = isTest
    ? `<div style="margin-bottom:18px;padding:14px 16px;background:#FFF7ED;border:1px solid #FED7AA;border-left:4px solid #F97316;border-radius:12px;font-size:14px;color:#9A3412;line-height:1.7;">This is a test send for the <strong>${escapeHtml(
        projectTitle,
      )}</strong> ${escapeHtml(streamLabel)} campaign. No subscriber broadcast has been triggered.</div>`
    : "";
  const unsubscribeHtml = input.unsubscribeUrl
    ? `<p style="margin:8px 0 0;font-size:13px;line-height:1.7;color:${BRAND_COLORS.muted};">If you no longer want these emails, you can <a href="${escapeHtml(
        input.unsubscribeUrl,
      )}" style="color:${BRAND_COLORS.link};text-decoration:none;font-weight:600;">unsubscribe here</a>.</p>`
    : "";

  const html = renderHtmlLayout({
    branding,
    preheader: `${subject} from ${projectTitle}`,
    title: subject,
    intro: isTest
      ? `Hello ${greetingName}, this is a test send for the ${projectTitle} ${streamLabel} campaign.`
      : `Hello ${greetingName}, here is the latest ${streamLabel} update from ${projectTitle}.`,
    bodyHtml: [testNoteHtml, bodyLinesHtml, unsubscribeHtml].join(""),
  });

  return {
    subject: subjectLine,
    text,
    html,
  };
}
