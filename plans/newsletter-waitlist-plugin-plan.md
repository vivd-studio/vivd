# Newsletter / Waitlist Plugin Plan (MVP-First)

Status: Initial v1 implemented; phase-2 draft foundation started  
Last updated: 2026-04-16

## Implementation Note

The initial shipped scope matches the core audience-capture plan:

- extracted `plugins/native/newsletter` package
- public subscribe/confirm/unsubscribe endpoints
- double opt-in confirmation and one-click unsubscribe
- project operator UI for list/search/export and small manual actions
- generic CLI/backend/frontend/Studio plugin integration

The next broadcasting slice has now started with campaign-draft foundations:

- draft campaign storage for newsletter broadcasts
- campaign read/action surface through the generic plugin APIs
- project-page UI for drafting subject/body/audience and sizing the current confirmed audience

Still intentionally not shipped in this slice:

- real batched outbound send execution
- test-send delivery
- per-recipient delivery rows and send-state processing

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

## Proposed Phase 2: Outbound Sending

Treat sending as a narrow follow-up phase, not a jump to “full ESP”.

### Goal

Let project operators send one-off broadcast emails to confirmed subscribers from inside Vivd, while keeping the product surface operationally simple and deliverability-safe.

### What Phase 2 should include

- one-off broadcasts to `confirmed` subscribers only
- a draft -> review -> send flow
- test-send to operator email before the real send
- batch/background delivery instead of sending inline from an HTTP request
- per-campaign counts for queued, sent, failed, bounced, complained, unsubscribed
- automatic unsubscribe link/footer on every campaign
- suppression of `unsubscribed`, `bounced`, and `complained` recipients
- provider-neutral delivery through the existing backend `EmailDeliveryService`

### What Phase 2 should still exclude

- drip/automation builders
- visual email builders
- segmentation beyond small explicit filters
- A/B testing
- send-time optimization or scheduling systems
- external ESP sync as a required dependency

### Proposed minimal data model

Add a `newsletter_campaign` table:

- `id text primary key`
- `organization_id text not null`
- `project_slug text not null`
- `plugin_instance_id text not null`
- `mode text not null` (`newsletter | waitlist`)
- `status text not null` (`draft | queued | sending | sent | failed | canceled`)
- `subject text not null`
- `body_json jsonb not null`
- `body_html text null`
- `body_text text null`
- `recipient_filter jsonb not null`
- `recipient_count integer not null default 0`
- `queued_at timestamp null`
- `started_at timestamp null`
- `completed_at timestamp null`
- `created_by_user_id text null`
- `created_at timestamp not null default now()`
- `updated_at timestamp not null default now()`

Add a `newsletter_campaign_delivery` table:

- `id text primary key`
- `campaign_id text not null`
- `subscriber_id text not null`
- `organization_id text not null`
- `project_slug text not null`
- `status text not null` (`queued | sent | failed | bounced | complained | skipped`)
- `provider_message_id text null`
- `failure_reason text null`
- `sent_at timestamp null`
- `updated_at timestamp not null default now()`
- unique `(campaign_id, subscriber_id)`

### Backend plan

- add plugin-owned campaign create/list/get/send/cancel service methods
- reuse the existing email template/footer system so branding and unsubscribe behavior stay consistent
- enqueue delivery rows when a campaign is sent, then process them in batches from a plugin-owned background job
- send only to a frozen recipient snapshot for that campaign, not to the live list mid-send
- stop sending to recipients who become suppressed before their batch is processed
- feed bounce/complaint signals back into both deliverability state and subscriber suppression

### Frontend / operator plan

Add a `Campaigns` section to the existing Newsletter project page:

- campaign list with status and counts
- new draft form with subject + body
- small audience selector:
  - all confirmed subscribers
  - confirmed subscribers for the current `mode`
- test-send action
- send confirmation step showing final recipient count
- delivery detail view with failure counts/reasons

### CLI / agent plan

Keep the same generic plugin surface:

- `vivd plugins read newsletter campaigns`
- `vivd plugins action newsletter send_campaign <campaignId>`
- `vivd plugins action newsletter cancel_campaign <campaignId>`

The agent should only generate/send campaigns after confirming the user actually wants Vivd to own outbound sending instead of exporting to an external tool.

## Testing Plan

Backend:

- subscribe route tests for token validation, origin validation, quota handling, hard stop, Turnstile, and idempotency
- confirm/unsubscribe token tests
- service tests for lifecycle transitions
- summary/list/export query tests
- entitlement usage aggregation tests

Frontend:

- project page loading/error/empty states
- filter/search/pagination tests
- row-action mutation tests

CLI:

- help and alias coverage
- info/config/action/read renderers

Integration:

- public plugin contract tests for HTML form and JSON submit flows
- focused end-to-end test proving signup -> confirm -> visible in list -> export row

## Recommended Future Work After V1

- CSV import for existing lists
- provider syncs or outbound webhooks on confirmed signup/unsubscribe
- list segmentation/tags
- basic acquisition reporting and analytics integration
- waitlist rank/invite flows
- richer sending features after the broadcast-first phase 2 (scheduling, automation, templates, A/B tests)
