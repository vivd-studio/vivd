import express from "express";
import type { TableBookingPublicRouterDeps } from "../ports";

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
      button { display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:999px;padding:10px 18px;background:#111827;color:white;font-weight:600;cursor:pointer; }
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

function renderConfirmPage(options: {
  token: string;
  redirect?: string | null;
  bookingDateTimeLabel: string;
  guestName: string;
  partySize: number;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cancel booking</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f5f7fb; color: #111827; margin: 0; padding: 32px; }
      main { max-width: 640px; margin: 8vh auto; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; font-size: 1.6rem; }
      p { line-height: 1.55; color: #374151; }
      .meta { margin: 18px 0; padding: 14px 16px; background: #f8fafc; border-radius: 12px; }
      button { display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:999px;padding:10px 18px;background:#111827;color:white;font-weight:600;cursor:pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>Cancel booking</h1>
      <p>Please confirm you want to cancel this reservation.</p>
      <div class="meta">
        <p><strong>Name:</strong> ${escapeHtml(options.guestName)}</p>
        <p><strong>Date and time:</strong> ${escapeHtml(options.bookingDateTimeLabel)}</p>
        <p><strong>Party size:</strong> ${escapeHtml(String(options.partySize))}</p>
      </div>
      <form method="POST" action="/plugins/table-booking/v1/cancel">
        <input type="hidden" name="token" value="${escapeHtml(options.token)}" />
        ${
          options.redirect
            ? `<input type="hidden" name="redirect" value="${escapeHtml(options.redirect)}" />`
            : ""
        }
        <button type="submit">Cancel reservation</button>
      </form>
    </main>
  </body>
</html>`;
}

export function createTableBookingCancelRouter(
  deps: Pick<TableBookingPublicRouterDeps, "service">,
) {
  const router = express.Router();
  const formParser = express.urlencoded({ extended: false, limit: "64kb" });

  router.get("/table-booking/v1/cancel", async (req, res) => {
    const token = String(req.query.token || "").trim();
    const redirect = String(req.query.redirect || "").trim() || null;
    if (!token) {
      return res
        .status(400)
        .send(renderMessagePage("Invalid link", "Cancellation token is missing."));
    }

    const preview = await deps.service.getCancelPreview({ token });
    if (preview.status === "confirm" && preview.reservation) {
      return res.status(200).send(
        renderConfirmPage({
          token,
          redirect,
          bookingDateTimeLabel: preview.reservation.bookingDateTimeLabel,
          guestName: preview.reservation.guestName,
          partySize: preview.reservation.partySize,
        }),
      );
    }
    if (preview.status === "already_cancelled") {
      return res.status(200).send(
        renderMessagePage("Already cancelled", "This booking was already cancelled."),
      );
    }
    if (preview.status === "cutoff_passed") {
      return res.status(410).send(
        renderMessagePage(
          "Cancellation window closed",
          "Online cancellation is no longer available for this booking. Please contact the restaurant directly.",
        ),
      );
    }
    if (preview.status === "expired") {
      return res.status(410).send(
        renderMessagePage("Link expired", "This cancellation link has expired."),
      );
    }

    return res.status(404).send(
      renderMessagePage("Invalid link", "This cancellation link is not valid."),
    );
  });

  router.post("/table-booking/v1/cancel", formParser, async (req, res) => {
    const token = String(req.body?.token || "").trim();
    const redirect = String(req.query.redirect || req.body?.redirect || "").trim() || null;
    if (!token) {
      return res
        .status(400)
        .send(renderMessagePage("Invalid link", "Cancellation token is missing."));
    }

    const result = await deps.service.cancelByToken({ token, redirect });
    if (result.redirectTarget) {
      return res.redirect(303, result.redirectTarget);
    }

    if (result.status === "cancelled") {
      return res.status(200).send(
        renderMessagePage("Booking cancelled", "Your reservation has been cancelled."),
      );
    }
    if (result.status === "already_cancelled") {
      return res.status(200).send(
        renderMessagePage("Already cancelled", "This reservation was already cancelled."),
      );
    }
    if (result.status === "cutoff_passed") {
      return res.status(410).send(
        renderMessagePage(
          "Cancellation window closed",
          "Online cancellation is no longer available for this booking. Please contact the restaurant directly.",
        ),
      );
    }
    if (result.status === "expired") {
      return res.status(410).send(
        renderMessagePage("Link expired", "This cancellation link has expired."),
      );
    }

    return res.status(404).send(
      renderMessagePage("Invalid link", "This cancellation link is not valid."),
    );
  });

  return router;
}
