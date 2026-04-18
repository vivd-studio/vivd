import { describe, expect, it } from "vitest";
import {
  buildOrganizationInvitationEmail,
  buildPasswordResetEmail,
  buildVerificationEmail,
  formatDurationLabel,
} from "../src/services/email/templates";

describe("email templates", () => {
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

  it("renders organization invitation email for invite-first onboarding", async () => {
    const email = await buildOrganizationInvitationEmail(
      {
        recipientName: "Pat",
        organizationName: "Acme Studio",
        inviterName: "Morgan",
        roleLabel: "Client Editor",
        projectTitle: "Launch Site",
        acceptUrl: "https://acme.example.com/vivd-studio/invite?token=abc",
        expiresInSeconds: 604_800,
        existingAccount: false,
      },
      {
        displayName: "Example Studio",
        supportEmail: "support@example.com",
      },
    );

    expect(email.subject).toBe("You've been invited to Acme Studio on Example Studio");
    expect(email.text).toContain("Morgan invited you to join Acme Studio on Example Studio.");
    expect(email.text).toContain("Role: Client Editor");
    expect(email.text).toContain("Assigned project: Launch Site");
    expect(email.text).toContain("Create your account and choose your password from the invite flow.");
    expect(email.text).toContain(
      "Accept invitation: https://acme.example.com/vivd-studio/invite?token=abc",
    );
    expect(email.text).toContain("expires in 7 days");
    expect(email.html).toContain("Accept invitation");
    expect(email.html).toContain("Launch Site");
    expect(email.html).toContain("support@example.com");
  });

  it("formats durations with practical units", () => {
    expect(formatDurationLabel(45)).toBe("45 seconds");
    expect(formatDurationLabel(60)).toBe("1 minute");
    expect(formatDurationLabel(3_600)).toBe("1 hour");
    expect(formatDurationLabel(86_400)).toBe("1 day");
  });
});
