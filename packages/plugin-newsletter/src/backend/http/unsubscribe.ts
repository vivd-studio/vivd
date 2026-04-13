import express from "express";
import type { NewsletterPublicRouterDeps } from "../ports";

function renderMessagePage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f5f7fb; color: #111827; margin: 0; padding: 32px; }
      main { max-width: 640px; margin: 8vh auto; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; font-size: 1.6rem; }
      p { line-height: 1.55; color: #374151; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}

export function createNewsletterUnsubscribeRouter(
  deps: Pick<NewsletterPublicRouterDeps, "service">,
) {
  const router = express.Router();

  router.get("/newsletter/v1/unsubscribe", async (req, res) => {
    const token = String(req.query.token || "").trim();
    const redirect = String(req.query.redirect || "").trim() || null;
    if (!token) {
      return res.status(400).send(renderMessagePage("Invalid link", "Unsubscribe token is missing."));
    }

    const result = await deps.service.unsubscribeByToken({ token, redirect });
    if (result.redirectTarget) {
      return res.redirect(303, result.redirectTarget);
    }

    if (result.status === "unsubscribed") {
      return res.status(200).send(
        renderMessagePage("Unsubscribed", "You have been removed from the list."),
      );
    }
    if (result.status === "already_unsubscribed") {
      return res.status(200).send(
        renderMessagePage("Already unsubscribed", "This email address was already removed from the list."),
      );
    }
    if (result.status === "expired") {
      return res.status(410).send(
        renderMessagePage("Link expired", "This unsubscribe link has expired."),
      );
    }

    return res.status(404).send(
      renderMessagePage("Invalid link", "This unsubscribe link is not valid."),
    );
  });

  return router;
}
