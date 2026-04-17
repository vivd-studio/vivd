# Newsletter / Waitlist Plugin Plan (MVP-First)

Status: Initial v1 implemented; broadcast execution slice partly implemented; further ops controls planned  
Last updated: 2026-04-17

## Implementation Note

The initial shipped scope matches the core audience-capture plan:

- extracted `plugins/native/newsletter` package
- public subscribe/confirm/unsubscribe endpoints
- double opt-in confirmation and one-click unsubscribe
- project operator UI for list/search/export and small manual actions
- generic CLI/backend/frontend/Studio plugin integration

The current implementation now covers the first real broadcast-execution slice:

- draft campaign storage for newsletter broadcasts
- campaign read/action surface through the generic plugin APIs
- project-page UI for drafting subject/body/audience and sizing the current confirmed audience
- test-send action from the dashboard and generic action API
- queued background send execution with per-recipient delivery rows
- cancel control for queued or in-flight campaigns
- campaign history/status/delivery aggregate counts in the project UI

The remaining recommended work in the broader **broadcast operations** phase is now narrower:

- expand the project dashboard so operators can see audience health and usage/capacity, not just raw subscriber rows
- add richer delivery-detail reads/views and failure drill-down
- add subscriber mode/source filters and segmented exports
- keep the scope to one-off broadcasts plus delivery observability, without drifting into automations or ESP-style complexity

Still intentionally not shipped in this slice:

- monthly signup usage/capacity cards
- subscriber mode/source-host filters
- dedicated delivery-detail read/API surface
- scheduling, automations, rich segmentation, or ESP sync

One planned abuse-control item is intentionally deferred from this first cut:

- Turnstile is not wired yet for `newsletter`; the current shipped v1 relies on source-host allowlisting, honeypot handling, request caps, and per-token/IP rate limiting, so `listUi.supportsTurnstile` currently remains `false`

## Goal

Ship a first-party `newsletter` plugin that is production-usable for both newsletter signup and waitlist capture without turning v1 into a full email marketing product.

The plugin should follow the current extracted-plugin model used by Analytics and Contact Form:

- superadmin-owned entitlement and quota controls
- package-owned backend/frontend/CLI contributions
- static-site-friendly public endpoints
- deterministic install snippets and instructions the agent can use through the generic `vivd plugins ...` surface

## Recommendation

Treat this as one plugin with two copy/UX modes:

- plugin id: `newsletter`
- display name: `Newsletter / Waitlist`
- project config mode: `"newsletter" | "waitlist"`

Reasoning:

- the runtime, data model, confirmation flow, unsubscribe flow, snippets, and operator UI are the same
- the difference between newsletter and waitlist is mostly copy, placement, and how the list is used later
- splitting into separate `newsletter` and `waitlist` plugins now would duplicate almost all of the implementation without adding real product value

This plugin should be positioned as an **audience capture** plugin, not as a full ESP.

## Product Boundary

### What v1 must do

1. Collect signups reliably from published/static/Astro sites.
2. Keep the list clean and compliant with double opt-in by default.
3. Give project operators a real list-management surface inside Vivd.
4. Make it easy for the agent to install and verify on generated sites.
5. Let teams export confirmed subscribers to an external sending tool.

### What v1 must not try to do

- campaign authoring or sending
- drip automations
- segmentation and tagging systems
- referral programs
- invite queues, priority ranking, or seat-allocation logic
- direct Mailchimp/Resend/ConvertKit/etc syncs
- arbitrary custom form-builder fields
- multi-list management inside one project

If Vivd later needs actual email sending, that should be a second phase on top of this subscriber lifecycle, not part of the initial plugin launch.

## MVP Value Order

1. Reliable signup capture with strong abuse controls.
2. Double opt-in confirmation and one-click unsubscribe.
3. Operator UI for search, filter, export, and small manual actions.
4. Clean install snippets and CLI/agent discoverability.
5. Basic acquisition context capture so the list is not just raw email addresses.

## Proposed Plugin Shape

Create a new extracted package:

