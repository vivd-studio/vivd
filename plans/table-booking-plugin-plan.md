# Table Booking Plugin Plan (Production-Ready V1)

Date: 2026-04-16  
Owner: plugins/product/backend/frontend  
Status: core v1 shipped; operator-capacity desk shipped; fullscreen operator view planned (UX-expanded)  
Last updated: 2026-04-18

## Implementation Note

The initial v1 is now live enough to cover the public booking path and a usable operator surface:

- extracted `plugins/native/table-booking` package
- public availability, booking, and guest-cancel endpoints
- weekly schedule plus date-override configuration
- calendar-first project page with booking search and basic status actions
- transactional guest/staff emails and generated install snippets

That said, the current dashboard still behaves more like a good control-plane admin page than a live in-restaurant service station.

The biggest remaining production gaps are:

- no fullscreen operator route that can stay open through service without the normal app chrome
- no at-distance, high-contrast presentation mode tuned for restaurant lighting and quick scanning
- no today-and-now-first operator layout for arrivals, occupancy, and quick updates
- no service-screen-specific reliability affordances such as visible last-refresh state and degraded-mode messaging

The recommended next implementation block should close those live-operation gaps before moving on to waitlist, reminders, multi-room inventory, or external sync.

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

## Recommended Next Work Block: Operator Capacity Desk

Treat the next slice as the first full **capacity-operations** release for Table Booking, not as a jump to table maps or hospitality-suite complexity.

Status: implemented on 2026-04-17 as the current operator-capacity desk release.

### Goal

Let project operators manage the venue's real working capacity from inside Vivd:

- include reservations that did not come from the website
- edit or move bookings without breaking capacity correctness
- reduce or hold back capacity for real-world operating constraints
- see remaining covers clearly enough to run service from the dashboard

This is the missing layer between "online booking widget" and "production-ready reservation operations".

### Why this should be next

- the current plugin already covers public booking, guest cancellation, and a decent calendar/search surface
- what it still cannot represent well is the offline demand that many restaurants handle by phone, walk-in holds, or staff-entered reservations
- as long as those bookings and capacity reductions live outside Vivd, the plugin does not actually show the restaurant's full availability picture
- this is the next meaningful product step that keeps the model simple enough to ship without drifting into floor plans, POS sync, or multi-room inventory

### In Scope

#### 1. Operator reservation management

- manual reservation create from the dashboard
- edit guest details, notes, party size, and reservation time
- reschedule a reservation using the same capacity and booking-window checks as the public flow
- cancel from the detail surface without leaving the calendar/list workflow
- track reservation source/channel such as `online`, `phone`, `walk_in`, or `staff_manual`
- optional guest-notification toggle for staff-created or staff-edited reservations so operators can send a confirmation/update only when appropriate

#### 2. Capacity controls

- add date/time-range capacity adjustments without rewriting the weekly base schedule
- reduce or hold back covers for staff shortages, private events, or walk-in reserve
- allow a service window to be temporarily closed from the same operator workspace
- store a short internal reason/note on each capacity adjustment
- make capacity changes immediately affect availability, occupancy, and booking validations

#### 3. Dashboard / operator controls

Add enough control-plane UX that the page becomes a real service desk instead of just a booking log.

Recommended additions:

- `Calendar / Day view`
  - occupancy summary for the selected date
  - booked covers vs effective capacity vs remaining covers per service window
  - visible capacity adjustments alongside date overrides
- `Reservation detail`
  - editable reservation form/drawer
  - change history context such as source, created-at, and last operator update
- `Bookings`
  - existing search/status filters
  - add source-channel filter
  - add CSV export of the filtered booking list
- `Overview`
  - covers booked today vs effective capacity
  - upcoming fully booked or near-capacity service windows

This is the part that makes the dashboard feel complete enough to manage the venue's real day-to-day capacity.

#### 4. Backend / architecture plan

- keep the booking logic plugin-owned and reuse the same transactional capacity checks for public and staff-entered reservations
- add structured plugin-owned mutations for:
  - `createReservation`
  - `updateReservation`
  - `rescheduleReservation`
  - `cancelReservation`
  - `createCapacityAdjustment`
  - `updateCapacityAdjustment`
  - `deleteCapacityAdjustment`
