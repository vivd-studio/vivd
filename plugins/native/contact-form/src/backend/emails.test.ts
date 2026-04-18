import { describe, expect, it } from "vitest";
import { buildContactRecipientVerificationEmail, buildContactSubmissionEmail } from "./emails";

const brandingResolver = {
  getResolvedBranding: async () => ({}),
};

describe("contact-form emails", () => {
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
      brandingResolver,
    );

    expect(email.text).toContain("Project: rocket-site");
    expect(email.html).toContain("Alice &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("Landing &lt;unknown&gt;");
    expect(email.text).not.toContain("Felix Pahlke");
  });

  it("renders recipient verification emails with branded action copy", async () => {
    const email = await buildContactRecipientVerificationEmail(
      {
        projectSlug: "rocket-site",
        verificationUrl: "https://app.example.com/vivd-studio/api/plugins/contact/v1/recipient-verify?token=abc",
        expiresInSeconds: 3600,
      },
      brandingResolver,
      {
        displayName: "Example Studio",
        supportEmail: "support@example.com",
      },
    );

    expect(email.subject).toBe("Verify contact recipient for rocket-site");
    expect(email.text).toContain("expires in 1 hour");
    expect(email.html).toContain("Verify recipient email");
    expect(email.html).toContain("support@example.com");
  });
});