- `plugins/native/newsletter`

Initial package shape should mirror the extracted plugins already in the repo:

- `src/manifest.ts`
- `src/backend/plugin.ts`
- `src/backend/module.ts`
- `src/backend/contribution.ts`
- `src/backend/service.ts`
- `src/backend/config.ts`
- `src/backend/snippets.ts`
- `src/backend/publicApi.ts`
- `src/backend/http/subscribe.ts`
- `src/backend/http/confirm.ts`
- `src/backend/http/unsubscribe.ts`
- `src/frontend/plugin.ts`
- `src/frontend/module.ts`
- `src/frontend/NewsletterProjectPage.tsx`
- `src/cli/plugin.ts`
- `src/cli/module.ts`
- `src/shared/projectUi.ts`
- `src/shared/summary.ts`

Host apps should stay generic:

- backend/frontend/CLI/studio registries consume package-owned exports
- backend keeps only thin compatibility wrappers where custom tRPC is still needed
- plugin code must not import backend internals from `@vivd/backend/src/...`

If rate-limit helpers, token helpers, or Turnstile verification need reuse from Contact Form, extract a small generic helper instead of reaching into contact-form-specific files.

## Proposed Definition

Suggested definition shape:

- `pluginId`: `newsletter`
- `name`: `Newsletter / Waitlist`
- `description`: `Capture confirmed newsletter subscribers or waitlist signups for your project.`
- `category`: `marketing`
- `sortOrder`: `30`
- `defaultEnabledByProfile.solo`: `true`
- `defaultEnabledByProfile.platform`: `false`
- `listUi.projectPanel`: `custom`
- `listUi.usageLabel`: `Signups`
- `listUi.limitPrompt`: `Set monthly signup limit.\nLeave empty for unlimited.`
- `listUi.supportsMonthlyLimit`: `true`
- `listUi.supportsHardStop`: `true`
- `listUi.supportsTurnstile`: `false` for the initial shipped v1, with generic Turnstile support deferred until the challenge surface is extracted cleanly from Contact Form
- `listUi.dashboardPath`: `null`

Capabilities:

- `supportsInfo: true`
- config `show/apply/template`: yes
- actions:
  - `resend_confirmation <email>`
  - `mark_confirmed <email>`
  - `unsubscribe <email>`
- reads:
  - `summary`
  - `subscribers`

The generic actions stay intentionally small. Richer operator flows such as export and filtered browsing can live in the custom project page plus a thin compatibility router.

## Subscriber Lifecycle

V1 should keep the lifecycle explicit and boring:

- `pending`
  - signup received
  - confirmation email sent
  - not counted as active subscriber yet
- `confirmed`
  - email owner completed confirmation
  - included in normal export and list counts
- `unsubscribed`
  - explicitly opted out
  - kept as a suppression state, not hard-deleted by default
- `bounced`
  - confirmation email hard-bounced or repeatedly failed
- `complained`
  - recipient complaint or equivalent suppression signal

Rules:

- double opt-in is always on in v1
- repeated submits for an already confirmed subscriber are idempotent success
- repeated submits for a pending subscriber can resend confirmation subject to cooldown
- an unsubscribed subscriber can rejoin only by submitting the form again and reconfirming
- bounced or complained subscribers should not be silently reactivated by an operator action

## Minimal Config

Keep the project config intentionally small:

```json
{
  "mode": "newsletter",
  "collectName": false,
  "sourceHosts": ["example.com"],
  "redirectHostAllowlist": ["example.com"]
}
```

Recommended v1 schema:

- `mode: "newsletter" | "waitlist"`
- `collectName: boolean`
- `sourceHosts: string[]`
- `redirectHostAllowlist: string[]`

What is intentionally missing from v1:

- custom arbitrary fields
- custom email template editing
- multiple lists
- tags/segments
- provider sync settings

Site-level form copy and placement can vary by snippet and page content without turning the plugin config into a marketing-CMS.

## Public Runtime API

Use the same public-plugin model as Contact Form:

- `POST /plugins/newsletter/v1/subscribe`
- `GET /plugins/newsletter/v1/confirm`
- `GET /plugins/newsletter/v1/unsubscribe`

Supported request formats:

- `application/x-www-form-urlencoded`
- `application/json`

Required subscribe fields:

- `token`
- `email`

Optional subscribe fields:

- `name`
- `_redirect`
- `_honeypot`
- `cf-turnstile-response`

Behavior:

1. Validate plugin token and enabled entitlement.
2. Validate `Origin` or `Referer` host against:
   - published domains
   - tenant/project hostnames
   - configured `sourceHosts`
   - local-dev allowlist
3. Apply abuse controls:
   - per-token and per-IP rate limiting
   - honeypot check
   - request size caps
   - optional Turnstile verification
4. Create or update the subscriber row.
5. Generate a short-lived confirmation token and send the confirmation email.
6. Return either JSON success or a `303` redirect.

Confirmation behavior:

- confirmation tokens should be hashed at rest
- successful confirmation sets status to `confirmed`
- if a redirect is configured/allowed, use it
- otherwise render a small default confirmation page from the backend

Unsubscribe behavior:

- unsubscribe link is tokenized and one-click
- successful unsubscribe sets status to `unsubscribed`
- use the same redirect-or-default-page model

## Proposed Data Model

### 1. Reuse existing plugin infrastructure

- `project_plugin_instance`
- `plugin_entitlement`

`plugin_entitlement.plugin_id` migrations will need to include `newsletter`.

### 2. Add subscriber table

Add `newsletter_subscriber`:

- `id text primary key`
- `organization_id text not null`
- `project_slug text not null`
- `plugin_instance_id text not null`
- `email text not null`
- `email_normalized text not null`
- `name text null`
- `status text not null`
- `mode text not null`
- `source_host text null`
- `source_path text null`
- `referrer_host text null`
- `utm_source text null`
- `utm_medium text null`
- `utm_campaign text null`
- `utm_content text null`
- `utm_term text null`
- `last_confirmation_sent_at timestamp null`
- `confirmed_at timestamp null`
- `unsubscribed_at timestamp null`
- `created_at timestamp not null default now()`
- `updated_at timestamp not null default now()`

Indexes:

- unique `(plugin_instance_id, email_normalized)`
- `(organization_id, project_slug, status, created_at)`
- `(plugin_instance_id, created_at)`
- `(plugin_instance_id, confirmed_at)`

### 3. Add token table

Add `newsletter_action_token`:

- `id text primary key`
- `subscriber_id text not null`
- `organization_id text not null`
- `project_slug text not null`
- `kind text not null` (`confirm | unsubscribe`)
- `token_hash text not null`
- `expires_at timestamp not null`
- `used_at timestamp null`
- `created_at timestamp not null default now()`

This keeps public links revocable, auditable, and easy to rotate without storing raw tokens.

## Usage Metric and Entitlements

Use the existing entitlement model:

- project or organization scope
- monthly event limit
- hard stop
- optional Turnstile configuration

For this plugin, `usageThisMonth` should mean:

- count each transition into a new active signup flow once
- specifically: new rows created as `pending`, plus unsubscribed rows re-entering `pending`
- do not count repeated submissions from already pending or already confirmed addresses

This keeps quotas tied to meaningful signup attempts instead of spam retries.

## Backend Plan

Plugin-owned backend service should cover:

- ensure/get plugin instance
- build public snippets and install instructions
- normalize and validate config
- subscribe flow
- confirm flow
- unsubscribe flow
- list/search/filter subscribers
- compute summary counts
- CSV export payload generation

Expected backend pieces:

- config validation in `config.ts`
- runtime/service orchestration in `service.ts`
- public endpoint composition in `http/*`
- snippet generation in `snippets.ts`
- public base-URL helpers in `publicApi.ts`
- package contribution creation in `contribution.ts`

Email behavior:

- send confirmation emails through the existing backend `EmailDeliveryService`
- keep provider specifics out of the plugin package
- confirmation copy can be generic but should use project title and plugin mode