- do **not** broaden the generic host `ensure/info/config/read/action` contract yet just for this slice
- instead, use a thin table-booking compatibility router/adapter in the backend host while the mutation pattern is still plugin-specific

### Explicitly Out of Scope

- table maps or drag-and-drop floor plans
- multiple rooms/areas/sections with separate inventory
- waitlist queues
- reminder campaigns or SMS
- payments, deposits, or card holds
- OpenTable/Google/Apple/POS synchronization
- multi-venue support inside one project

### Proposed minimal data model

Keep the current reservation table as the main source of truth, but extend it for operator workflows:

- add reservation source/channel metadata
- add operator-owned audit fields such as `createdByUserId` / `updatedByUserId` when available
- support edited/rescheduled timestamps cleanly enough for UI history and notifications

Add a `table_booking_capacity_adjustment` table:

- `id text primary key`
- `organization_id text not null`
- `project_slug text not null`
- `plugin_instance_id text not null`
- `service_date text not null`
- `start_time text not null`
- `end_time text not null`
- `mode text not null` (`delta | override | closed`)
- `capacity_value integer null`
- `reason text null`
- `created_by_user_id text null`
- `created_at timestamp not null default now()`
- `updated_at timestamp not null default now()`

This keeps the capacity model simple:

- weekly schedule remains the baseline
- date overrides still replace a whole day when needed
- capacity adjustments become the operator tool for partial reductions/holds without forcing a table-map engine

### Backend plan

- extend the plugin service with manual reservation create/update/reschedule flows
- run the same validation stack for staff edits as for public bookings:
  - timezone-aware schedule resolution
  - party-size validation
  - lead-time / horizon checks where appropriate
  - transaction-safe overlap and cover checks
- allow staff-created reservations to bypass public source-host checks and guest-cancel token generation where that does not make sense
- add optional email behaviors:
  - send confirmation on staff create
  - send updated confirmation on staff reschedule/edit
  - keep email sending non-transactional so booking state remains the source of truth

### Frontend / operator plan

Extend the existing `TableBookingProjectPage` rather than replacing it.

Recommended surface changes:

- keep the calendar as the primary entry point
- add a proper selected-booking detail/editor workflow instead of read-only rows
- show slot/service-window occupancy bars or compact cover meters in the day panel
- add a dedicated capacity-adjustment editor from the selected day
- add booking export from the filtered list
- keep schedule setup and snippet/install flows in the same page so the plugin still feels like one control room

### CLI / agent plan

Keep generic info/read/config flows, but add operator-facing guidance for the new structured mutation surface.

The agent should:

- keep using generated snippets and config flows for site install/setup
- treat manual reservation creation and capacity adjustments as authenticated operator actions, never as public widget behavior
- prefer staff-entered reservations over telling operators to keep a parallel spreadsheet once this slice lands

## Exit Criteria For This Work Block

This block is done when all of the following are true:

1. A project operator can add a phone or walk-in reservation from the Vivd dashboard and see it immediately affect remaining capacity.
2. A reservation can be edited or rescheduled from the dashboard with the same overbooking protection as the public booking flow.
3. A project operator can reduce, hold back, or close capacity for a specific service window without rewriting the base weekly schedule.
4. The dashboard shows enough occupancy state to manage a service day: booked covers, effective capacity, remaining covers, and filtered booking export.
5. The plugin still deliberately stops short of table maps, multi-room inventory, waitlists, reminders, and third-party reservation sync.

## Recommended Next Work Block: Fullscreen Operator View

Treat the next slice as a dedicated **live service mode** for restaurant staff, not as another settings tab.

Status: planned on 2026-04-18.

### Goal

Let a restaurant keep Table Booking open on a host stand or service station during live service:

- fullscreen by default, outside the normal dashboard layout chrome
- optimized for quick scanning from a short distance
- safe to leave open for a whole shift with visible refresh/error state
- focused on today's occupancy and upcoming arrivals instead of setup/install tasks

The current operator-capacity desk already has the right data and mutations. This slice should change the operating surface, not rebuild the booking model.

### Why this should be next

