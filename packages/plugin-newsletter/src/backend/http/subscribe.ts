import express from "express";
import type {
  NewsletterPublicRouterDeps,
  NewsletterSubscriberMutationResult,
} from "../ports";

function normalizeFieldValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
      if (typeof entry === "number" || typeof entry === "boolean") {
        return String(entry);
      }
    }
  }
  return "";
}

function readRequestFields(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([key, value]) => [
      key,
      normalizeFieldValue(value),
    ]),
  );
}

function requestWantsJson(req: express.Request): boolean {
  if (req.is("application/json")) return true;

  const acceptHeader = (req.get("accept") || "").toLowerCase();
  if (!acceptHeader) return false;
  if (acceptHeader.includes("text/html")) return false;
  return acceptHeader.includes("application/json");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMessagePage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f5f7fb; color: #111827; margin: 0; padding: 32px; }
      main { max-width: 640px; margin: 8vh auto; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; font-size: 1.6rem; }
      p { line-height: 1.55; color: #374151; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`;
}

function successMessageForResult(result: NewsletterSubscriberMutationResult): {
  title: string;
  message: string;
} {
  if (result.status === "already_confirmed") {
    return {
      title: "Already confirmed",
      message: "This email address is already confirmed.",
    };
  }

  if (result.status === "pending_cooldown") {
    return {
      title: "Check your inbox",
      message:
        "A confirmation email was sent recently. Please check your inbox and spam folder.",
    };
  }

  return {
    title: "Check your inbox",
    message:
      "Your email address was recorded. Please check your inbox to confirm your signup.",
  };
}

function sendSuccess(
  req: express.Request,
  res: express.Response,
  redirectTarget: string | null,
  result: NewsletterSubscriberMutationResult,
) {
  if (!requestWantsJson(req) && redirectTarget) {
    return res.redirect(303, redirectTarget);
  }

  if (requestWantsJson(req)) {
    return res.status(200).json({ ok: true, result });
  }

  const message = successMessageForResult(result);
  return res.status(200).send(renderMessagePage(message.title, message.message));
}

function sendError(
  req: express.Request,
  res: express.Response,
  status: number,
  code: string,
  message: string,
) {
  if (requestWantsJson(req)) {
    return res.status(status).json({ ok: false, error: { code, message } });
  }

  return res.status(status).send(renderMessagePage("Signup failed", message));
}

function extractClientIp(req: express.Request): string | null {
  const cfConnectingIp = req.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  const xRealIp = req.get("x-real-ip")?.trim();
  if (xRealIp) return xRealIp;

  const forwarded = req.get("x-forwarded-for");
  if (forwarded) {
    const forwardedParts = forwarded
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const forwardedIp =
      forwardedParts.length > 0
        ? forwardedParts[forwardedParts.length - 1]
        : undefined;
    if (forwardedIp) return forwardedIp;
  }

  const requestIp = req.ip?.trim();
  return requestIp || null;
}

function extractSourceHost(req: express.Request): string | null {
  for (const rawHeader of [req.get("origin"), req.get("referer")]) {
    const candidate = rawHeader?.trim();
    if (!candidate) continue;

    try {
      return new URL(candidate).host || null;
    } catch {
      return candidate;
    }
  }

  return null;
}

export function createNewsletterSubscribeRouter(
  deps: NewsletterPublicRouterDeps,
) {
  const router = express.Router();
  const formParser = express.urlencoded({ extended: false, limit: "128kb" });
  const jsonParser = express.json({ limit: "128kb" });

  router.post(
    "/newsletter/v1/subscribe",
    deps.upload.none(),
    formParser,
    jsonParser,
    async (req, res) => {
      try {
        const fields = readRequestFields(req.body);
        const token = fields.token;
        const email = fields.email;
        if (!token) {
          return sendError(req, res, 400, "missing_token", "token is required");
        }
        if (!email) {
          return sendError(req, res, 400, "missing_email", "email is required");
        }
        if ((fields._honeypot || "").trim().length > 0) {
          return sendSuccess(req, res, null, {
            email,
            status: "pending",
          });
        }

        const { redirectTarget, result } = await deps.service.subscribe({
          organizationId: "",
          projectSlug: "",
          token,
          email,
          name: fields.name || null,
          sourceHost: extractSourceHost(req),
          referer: req.get("referer") || null,
          origin: req.get("origin") || null,
          redirect: fields._redirect || null,
          clientIp: extractClientIp(req),
          turnstileToken: fields["cf-turnstile-response"] || null,
        });

        return sendSuccess(req, res, redirectTarget, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Signup failed";
        return sendError(req, res, 400, "signup_failed", message);
      }
    },
  );

  return router;
}
