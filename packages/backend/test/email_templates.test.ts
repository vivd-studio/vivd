import { describe, expect, it } from "vitest";
import {
  buildContactSubmissionEmail,
  buildPasswordResetEmail,
  buildVerificationEmail,
  formatDurationLabel,
} from "../src/services/email/templates";

describe("email templates", () => {
  it("renders contact submission emails with escaped html and legal footer", () => {
    const email = buildContactSubmissionEmail({
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
    });

    expect(email.text).toContain("Project: rocket-site");
    expect(email.text).toContain("Impressum: https://vivd.studio/impressum");
    expect(email.html).toContain("Alice &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("Landing &lt;unknown&gt;");
    expect(email.html).toContain("https://vivd.studio/datenschutz");
    expect(email.html).toContain("Felix Pahlke");
    expect(email.html).toContain("images/vivd_logo_transparent.png");
  });

  it("renders verification email with CTA and expected expiry text", () => {
    const email = buildVerificationEmail({
      recipientName: "Pat",
      verificationUrl: "https://app.localhost/vivd-studio/verify?token=abc",
      expiresInSeconds: 3_600,
    });

    expect(email.subject).toBe("Verify your email address for vivd");
    expect(email.text).toContain("Hello Pat");
    expect(email.text).toContain("expires in 1 hour");
    expect(email.html).toContain("Verify email address");
    expect(email.html).toContain("https://app.localhost/vivd-studio/verify?token=abc");
    expect(email.html).toContain("images/vivd_logo_transparent.png");
  });

  it("renders password reset email with fallback greeting", () => {
    const email = buildPasswordResetEmail({
      recipientName: "",
      resetUrl: "https://app.localhost/vivd-studio/reset-password?token=xyz",
      expiresInSeconds: 7_200,
    });

    expect(email.subject).toBe("Reset your vivd password");
    expect(email.text).toContain("Hello there");
    expect(email.text).toContain("expires in 2 hours");
    expect(email.html).toContain("Set a new password");
    expect(email.html).toContain("https://vivd.studio/agb");
    expect(email.html).toContain("images/vivd_logo_transparent.png");
  });

  it("formats durations with practical units", () => {
    expect(formatDurationLabel(45)).toBe("45 seconds");
    expect(formatDurationLabel(60)).toBe("1 minute");
    expect(formatDurationLabel(3_600)).toBe("1 hour");
    expect(formatDurationLabel(86_400)).toBe("1 day");
  });
});
