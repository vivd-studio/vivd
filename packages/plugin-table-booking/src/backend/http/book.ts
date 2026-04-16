import express from "express";
import type { TableBookingPublicRouterDeps } from "../ports";

function normalizeFieldValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
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
  return req.ip?.trim() || null;
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

export function createTableBookingBookRouter(
  deps: TableBookingPublicRouterDeps,
) {
  const router = express.Router();
  const formParser = express.urlencoded({ extended: false, limit: "128kb" });
  const jsonParser = express.json({ limit: "128kb" });

  router.post(
    "/table-booking/v1/book",
    deps.upload.none(),
    formParser,
    jsonParser,
    async (req, res) => {
      try {
        const fields = readRequestFields(req.body);
        if ((fields._honeypot || "").trim().length > 0) {
          if (requestWantsJson(req)) {
            return res.status(200).json({
              ok: true,
              result: {
                bookingId: "honeypot",
                status: "confirmed",
                serviceDate: fields.date || "",
                time: fields.time || "",
                partySize: Number.parseInt(fields.partySize || "0", 10) || 0,
              },
            });
          }
          return res.status(200).send(
            renderMessagePage("Booking received", "Please check your email for confirmation."),
          );
        }

        const { redirectTarget, result } = await deps.service.createReservation({
          token: fields.token,
          date: fields.date,
          time: fields.time,
          partySize: Number.parseInt(fields.partySize || "0", 10),
          name: fields.name,
          email: fields.email,
          phone: fields.phone,
          notes: fields.notes || null,
          sourceHost: extractSourceHost(req),
          referer: req.get("referer") || null,
          origin: req.get("origin") || null,
          redirect: fields._redirect || null,
          clientIp: extractClientIp(req),
        });

        if (!requestWantsJson(req) && redirectTarget) {
          return res.redirect(303, redirectTarget);
        }

        if (requestWantsJson(req)) {
          return res.status(200).json({ ok: true, result });
        }

        return res.status(200).send(
          renderMessagePage(
            "Booking confirmed",
            "Your booking was confirmed. Please check your email for the details.",
          ),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not create booking.";
        if (requestWantsJson(req)) {
          return res.status(400).json({ ok: false, error: { code: "booking_failed", message } });
        }
        return res.status(400).send(renderMessagePage("Booking failed", message));
      }
    },
  );

  return router;
}
