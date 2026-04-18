import type {
  EmailTemplate,
  EmailTemplateBranding,
  EmailTemplateBrandingResolver,
} from "@vivd/plugin-sdk/emailTemplates";
import {
  BRAND_COLORS,
  buildLegalTextFooter,
  escapeHtml,
  formatRichText,
  joinNonEmptyTextBlocks,
  renderHtmlLayout,
  resolveEmailTemplateBranding,
  sanitizeTextLine,
  toGreetingName,
} from "@vivd/plugin-sdk/emailTemplates";

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
  brandingResolver: EmailTemplateBrandingResolver,
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveEmailTemplateBranding(
    brandingResolver,
    brandingOverride,
  );
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
  brandingResolver: EmailTemplateBrandingResolver,
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveEmailTemplateBranding(
    brandingResolver,
    brandingOverride,
  );
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
  brandingResolver: EmailTemplateBrandingResolver,
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveEmailTemplateBranding(
    brandingResolver,
    brandingOverride,
  );
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
  brandingResolver: EmailTemplateBrandingResolver,
  brandingOverride?: EmailTemplateBranding,
): Promise<EmailTemplate> {
  const branding = await resolveEmailTemplateBranding(
    brandingResolver,
    brandingOverride,
  );
  const projectTitle = sanitizeTextLine(input.projectTitle) || "your restaurant";
  const cancelledByLabel =
    input.cancelledBy === "guest"
      ? "The guest cancelled this booking."
      : "A staff member cancelled this booking.";
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