- the plugin can now represent online, phone, walk-in, and staff-entered demand, but the current page still reads like an admin workspace
- restaurants need a screen they can leave open during service without exposing setup tabs, plugin install copy, or shell navigation
- live service needs stronger readability than the current muted control-plane presentation, especially in mixed or harsh lighting
- this is a higher-value next step than jumping to waitlists or table maps because it makes the existing booking/capacity work usable in the room

### In Scope

#### 1. Route and ownership plan

- add a fullscreen operator route outside `Layout`, guarded the same way as other project fullscreen surfaces
- use a generic host-mounted plugin route, for example `/vivd-studio/projects/:projectSlug/plugins/:pluginId/operator`, instead of a table-booking-only host special case
- extend the frontend plugin registry with an optional plugin-owned operator/fullscreen page export so the host stays generic while the table-booking UI stays plugin-owned
- add an `Open operator view` entry point from the existing `TableBookingProjectPage`

#### 2. Live operator surface

- default to `today` and bias the layout toward `now`, `next arrivals`, and `selected service window`
- keep the existing calendar/day-capacity model, but present it as a service board rather than a settings tab
- show current and upcoming service windows with booked covers, effective capacity, remaining covers, and active adjustments
- keep quick actions close to the data: add reservation, edit reservation, cancel, mark no-show, mark completed
- keep manual reservation and capacity-adjustment drawers/sheets available from the operator surface
- keep setup, install, and long-range configuration work on the normal plugin page instead of duplicating it here

#### 3. Service presentation mode (contrast + lighting)

Restaurant lighting is not uniform. Brunch is bright, dinner is dim, and the same stand may get both in one day. Treat "high contrast" as a **presentation mode**, not a single toggle.

- expose three presentation modes, driven by the same operator-view-local CSS-variable layer:
  - `normal` — matches the rest of the dashboard
  - `hc-light` — boosted contrast for bright/harsh lighting
  - `hc-dark` — boosted contrast for dim evening service (high contrast on a dark surface, so the screen is not a glare source)
- persist the selected mode in browser storage for that surface
- support deep-link/default activation through a query flag such as `?mode=hc-dark`, and honor `prefers-contrast: more` and `prefers-color-scheme: dark` when available as the initial defaults
- implement all three modes as operator-view-local CSS variables/classes rather than a global theme-contract rewrite
- increase contrast on text, borders, focus rings, and action states across all non-normal modes; reduce dependence on muted text
- make status readable without color alone by keeping explicit labels/icons and stronger structural separation
- commit to explicit sizing rather than "slightly larger":
  - minimum touch target 44px; primary service actions 48px
  - reservation row height large enough to read name + time + party size from roughly 1.5m away
  - target viewport is a 10–13" tablet in landscape at a host stand; the layout must stay usable in portrait without horizontal scroll

#### 3b. Destructive-action safety at the stand

Staff tap fast, often with messy or gloved hands. Modal confirms slow service; missing undo is worse.

- for `cancel_booking`, `mark_no_show`, and `mark_completed`, perform the action optimistically and show a persistent undo toast for ~8 seconds
- undo should reverse the status change through the existing action surface, not by creating a new booking
- only show a modal confirm when the action is irreversible in context (for example cancelling past the guest cancellation cutoff with notifications enabled)
- keep destructive and non-destructive actions visually distinct even in HC modes — do not rely on a red tint alone

#### 3c. Incoming-booking awareness

Audio is intentionally out of scope, but staff still need to notice a new online booking between polls.

- track the most recent booking id/timestamp the operator has seen on this surface
- on each refresh, show a "N new since you looked" pill near the arrivals list when the set grows
- pulse or tint the new rows for a few seconds after they appear, then settle to the normal row style
- clearing the indicator is automatic once the operator interacts with the arrivals list
- do not use this pattern for edits or cancellations originating from the same operator session

#### 3d. Screen wake and session durability

A stand tablet left open for a full shift will otherwise sleep, lock, or re-auth.

- request a Screen Wake Lock (`navigator.wakeLock.request("screen")`) when the operator surface is visible, and release on unmount / tab hide
- re-acquire the lock after visibility changes (the browser drops it when the tab goes background)
- surface a small, dismissible note if the wake lock request fails (some browsers require a user gesture or HTTPS), so operators know the screen may sleep and can keep settings open as a workaround