Deliverability hardening:

- if existing backend feedback plumbing can be generalized cheaply, use it
- otherwise do not block v1 on bounce/complaint webhooks, but leave clear extension points for `bounced` and `complained` states

## Frontend Project UI

Use a custom plugin page, not a generic config-only page.

Recommended sections:

- `Overview`
  - confirmed subscribers
  - pending confirmations
  - unsubscribed/suppressed count
  - new signups in last 7/30 days
- `Subscribers`
  - search by email/name
  - filter by status
  - paginated list
  - row actions: resend confirmation, mark confirmed, unsubscribe
- `Install`
  - HTML snippet
  - Astro snippet
  - notes about token, expected fields, and allowed hosts
- `Export`
  - CSV download for confirmed-only or all statuses
- `Settings`
  - mode
  - collect-name toggle
  - source-host allowlist
  - redirect-host allowlist

The first UI should prioritize operator usefulness over charts. Tables, badges, counters, and good empty states are enough.

## CLI and Agent Surface

Do not add a custom OpenCode-only tool for this plugin.

The agent should use the existing generic surfaces:

- `vivd plugins catalog`
- `vivd plugins info newsletter`
- `vivd plugins config template newsletter`
- `vivd plugins config apply newsletter --file ...`
- `vivd plugins action newsletter resend_confirmation <email>`
- `vivd plugins action newsletter mark_confirmed <email>`
- `vivd plugins action newsletter unsubscribe <email>`
- `vivd plugins read newsletter summary`
- `vivd plugins read newsletter subscribers --file query.json`

Plugin-owned CLI help should make install and operations obvious:

- install snippet guidance
- status meanings
- common action examples
- export guidance

This keeps the plugin aligned with the repo direction that the generic `vivd` CLI is the primary connected-runtime surface.

## Snippets

Ship two snippet variants in the info payload:

- plain HTML form
- Astro component-friendly form

V1 form fields:

- always: `email`
- optional: `name` when `collectName=true`

Waitlist mode should only change copy defaults, for example:

- heading/button text
- confirmation email wording
- confirmation page wording

It should not introduce a different runtime contract.

## Delivery Slices

### Slice 1: Foundation

1. Add DB tables and plugin-id migration updates.
2. Scaffold `plugins/native/newsletter`.
3. Implement manifest, definition, config, backend service, snippets, and public routes.
4. Wire backend/frontend/CLI/studio registries and package dependencies.
5. Add superadmin entitlement support and monthly usage counting.

Exit criteria:

- a project can enable the plugin
- the agent can fetch install info/snippets through `vivd plugins info newsletter`
- a visitor can sign up, confirm, and unsubscribe

### Slice 2: Operator UI

1. Add custom project page with overview and subscriber list.
2. Add search/filter/pagination.
3. Add row actions and CSV export.
4. Add CLI renderers for info/config/action/read flows.

Exit criteria:

- project operators can manage the list without raw SQL
- confirmed subscribers can be exported cleanly

### Slice 3: Hardening

1. Reuse or extract Turnstile verification if not already in Slice 1.
2. Tighten rate limiting and cooldown logic.
3. Add bounce/complaint integration if the existing feedback path can be generalized cleanly.
4. Add public docs in `packages/docs` once the implementation lands.

Exit criteria:

- the plugin is safe enough to expose on public launch pages without obvious spam or compliance gaps

## Recommended Next Work Block: Broadcast Operations

Treat this as the first complete outbound release for the plugin, not as a jump to “full ESP”.

### Goal

Let project operators manage the full practical lifecycle of a newsletter or waitlist announcement from inside Vivd:

- understand current audience health and usage/capacity
- prepare or revise a campaign draft
- send a test message
- launch a one-off broadcast safely
- monitor progress/results from the same dashboard
- cancel remaining queued delivery when needed

### Why this should be the next block

