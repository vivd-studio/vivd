import { describe, expect, it } from "vitest";
import {
  buildNewsletterCampaignEmail,
  buildNewsletterConfirmationEmail,
} from "./emails";

const brandingResolver = {
  getResolvedBranding: async () => ({
    displayName: "Example Studio",
    websiteUrl: "https://example.com",
    supportEmail: "support@example.com",
  }),
};

describe("newsletter emails", () => {
  it("renders newsletter confirmation emails with branded copy", async () => {
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
      brandingResolver,
    );

    expect(email.subject).toBe("Confirm your waitlist signup for Horse Tinder");
    expect(email.text).toContain("Hello Pat");
    expect(email.text).toContain("This link expires in 2 days.");
    expect(email.html).toContain("Confirm waitlist signup");
    expect(email.html).toContain("support@example.com");
  });

  it("renders campaign test emails without broadcast copy drift", async () => {
    const email = await buildNewsletterCampaignEmail(
      {
        projectTitle: "Horse Tinder",
        recipientName: "Pat",
        subject: "Weekly update",
        body: "Hello subscribers",
        mode: "newsletter",
        isTest: true,
      },
      brandingResolver,
    );

    expect(email.subject).toBe("[Test] Weekly update");
    expect(email.text).toContain("This is a test send");
    expect(email.html).toContain("No subscriber broadcast has been triggered");
  });
});
