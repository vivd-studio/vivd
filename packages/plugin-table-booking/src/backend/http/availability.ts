import express from "express";
import type { TableBookingPublicRouterDeps } from "../ports";

function requestWantsJson(req: express.Request): boolean {
  const acceptHeader = (req.get("accept") || "").toLowerCase();
  return acceptHeader.includes("application/json") || !acceptHeader.includes("text/html");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAvailabilityPage(
  date: string,
  partySize: string,
  slots: Array<{ time: string; label: string }>,
): string {
  const items =
    slots.length > 0
      ? `<ul>${slots
          .map((slot) => `<li>${escapeHtml(slot.label || slot.time)}</li>`)
          .join("")}</ul>`
      : "<p>No online slots available.</p>";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Available tables</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f5f7fb; color: #111827; margin: 0; padding: 32px; }
      main { max-width: 640px; margin: 8vh auto; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; font-size: 1.6rem; }
      p, li { line-height: 1.55; color: #374151; }
    </style>
  </head>
  <body>
    <main>
      <h1>Available tables</h1>
      <p>Date: ${escapeHtml(date || "n/a")} | Party size: ${escapeHtml(partySize || "n/a")}</p>
      ${items}
    </main>
  </body>
</html>`;
}

export function createTableBookingAvailabilityRouter(
  deps: TableBookingPublicRouterDeps,
) {
  const router = express.Router();

  router.get("/table-booking/v1/availability", async (req, res) => {
    try {
      const token = String(req.query.token || "").trim();
      const date = String(req.query.date || "").trim();
      const partySize = Number.parseInt(String(req.query.partySize || "").trim(), 10);
      if (!token || !date || !Number.isFinite(partySize)) {
        const message = "token, date, and partySize are required.";
        if (requestWantsJson(req)) {
          return res.status(400).json({ ok: false, error: { code: "bad_request", message } });
        }
        return res.status(400).send(renderAvailabilityPage(date, String(req.query.partySize || ""), []));
      }

      const result = await deps.service.listAvailability({
        token,
        date,
        partySize,
        sourceHost:
          req.get("origin") || req.get("referer")
            ? new URL(String(req.get("origin") || req.get("referer"))).host
            : null,
        origin: req.get("origin") || null,
        referer: req.get("referer") || null,
      });

      if (requestWantsJson(req)) {
        return res.status(200).json({ ok: true, slots: result.slots });
      }

      return res.status(200).send(
        renderAvailabilityPage(date, String(partySize), result.slots),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load availability.";
      if (requestWantsJson(req)) {
        return res.status(400).json({ ok: false, error: { code: "availability_failed", message } });
      }
      return res.status(400).send(renderAvailabilityPage("", "", []));
    }
  });

  return router;
}