- the plugin already has real audience capture and the beginnings of campaign authoring
- the next meaningful product step is to make the campaign side actually operational
- this is also the point where the dashboard should stop being “list + draft form” and become a small control room for the plugin
- this scope is large enough to be truly useful in production, but still narrow enough to avoid turning the plugin into a full marketing suite

### In Scope

#### 1. Campaign send lifecycle

- one-off broadcasts to `confirmed` subscribers only
- explicit `draft -> review -> test-send -> queued -> sending -> sent/failed/canceled` lifecycle
- test-send to the operator’s own email before the real send
- send confirmation step that shows the final frozen recipient count before launch
- cancel action that stops future unsent batches, even if part of the campaign has already gone out

#### 2. Safe delivery execution

- batch/background delivery instead of sending inline from an HTTP request
- frozen recipient snapshot at send time by materializing delivery rows before sending
- suppression of `unsubscribed`, `bounced`, and `complained` recipients
- unsubscribe footer/link on every campaign
- plain-text fallback alongside HTML output
- provider-neutral delivery through the existing backend `EmailDeliveryService`

#### 3. Dashboard / operator controls

Add enough dashboard control that a project owner can run the plugin day to day without exporting to spreadsheets first.

Recommended additions:

- `Overview`
  - confirmed subscribers
  - pending confirmations
  - suppressed subscribers
  - monthly signup usage vs entitlement limit
  - recent campaign count / last send status
- `Campaigns`
  - draft list plus send history
  - test-send action
  - send confirmation dialog
  - live counts for queued / sent / failed / skipped / canceled
  - campaign detail view with failure samples/reasons
- `Subscribers`
  - existing status filter
  - add `mode` filter (`newsletter` vs `waitlist`)
  - add `source host` filter
  - add segmented export actions for confirmed / pending / suppressed slices

This is the part that makes the dashboard feel complete enough to actually operate the plugin.

#### 4. Campaign observability

- per-campaign aggregate counts for queued, sent, failed, skipped, canceled
- last error summary and sample failure reasons
- sent-at / completed-at timestamps
- campaign detail read surface for the dashboard and CLI

### Explicitly Out of Scope

- drip/automation builders
- visual email builders
- segmentation beyond `all_confirmed` and `mode_confirmed`
- A/B testing
- scheduled sends or send-time optimization
- external ESP sync as a required dependency
- CSV import of external lists
- multi-list management inside one project
- manual reactivation of suppressed subscribers from the dashboard
- webhook-driven bounce/complaint synchronization if that cannot be generalized cheaply from the existing email stack

### Proposed minimal data model

Extend the current `newsletter_campaign` draft foundation rather than replacing it.

Recommended additional fields:

- `id text primary key`
- `organization_id text not null`
- `project_slug text not null`
- `plugin_instance_id text not null`
- `mode text not null` (`newsletter | waitlist`)
- `status text not null` (`draft | queued | sending | sent | failed | canceled`)
- `subject text not null`
- `body text not null` for the editable source body already in place
- `body_html text null`
- `body_text text null`
- `audience text not null` (`all_confirmed | mode_confirmed`)
- `recipient_count integer not null default 0`
- `test_sent_at timestamp null`
- `queued_at timestamp null`
- `started_at timestamp null`
- `completed_at timestamp null`
- `canceled_at timestamp null`
- `last_error text null`
- `created_by_user_id text null`
- `created_at timestamp not null default now()`
- `updated_at timestamp not null default now()`

Add a `newsletter_campaign_delivery` table:

- `id text primary key`
- `campaign_id text not null`
- `subscriber_id text not null`
- `organization_id text not null`
- `project_slug text not null`
- `status text not null` (`queued | sending | sent | failed | skipped | canceled`)
- `provider_message_id text null`
- `skip_reason text null`
- `failure_reason text null`
- `sent_at timestamp null`
- `created_at timestamp not null default now()`
- `updated_at timestamp not null default now()`
- unique `(campaign_id, subscriber_id)`

### Backend plan

