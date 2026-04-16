# Table Booking Plugin Plan (Production-Ready V1)

Date: 2026-04-16  
Owner: plugins/product/backend/frontend  
Status: plan (no implementation in this doc)

## Goal

Ship a first-party `table_booking` plugin that lets a restaurant:

- place a real "Book a table" widget on the published site
- accept capacity-aware reservations without Studio running
- manage upcoming bookings inside Vivd
- send transactional booking emails to guests and restaurant staff

The result should be genuinely usable for an independent restaurant in v1, but not drift into floor-plan software, POS sync, or a full hospitality operations suite.

## Recommendation

Start with one extracted plugin, one venue per project, instant-confirm reservations, seat-capacity availability, and email notifications.

Do not try to ship table maps, approval workflows, payments, or multi-location support in the first release.

This v1 should be optimized for restaurants that need:

- an embedded booking widget on the site
- available time slots based on configured service windows
- a usable admin page for upcoming reservations
- guest confirmation and cancellation emails
- staff notification emails for new and cancelled bookings

## Product Boundary

### What v1 must do

1. Offer real-time slot selection based on configured service windows and seat capacity.
2. Persist bookings centrally in the control-plane database.
3. Show bookings in a real admin surface with filters and booking detail.
4. Send transactional emails to the guest and to restaurant notification recipients.
5. Let guests cancel through a tokenized email flow.
6. Give the agent deterministic enable/config/snippet/install flows through the generic plugin surface.
7. Work for plain HTML and Astro projects on the published site.

### What v1 must not do

- floor plans or drag-and-drop table assignment
- multiple rooms/areas/sections with separate inventory
- multiple venues inside one project
- POS integration
- Google/OpenTable/Apple reservation sync
- payments, deposits, cards, or no-show fees
- request-only or approval-based reservation flow
- manual reservation create/edit/reschedule inside the admin page
- waitlist management
- SMS, WhatsApp, push, Slack, or webhook notifications
- reminder campaigns or marketing automation

## Why This Scope Is Right

- A covers-based capacity model is enough for many small restaurants and avoids building a table-map engine.
- One venue per project matches the current Vivd project model and keeps configuration understandable.
- Instant-confirm booking removes the operational complexity of stale pending holds, approval SLAs, and expiry jobs.
- Deferring manual create/edit/reschedule keeps v1 inside the current generic plugin `ensure/info/config/read/action` contract instead of forcing richer plugin-specific write APIs immediately.

This is the smallest scope that is still a real booking product rather than a contact form with different labels.

## Proposed Plugin Shape

Create a new extracted package:

- `plugins/native/table-booking`

Suggested initial shape:

- `src/manifest.ts`
- `src/descriptor.ts`
- `src/index.ts`
- `src/backend/plugin.ts`
- `src/backend/module.ts`
- `src/backend/contribution.ts`
- `src/backend/service.ts`
- `src/backend/config.ts`
- `src/backend/ports.ts`
- `src/backend/publicApi.ts`
- `src/backend/snippets.ts`
- `src/backend/http/availability.ts`
- `src/backend/http/book.ts`
- `src/backend/http/cancel.ts`
- `src/frontend/plugin.ts`
- `src/frontend/module.ts`
- `src/frontend/TableBookingProjectPage.tsx`
- `src/cli/plugin.ts`
- `src/cli/module.ts`
- `src/shared/projectUi.ts`
- `src/shared/summary.ts`

Host apps should stay generic:

- backend/frontend/CLI/studio registries consume plugin-owned exports
- public HTTP route composition stays in the backend host registry
- no plugin package imports from `@vivd/backend/src/...`

## Proposed Definition

Suggested definition shape:

- `pluginId`: `table_booking`
- `name`: `Table Booking`
- `description`: `Accept restaurant table reservations from the live site and manage them in Vivd.`
- `category`: `commerce`
- `sortOrder`: `20`
- host-owned default enablement: disabled by default until explicitly enabled for a project
- `listUi.projectPanel`: `custom`
- `listUi.usageLabel`: `Bookings`
- `listUi.limitPrompt`: `Set monthly booking limit.\nLeave empty for unlimited.`
- `listUi.supportsMonthlyLimit`: `true`
- `listUi.supportsHardStop`: `true`
- `listUi.supportsTurnstile`: `true`
- `listUi.dashboardPath`: `null`

Capabilities:

- `supportsInfo: true`
- config `show/apply/template`: yes
- actions:
  - `cancel_booking`
  - `mark_no_show`
  - `mark_completed`