#### 3e. Freshness signaling

The `last updated` timestamp alone is weak at scanning distance.

- color the timestamp by staleness relative to the polling cadence:
  - fresh (<1 poll interval): neutral
  - warm (1–2 intervals): amber
  - stale (>2 intervals or refresh error): red, plus the degraded banner
- pair the timestamp with a small relative label (`just now`, `32s ago`) for quick read
- the manual refresh control should live next to the timestamp, not in a settings menu

#### 3f. Quick-add defaults for the host stand

Manual reservation is the hot path during phone calls.

- opening the "add reservation" drawer from the operator surface should pre-fill:
  - date = today
  - time = next available slot in the current/next service window
  - party size = 2
  - source channel = `phone`
  - send-guest-notification = off by default for phone entries (staff will confirm verbally)
- keep the drawer's focus on the name field so the operator can start typing immediately
- preserve any in-progress drawer across background data refreshes

#### 4. Live refresh and reliability

- reuse the current polling model as the first slice instead of introducing websockets
- keep the current `30s` data refresh baseline, but add a visible `last updated` timestamp plus a manual refresh action
- show a clear degraded/offline banner when a refresh fails so operators know the board may be stale
- preserve open drawers/forms across background refreshes where practical
- keep live updates scoped to today/day-capacity and booking lists rather than reloading unrelated setup/install data

#### 5. Frontend / implementation plan

- extract the current booking/capacity query orchestration out of `TableBookingProjectPage.tsx` into a shared hook or model so the standard page and fullscreen operator view do not duplicate fetch/mutation wiring
- create a dedicated plugin-owned surface such as `TableBookingOperatorPage.tsx` plus focused components under `tableBookingOperatorPage/*`
- reuse the established fullscreen framing primitives in `packages/frontend/src/components/common/FramedHostShell.tsx` rather than inventing a new host shell
- keep the host changes thin and generic:
  - route helper in `packages/frontend/src/app/router/paths.ts`
  - fullscreen route wiring in `packages/frontend/src/app/router/routes.tsx`
  - optional plugin UI type/registry extension in `packages/frontend/src/plugins/types.ts` and `packages/frontend/src/plugins/registry.tsx`

### Explicitly Out of Scope

- websocket/live-push infrastructure
- audio alerts or printer integrations
- offline-first/PWA behavior
- table maps or table assignment
- multi-room inventory
- waitlist workflows
- reminder campaigns, deposits, or external sync

### Exit Criteria For This Work Block

This block is done when all of the following are true:

1. A restaurant can open a dedicated fullscreen operator route for Table Booking and use it without the normal dashboard layout chrome.
2. The operator surface shows today's service state clearly enough to run live: current/upcoming windows, booked covers, effective capacity, remaining covers, and upcoming reservations.
3. Staff can still create/edit reservations and run the current status actions from that fullscreen surface without navigating back to the normal plugin page.
4. Three presentation modes (`normal`, `hc-light`, `hc-dark`) exist, persist for that surface, respect `prefers-contrast`/`prefers-color-scheme` defaults, and materially increase readability in both bright and dim lighting.
5. Refresh failures are explicit on screen, the `last updated` timestamp is color-coded by staleness, and operators can manually refresh without losing their place.
6. Destructive status actions (cancel / no-show / completed) are reversible via an undo toast rather than modal confirms, and remain visually distinct in all three modes.
7. New online bookings that arrive between polls are announced with a visible "N new" indicator on the arrivals list and do not require the operator to remember what they saw last.
8. The operator surface requests a Screen Wake Lock while visible and re-acquires it after visibility changes, so a stand tablet can run a full shift without manual interaction.
9. Manual reservation entry from the operator surface pre-fills today / next available slot / party of 2 / phone channel / notifications off, so a phone booking takes only name + phone + confirm.

## Recommended Future Work After This Block

- reminder emails
- waitlist mode
- multiple rooms/areas with separate capacity pools
- table-map / floor-plan UI
- external reservation-system sync
- deposits/payments and no-show protection
- multi-venue support

## Deferred V2

- approval-based `request_only` mode
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