- keep campaign authoring plugin-owned and extend the existing service/module rather than adding host-specific side routes
- add plugin-owned service methods for:
  - `testSendCampaign`
  - `sendCampaign`
  - `cancelCampaign`
  - `getCampaign`
  - `listCampaignDeliveries`
- build HTML + text payloads from the stored draft body using the shared branded email template/footer system
- when a campaign is sent:
  - compute the current eligible recipients
  - create frozen delivery rows immediately
  - store the final `recipient_count`
  - transition the campaign to `queued`
- process deliveries in bounded background batches
- update campaign aggregate counts after each batch so the dashboard can poll for progress
- skip recipients who become suppressed before their batch actually sends
- keep real post-send bounce/complaint webhook synchronization as a follow-up if the feedback path cannot be reused cleanly; do not block this work block on that integration

### Frontend / operator plan

Add a `Campaigns` section to the existing Newsletter project page:

- campaign list with status, recipient count, timestamps, and outcome counts
- existing draft form with subject + body
- existing audience selector:
  - `all confirmed`
  - `confirmed for current mode`
- test-send action
- send confirmation step showing final recipient count
- delivery detail view with failure counts/reasons
- cancel control for queued/sending campaigns

Extend the rest of the project page with small but important operating controls:

- overview cards for audience health and monthly signup usage/capacity
- subscriber filters for `mode` and `source host`
- segmented exports for confirmed / pending / suppressed
- clearer sent-history vs draft-history separation so operators do not lose track of what actually went out

### CLI / agent plan

Keep the same generic plugin surface:

- `vivd plugins read newsletter campaigns`
- `vivd plugins read newsletter campaign_deliveries --file input.json`
- `vivd plugins action newsletter test_send_campaign <campaignId>`
- `vivd plugins action newsletter send_campaign <campaignId>`
- `vivd plugins action newsletter cancel_campaign <campaignId>`

The agent should:

- continue defaulting to `mode=waitlist` snippets when the user asked for a waitlist
- default campaign audience to `mode_confirmed` when the project itself is in waitlist mode unless the user asks otherwise
- treat `send_campaign` and `cancel_campaign` as ask-first, clearly operational actions

## Testing Plan

Backend:

- service tests for `testSendCampaign`, `sendCampaign`, `cancelCampaign`, frozen recipient snapshot creation, and aggregate count updates
- batch-processor tests for retry-safe progression and partial-send cancellation
- delivery query tests for status filtering and failure/skip reporting
- existing lifecycle tests for subscribe/confirm/unsubscribe should stay green

Frontend:

- campaign flow tests for draft -> test-send -> send confirmation -> progress/history
- overview/usage card rendering tests
- subscriber mode/source filter tests
- sent-history pagination/detail tests

CLI:

- help and formatter coverage for campaign reads/actions
- send/cancel/test-send renderers

Integration:

- focused end-to-end path: signup -> confirm -> visible in audience -> campaign test-send -> real send -> delivery counts visible in dashboard
- focused end-to-end path: queued campaign canceled mid-run stops future batches cleanly

## Exit Criteria For This Work Block

This block is done when all of the following are true:

1. A project operator can create a draft, send a test email, and launch a one-off broadcast entirely from the Vivd dashboard.
2. A sent campaign creates a frozen recipient snapshot and runs in batches outside the request path.
3. The dashboard shows enough operational state to manage the plugin in production: audience health, monthly signup usage/capacity, campaign history, and delivery outcomes.
4. A queued or partially processed campaign can be canceled without corrupting campaign state.
5. The plugin still deliberately stops short of automations, scheduling, complex segmentation, and ESP sync.

## Recommended Future Work After This Block

- CSV import for existing lists
- provider syncs or outbound webhooks on confirmed signup/unsubscribe
- webhook-driven bounce/complaint sync if not already generalized
- richer audience segments/tags
- scheduled or recurring campaigns
- automation/drip sequences
- list segmentation/tags
- basic acquisition reporting and analytics integration
- waitlist rank/invite flows
- richer sending features after the broadcast-first phase 2 (scheduling, automation, templates, A/B tests)