- reads:
  - `summary`
  - `bookings`
  - `agenda`

The action set is intentionally small and operational. Rich booking edits should wait until the generic plugin mutation surface can support structured payloads cleanly.

## Public Widget Experience

The public widget should be a progressive-enhancement booking flow, not a hard dependency on a heavy frontend bundle.

### Widget fields

Required:

- date
- party size
- time slot
- guest name
- guest email
- guest phone

Optional:

- notes
- `_redirect`
- `_honeypot`
- `cf-turnstile-response`

### Widget behavior

JS-enhanced path:

1. Guest chooses date and party size.
2. Widget fetches available time slots inline.
3. Guest chooses a slot and submits booking details.
4. Widget shows inline success or redirects to an allowed success URL.

Non-JS fallback:

1. Guest submits date and party size to a plugin-hosted availability page.
2. Backend renders the available slots and booking fields.
3. Final submit posts to the booking endpoint.

This keeps the main path smooth without making plain HTML sites second-class.

## Availability And Capacity Model

V1 should use seat-capacity availability, not per-table assignment.

### Core rules

- one venue per project
- one timezone per project
- weekly service schedule with one or more service periods per day
- date-specific overrides for closures or custom service periods
- global booking window rules for lead time, booking horizon, and online party-size limits

### Service period shape

Each service period should define:

- `startTime`
- `endTime`
- `slotIntervalMinutes`
- `maxConcurrentCovers`
- optional `durationMinutes` override
- optional `maxPartySize` override

### Global rules

- `timezone`
- `partySize.min`
- `partySize.max`
- `leadTimeMinutes`
- `bookingHorizonDays`
- `defaultDurationMinutes`
- `cancellationCutoffMinutes`

### Availability algorithm

For a requested `date + partySize`:

1. Load the active service periods for that date, after applying date overrides.
2. Generate candidate slot starts across those periods.
3. For each slot, compute the reservation window `[startAt, endAt)`.
4. Sum `partySize` across overlapping active bookings.
5. Mark the slot available only when overlapping covers plus the new party size stays within `maxConcurrentCovers`.
6. Re-run the same capacity check inside the final insert transaction so simultaneous last-seat bookings cannot overbook.

Statuses that consume capacity in v1:

- `confirmed`

Statuses that do not:

- `cancelled_by_guest`
- `cancelled_by_staff`
- `no_show`
- `completed`

If a requested party size exceeds the online booking limit, the endpoint should fail with a clear "contact the restaurant directly" message rather than silently showing no slots.

## Minimal Config

Suggested config shape:

```json
{
  "timezone": "Europe/Berlin",
  "sourceHosts": ["example.com"],
  "redirectHostAllowlist": ["example.com"],
  "notificationRecipientEmails": ["reservations@example.com"],
  "partySize": {
    "min": 1,
    "max": 8
  },
  "leadTimeMinutes": 120,
  "bookingHorizonDays": 60,
  "defaultDurationMinutes": 90,
  "cancellationCutoffMinutes": 120,
  "collectNotes": true,
  "weeklySchedule": [
    {
      "dayOfWeek": 5,
      "periods": [
        {
          "startTime": "17:00",
          "endTime": "22:00",
          "slotIntervalMinutes": 30,
          "maxConcurrentCovers": 28
        }
      ]
    }
  ],
  "dateOverrides": [
    {
      "date": "2026-12-24",
      "closed": true
    }
  ]
}
```

Keep v1 config intentionally small:

- no custom field builder
- no custom email-template editor
- no multiple areas/rooms
- no duration rules by table type
- no channel-specific quotas

The page itself can still carry restaurant-specific copy around the widget; that should not force the plugin config to become a CMS.

## Booking Lifecycle

V1 keeps the lifecycle explicit and small:

- `confirmed`
- `cancelled_by_guest`
- `cancelled_by_staff`
- `no_show`
- `completed`

Rules:

- booking creation is instant-confirm if the slot passes validation
- duplicate submits within a short dedupe window should resolve idempotently instead of creating duplicate bookings
- guests can cancel through a tokenized email flow until the configured cancellation cutoff
- after the cutoff, guest cancellation should render a "please contact the restaurant directly" response
- staff can still cancel from the authenticated admin page after the cutoff
- completed and no-show bookings remain in history and analytics but no longer consume capacity

## Notification Service

The notification service for v1 should mean transactional email, not multi-channel messaging.

### Guest emails

- booking confirmed
- booking cancelled

