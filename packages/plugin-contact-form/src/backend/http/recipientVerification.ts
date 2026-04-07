import express from "express";
import { contactFormRecipientVerificationService } from "../recipientVerification";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderVerificationPage(input: {
  title: string;
  message: string;
  hint?: string;
}): string {
  const hintHtml = input.hint
    ? `<p style="margin:10px 0 0;color:#64748b;font-size:14px;line-height:1.6;">${escapeHtml(
        input.hint,
      )}</p>`
    : "";

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(input.title)}</title>`,
    "</head>",
    '<body style="margin:0;padding:24px;background:#f8fafc;color:#0f172a;font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;">',
    '  <main style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px 24px;box-shadow:0 10px 24px rgba(15,23,42,0.08);">',
    `    <h1 style="margin:0 0 10px;font-size:24px;line-height:1.2;">${escapeHtml(input.title)}</h1>`,
    `    <p style="margin:0;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(input.message)}</p>`,
    `    ${hintHtml}`,
    "  </main>",
    "</body>",
    "</html>",
  ].join("");
}

export function createContactRecipientVerificationRouter() {
  const router = express.Router();

  router.get("/contact/v1/recipient-verify", async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";

    try {
      const result =
        await contactFormRecipientVerificationService.verifyRecipientByToken(token);

      if (result.status === "verified") {
        return res.status(200).send(
          renderVerificationPage({
            title: "Recipient verified",
            message: `${result.email} can now receive contact form submissions for ${result.projectSlug}.`,
            hint: "You can close this tab and return to Vivd.",
          }),
        );
      }

      if (result.status === "expired") {
        return res.status(410).send(
          renderVerificationPage({
            title: "Verification link expired",
            message: "This verification link has expired.",
            hint: "Go back to the Contact Form settings and resend verification.",
          }),
        );
      }

      return res.status(400).send(
        renderVerificationPage({
          title: "Invalid verification link",
          message: "This verification link is invalid or already used.",
          hint: "Go back to the Contact Form settings and request a new link.",
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ContactRecipientVerification] Failed to verify token", {
        error: message,
      });
      return res.status(500).send(
        renderVerificationPage({
          title: "Verification failed",
          message: "Something went wrong while verifying this email.",
          hint: "Please retry from the Contact Form settings.",
        }),
      );
    }
  });

  return router;
}
