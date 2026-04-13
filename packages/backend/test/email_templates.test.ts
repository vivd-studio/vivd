import { describe, expect, it } from "vitest";
import {
  buildContactSubmissionEmail,
  buildNewsletterConfirmationEmail,
  buildPasswordResetEmail,
  buildVerificationEmail,
  formatDurationLabel,
} from "../src/services/email/templates";

describe("email templates", () => {
  it("renders contact submission emails with escaped html and a minimal default footer", async () => {
    const email = await buildContactSubmissionEmail(
      {
        projectSlug: "rocket-site",
        submittedAtLabel: "February 22, 2026, 10:15 PM UTC",
        replyToEmail: "sender@example.com",
      submittedFields: [
        { label: "Name", value: "Alice <script>alert(1)</script>" },
        { label: "Message", value: "Hello\nWorld" },
      ],
      unknownFields: {
        source: "Landing <unknown>",
      },
      },
      {},
    );

    expect(email.text).toContain("Project: rocket-site");
    expect(email.html).toContain("Alice &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("Landing &lt;unknown&gt;");
    expect(email.text).not.toContain("Felix Pahlke");
    expect(email.text).not.toContain("vivd.studio/impressum");
    expect(email.html).not.toContain("vivd.studio/datenschutz");
    expect(email.html).not.toContain("images/vivd_logo_transparent.png");
  });

  it("renders verification email with configured branding details only", async () => {
    const email = await buildVerificationEmail(
      {
        recipientName: "Pat",
        verificationUrl: "https://app.localhost/vivd-studio/verify?token=abc",
        expiresInSeconds: 3_600,
      },
      {
        displayName: "Example Studio",
        logoUrl: "https://example.com/logo.png",
        supportEmail: "support@example.com",
        websiteUrl: "https://example.com",
        legalName: "Example GmbH",
        legalAddress: "Street 1, 12345 City",
        imprintUrl: "https://example.com/imprint",
        privacyUrl: "https://example.com/privacy",
        termsUrl: "https://example.com/terms",
      },
    );

    expect(email.subject).toBe("Verify your email address for Example Studio");
    expect(email.text).toContain("Hello Pat");
    expect(email.text).toContain("expires in 1 hour");
    expect(email.text).toContain("Example GmbH");
    expect(email.text).toContain("Legal notice: https://example.com/imprint");
    expect(email.html).toContain("Verify email address");
    expect(email.html).toContain("https://app.localhost/vivd-studio/verify?token=abc");
    expect(email.html).toContain("https://example.com/logo.png");
    expect(email.html).toContain("support@example.com");
    expect(email.html).toContain("https://example.com/privacy");
  });

  it("renders password reset email with fallback greeting", async () => {
    const email = await buildPasswordResetEmail(
      {
        recipientName: "",
        resetUrl: "https://app.localhost/vivd-studio/reset-password?token=xyz",
        expiresInSeconds: 7_200,
      },
      {},
    );

    expect(email.subject).toBe("Reset your vivd password");
    expect(email.text).toContain("Hello there");
    expect(email.text).toContain("expires in 2 hours");
    expect(email.html).toContain("Set a new password");
    expect(email.html).not.toContain("https://vivd.studio/agb");
    expect(email.html).not.toContain("images/vivd_logo_transparent.png");
  });

  it("renders newsletter confirmation email with branded copy", async () => {
    const email = await buildNewsletterConfirmationEmail(
      {
        projectTitle: "Horse Tinder",
        recipientName: "Pat",
        confirmUrl: "https://api.example.com/plugins/newsletter/v1/confirm?token=abc",
        unsubscribeUrl:
          "https://api.example.com/plugins/newsletter/v1/unsubscribe?token=def",
        expiresInSeconds: 172_800,
        mode: "waitlist",
      },
      {
        displayName: "Example Studio",
        websiteUrl: "https://example.com",
        supportEmail: "support@example.com",
      },
    );

    expect(email.subject).toBe("Confirm your waitlist signup for Horse Tinder");
    expect(email.text).toContain("Hello Pat");
    expect(email.text).toContain("Please confirm your waitlist signup for Horse Tinder.");
    expect(email.text).toContain("https://api.example.com/plugins/newsletter/v1/confirm?token=abc");
    expect(email.text).toContain("https://api.example.com/plugins/newsletter/v1/unsubscribe?token=def");
    expect(email.text).toContain("This link expires in 2 days.");
    expect(email.html).toContain("Confirm your waitlist signup");
    expect(email.html).toContain("Confirm waitlist signup");
    expect(email.html).toContain("https://api.example.com/plugins/newsletter/v1/confirm?token=abc");
    expect(email.html).toContain("https://api.example.com/plugins/newsletter/v1/unsubscribe?token=def");
  });

  it("formats durations with practical units", () => {
    expect(formatDurationLabel(45)).toBe("45 seconds");
    expect(formatDurationLabel(60)).toBe("1 minute");
    expect(formatDurationLabel(3_600)).toBe("1 hour");
    expect(formatDurationLabel(86_400)).toBe("1 day");
  });
});