### Staff emails

- new booking created
- guest cancelled booking

Each email should include:

- restaurant/project name
- local date/time in the configured timezone
- party size
- guest contact details
- notes if present
- a guest cancellation link where relevant

### Deliberate limits

Do not include in v1:

- reminder emails
- SMS
- Slack or webhook fan-out
- approval emails with accept/decline actions
- custom template designer

Implementation rule:

- use the existing provider-agnostic backend email service
- do not roll back a successfully stored booking because an email send failed
- log delivery failures and keep the admin panel as the source of truth

## Public Runtime API

Use the same public-plugin routing model as Contact Form and Newsletter:

- `GET /plugins/table-booking/v1/availability`
- `POST /plugins/table-booking/v1/book`
- `GET /plugins/table-booking/v1/cancel`
- `POST /plugins/table-booking/v1/cancel`

### Availability request

Required query or body fields:

- `token`
- `date`
- `partySize`

Response:

- JSON list of available slots for fetch-based widgets
- HTML fallback page for the non-JS path

### Booking request

Required fields:

- `token`
- `date`
- `time`
- `partySize`
- `name`
- `email`
- `phone`

Optional fields:

- `notes`
- `_redirect`
- `_honeypot`
- `cf-turnstile-response`

Behavior:

1. Validate plugin token and enabled entitlement.
2. Validate `Origin` or `Referer` against project domains plus configured `sourceHosts`.
3. Validate booking-window rules and online party-size limits.
4. Re-check capacity in a DB transaction and insert the booking.
5. Send guest and staff emails.
6. Return JSON success or `303` redirect to an allowed success page.

### Cancellation flow

Do not make cancellation a destructive one-click `GET`.

Safer flow:

1. Email links to `GET /plugins/table-booking/v1/cancel?token=...`.
2. Backend renders a small confirmation page that shows the booking summary.
3. Final cancellation happens via `POST /plugins/table-booking/v1/cancel`.

This avoids accidental cancellations from link scanners and email preview bots.

## Admin Panel

V1 should ship a custom project page, not the generic JSON fallback page.

Suggested sections:

### Overview

- bookings today
- covers today
- upcoming bookings next 7 days
- cancellations and no-shows in trailing 7 or 30 days

### Agenda

- upcoming bookings grouped by service date and time
- quick scan of party size, guest name, phone, and status

### Booking list

Filters:

- status
- date range
- free-text search across name, email, and phone
- party-size range

Actions:

- cancel booking
- mark no-show
- mark completed

### Booking detail

- booking status
- guest details
- service date/time
- party size
- notes
- source host and source path
- created/cancelled/completed timestamps

### Config and snippets

- editable booking config
- generated HTML and Astro snippets
- availability and endpoint usage notes

### Export

- CSV export of filtered rows

What this page intentionally does not include in v1:

- drag-and-drop calendar
- manual reservation entry
- inline reschedule flow
- floor-plan views

## Read And Action Surface

V1 should stay as close as possible to the current generic plugin contracts.

### Reads

- `summary`
  - counts for today, upcoming, cancelled, no-show, completed
- `bookings`
  - filterable list with status, search, date range, limit, offset
- `agenda`
  - grouped upcoming bookings for a chosen day range

### Actions

- `cancel_booking <bookingId>`
- `mark_no_show <bookingId>`
- `mark_completed <bookingId>`

This is a deliberate scope choice. Manual create/edit/reschedule would require richer structured plugin mutations and should not be the reason to reintroduce plugin-specific host APIs.

## Proposed Data Model

### 1. Reuse existing plugin infrastructure

Use the existing:

- `project_plugin_instance`
- plugin entitlement model
- generic plugin catalog and config flows

### 2. New operational tables

#### `table_booking_reservation`

Suggested columns:

- `id`
- `organizationId`
- `projectSlug`
- `pluginInstanceId`
- `status`
- `serviceDate`
- `serviceStartAt`
- `serviceEndAt`
- `partySize`
- `guestName`
- `guestEmail`
- `guestEmailNormalized`
- `guestPhone`
- `notes`
- `sourceHost`
- `sourcePath`
- `referrerHost`
- `utmSource`
- `utmMedium`
- `utmCampaign`
- `lastIpHash`
- `confirmedAt`
- `cancelledAt`
- `cancelledBy`
- `completedAt`
- `noShowAt`
- `createdAt`
- `updatedAt`

Important indexes:

- by `organizationId + projectSlug + serviceStartAt`
- by `pluginInstanceId + serviceStartAt`
- by `pluginInstanceId + status + serviceDate`
- by normalized guest email for search support

#### `table_booking_action_token`

Suggested columns:

- `id`
- `reservationId`
- `organizationId`
- `projectSlug`
- `kind`
- `tokenHash`
- `expiresAt`
- `usedAt`
- `createdAt`

Initial token kinds:

- `guest_cancel`

### 3. Keep schedule and overrides in config JSON for v1

Do not add separate schedule tables in the first release.

Reasoning:

- service windows and date overrides are project configuration, not high-volume operational data
- config JSON keeps the initial implementation smaller
- if exception management becomes complex later, it can be split into dedicated tables without changing the booking rows

## Abuse Prevention And Hardening

The booking endpoint should be treated as a public transactional surface, not as a passive form.

Minimum hardening set:

- source-host allowlisting
- public token verification
- optional Turnstile using the existing entitlement pattern
- honeypot support
- per-token and per-IP rate limiting
- request body size limits
- duplicate-submit suppression for rapid retries
- transaction-safe capacity checks
- strict redirect-host validation
- timezone-aware validation for lead-time and cancellation-cutoff rules

This plugin will be more sensitive to race conditions than Contact Form, so concurrency correctness matters from day one.

## Fit To Current Vivd Plugin Architecture

The plan should follow the extracted-plugin direction already used by Contact Form, Analytics, and Newsletter:

- plugin-owned backend module, service, snippets, public routes, frontend page, CLI metadata, and shared project UI
- host-owned generic registry/routing/entitlement composition
- no plugin-specific top-level command trees
- no plugin-specific backend/frontend duplication for normal info/config/read/action flows

Important scoping decision:

- keep v1 inside the current generic `ensure/info/config/read/action` host contract
- do not add a special booking-only control-plane mutation API just to support manual edits in the first release

That makes the first version materially easier to ship without undoing the current registry cleanup.

## Docs And Rollout

When implemented, update:

- `packages/docs/src/content/docs/plugins.mdx`
- `packages/docs/src/content/docs/plugins/table-booking.mdx`

The public docs should frame the plugin as:

- a restaurant reservation widget and booking dashboard
- not a full restaurant operations suite

Suggested docs topics:

- when to use the plugin
- how to configure weekly service periods and closures
- how to embed the widget
- how cancellation emails work
- what is intentionally out of scope in v1

## Validation

Focused validation for implementation should include:

- `npm run typecheck -w @vivd/plugin-table-booking`
- `npm run typecheck -w @vivd/backend`
- `npm run typecheck -w @vivd/frontend`
- `npm run typecheck -w @vivd/cli`
- `npm run typecheck -w @vivd/installed-plugins`

Focused backend tests:

- availability generation
- overlap and covers calculation
- transaction-safe last-slot booking race
- lead-time and cancellation-cutoff validation
- source-host validation
- guest cancel token flow
- email notification trigger behavior

Focused frontend tests:

- booking summary rendering
- list filters and search
- action button state transitions
- snippet/config rendering

Focused contract tests:

- public availability and booking endpoints
- generic plugin `info/read/action` integration

## Implementation Phases

### Phase 1: Backend and data model

- add DB tables and migrations
- implement config schema and service-period validation
- add availability and booking endpoints
- add booking storage and cancellation token flow

### Phase 2: Plugin integration

- wire extracted plugin package into installed-plugin registries
- add info/config/read/action module surface
- add CLI descriptors and snippet/help output

### Phase 3: Frontend project page

- build overview, agenda, filters, detail, and config/snippet sections
- add CSV export
- wire generic plugin reads/actions

### Phase 4: Notification and docs polish

- add transactional email templates
- document launch workflow and troubleshooting
- verify published-site snippet behavior on HTML and Astro projects

## Deferred V2

- approval-based `request_only` mode
- manual booking create/edit/reschedule
- reminder emails
- waitlist support
- multiple rooms/areas with separate capacity
- table-map or floor-plan UI
- payments or deposits
- SMS or webhook notifications
- external reservation-system sync
- multiple venues per project

## Decision Summary

The right first version is:

- one extracted `table_booking` plugin
- instant-confirm reservations only
- seat-capacity availability instead of table mapping
- strong control-plane admin page for viewing and updating booking status
- transactional guest/staff email notifications
- guest self-cancel flow

That is narrow enough to ship cleanly in the current plugin architecture and broad enough to be a real production booking feature for restaurants.
