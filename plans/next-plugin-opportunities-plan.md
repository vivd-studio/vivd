# Next Plugin Opportunities Plan

Date: 2026-04-16
Owner: product / plugins / sdk
Status: proposed

## Goal

Keep plugin ideation aligned with the current Vivd architecture instead of treating every commonly requested website feature as a native plugin candidate.

The main question for each idea should be:

- does this need persisted server-side state?
- does it need secrets, abuse controls, webhooks, or background jobs?
- does it need access control, moderation, or operational admin workflows?
- does it need concurrency or capacity checks that a static Astro site should not own?

If the answer is mostly no, it should usually stay in:

- site code and CMS content
- a curated `external_embed` provider
- a later `connected` integration

not a new first-party native plugin.

## Current Baseline

Vivd already has a solid native-plugin baseline for the plugin class it supports best today:

- Contact Form
- Newsletter / Waitlist
- Analytics
- Table Booking

There are also already focused plan docs for:

- [Table Booking](./table-booking-plugin-plan.md)
- [Newsletter / Waitlist](./newsletter-waitlist-plugin-plan.md)
- [Reviews / Social Proof](./reviews-testimonials-plugin-plan.md)
- [Plugin SDK V2](./plugin-sdk-v2-plan.md)

The current SDK sweet spot is:

- project-scoped native plugins
- config + install snippets
- public runtime endpoints
- small generic actions and reads
- plugin-owned admin/project pages

That shape is a good fit for the next few server-backed plugins, but not for everything.

## Recommendation

Prioritize the next plugin work in this order:

1. Reviews / Social Proof
2. Events RSVP
3. Appointment Booking
4. Structured Lead Intake / Quote Request

These are the best next candidates because they are both:

- commonly requested by small businesses
- compatible with the current native-plugin architecture without forcing a large SDK or host rewrite

## Tier 1: Build-Now Candidates

### 1. Reviews / Social Proof

Why it is worth doing:

- one of the most common builder-market asks after forms, analytics, and booking
- high value for local businesses, clinics, agencies, restaurants, salons, trades, and consultants
- becomes a real plugin once Vivd owns moderation, curation, imports/sync, attribution, and snippet generation

Why it fits the SDK:

- config-driven
- operator-managed state
- public feed/snippet output
- small read/action surface
- plugin-owned project page

Use the existing detailed plan:

- [plans/reviews-testimonials-plugin-plan.md](./reviews-testimonials-plugin-plan.md)

### 2. Events RSVP

Why it is worth doing:

- broad demand across restaurants, venues, classes, workshops, community groups, and launches
- simpler than full commerce but more valuable than a static calendar
- needs real capacity tracking, attendee lifecycle, confirmations, reminders, and operator management

Why it fits the SDK:

- very close to the current booking and newsletter patterns
- public endpoints + tokenized manage/cancel links
- summary/attendee reads and a small action set
- custom project page is enough; no new host-specific API surface should be required

Recommended v1 stance:

- one event collection per project
- RSVP with capacity limit
- confirmations and cancellations
- optional reminder emails later
- no ticketing or payments in v1

### 3. Appointment Booking

Why it is worth doing:

- this is the service-business sibling to table booking
- relevant for salons, clinics, coaches, consultants, photographers, repair services, and agencies
- likely higher total SMB demand than restaurant-only booking

Why it fits the SDK:

- shares the same shape as table booking: availability, scheduling rules, tokenized management links, operator reads, and operational actions
- can likely reuse scheduling and capacity concepts rather than inventing a new plugin family

Recommended v1 stance:

- one business schedule per project
- one appointment type or a very small service model
- no staff assignment optimization, no payments, no calendar sync in v1

### 4. Structured Lead Intake / Quote Request

Why it is worth doing:

- common ask for agencies, trades, clinics, photographers, event services, and B2B sites
- higher-value than a generic contact form because operators want routing, structured fields, attachments, and better qualification

Why it fits the SDK:

- still fundamentally a forms plugin
- clearly needs server-side validation, abuse control, submission storage, notifications, and optional webhook/CRM handoff
- can use the same general interaction model as Contact Form

Important product decision:

- first decide whether this is `contact_form` phase 2 or a separate plugin
- if the difference is mostly schema, routing, and richer submission UX, extending Contact Form may be better than splitting too early

## Tier 2: Good But Not Low-Hanging

### Restaurant Waitlist

This is a good follow-on to table booking, but not the first plugin after it.

Why later:

- it is operationally close to booking and can reuse some primitives
- but the public UX and real-time expectations are a little more specialized

### Loyalty / Gift Cards

There is real demand, especially for restaurants and repeat-visit businesses.

Why later:

- balances, payments, redemptions, fraud, and accounting edges push this well past the current low-risk plugin scope

### Connected CRM / Automation Integrations

Examples:

- HubSpot sync
- Resend / Mailchimp sync
- Zapier-style outbound hooks

Why later:

- these belong more to the future `connected` plugin model than to the current native-first priority list

## Not Native-Plugin Priorities

### Chat / Messaging Launcher

Examples:

- WhatsApp launcher
- Messenger launcher
- live chat widget embed

Recommendation:

- treat this as `external_embed` or later `connected`, not as the next native plugin

Reason:

- if Vivd is only launching or embedding a chat provider, a native server-backed plugin adds little value
- it only becomes a true native-plugin candidate if Vivd owns inbox state, assignment, transcripts, or AI/human handoff

### Members Area

Recommendation:

- do not treat this as a near-term plugin

Reason:

- published-site auth, protected routes/assets, password reset, site-user lifecycle, and access control make this feel closer to a core product capability than a low-hanging plugin

### Simple Testimonials, FAQ, Maps, Cookie Consent, or Popup Widgets

Recommendation:

- keep these in site code, CMS, or `external_embed` unless a stronger server-backed need emerges

Reason:

- most of these do not need Vivd-owned backend state to be useful

## Shared Primitive Direction

The next useful plugins should reuse a small number of backend primitives instead of each becoming a one-off system.

### Submissions Primitive

Used by:

- Contact Form
- Structured Lead Intake / Quote Request
- Reviews manual import / moderation intake
- future application or intake flows

Core concerns:

- abuse controls
- notifications
- moderation
- export / webhook handoff

### Availability And Capacity Primitive

Used by:

- Table Booking
- Appointment Booking
- Events RSVP
- later restaurant waitlist

Core concerns:

- schedule windows
- capacity checks
- tokenized manage/cancel flows
- operational reads and small admin actions

## Suggested Sequence

1. Finish hardening the currently active native plugin set, especially Table Booking.
2. Ship Reviews / Social Proof as the next broad-demand trust plugin.
3. Decide whether `Events RSVP` or `Appointment Booking` should be the next scheduling-based plugin, based on target customer mix.
4. Decide whether structured lead intake belongs inside Contact Form or as a separate plugin package before starting implementation.
5. Leave chat-style launchers, simple embeds, and members-area work outside the native-plugin queue for now.

## Bottom Line

The best next native-plugin ideas are the ones that clearly need backend ownership and still fit the current SDK without special host exceptions.

That means the next practical shortlist is:

- Reviews / Social Proof
- Events RSVP
- Appointment Booking
- Structured Lead Intake / Quote Request

And the main things to avoid forcing into the native-plugin lane right now are:

- chat launchers and simple embeds
- generic presentational widgets
- members area / published-site auth
