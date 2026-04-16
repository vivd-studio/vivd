# Reviews / Social Proof Plugin Plan (Builder-First)

Status: Proposed, not implemented
Last updated: 2026-04-16

## Goal

Ship a first-party plugin for the most mainstream small-business website need in builder ecosystems: connect external business-review sources, curate the best reviews, and display them on the site as trust-building social proof.

This should be the normal website-owner version of a reviews plugin:

- connect the places/profiles they already have
- pull real reviews from the major platforms people already trust
- let the operator feature, hide, and arrange them
- output builder-friendly widgets/snippets without custom code

## Market Direction

The mainstream builder pattern is not "collect brand-new testimonials from scratch first." It is:

1. connect Google reviews
2. optionally add other common review sources
3. display a unified feed, badge, or carousel on the site

Builder-market signals point to a Google-first but multi-source product shape:

- Wix has a large dedicated Google Reviews app plus separate Trustpilot, Yelp, TripAdvisor, and Facebook review widgets in the same `Reviews & Testimonials` category.
- WordPress plugins also pitch the same value proposition as a combined feed across Google, Facebook, Yelp, and TripAdvisor rather than a one-source-only widget.
- Wix keeps product reviews as a separate store-specific app, which is a useful product boundary: business/site reputation reviews are not the same thing as ecommerce product reviews.

Interpretation:

- the right first-party Vivd product is a `reviews` plugin
- it should be external-review-first, not testimonial-request-first
- it should support multiple common sources, not only Google
- product reviews for stores should remain a separate future plugin

## Recommendation

Treat this as one plugin:

- plugin id: `reviews`
- display name: `Reviews & Social Proof`

This plugin should own business/site reputation review display across the most common public review platforms for normal SMB sites.

Manual testimonials still matter, but they should be one source type inside this plugin or a CMS-owned content path, not the primary product framing.

## Production-Ready V1 Recommendation

The first production-ready version should be smaller than the full connector vision.

Ship v1 with:

- `google` direct connector
- `trustpilot` direct connector
- `yelp` direct connector
- `manual / csv` import fallback
- one unified review library
- one public feed
- four snippet shapes: badge, list, grid, carousel

Explicitly defer from v1:

- `tripadvisor`
- `facebook`
- hospitality-specific sources such as Booking.com or Airbnb
- outreach/solicitation flows
- response/reputation-management flows

Why this is the right first slice:

- `Google` covers the widest mainstream SMB demand.
- `Trustpilot` covers a broad service/business trust use case.
- `Yelp` covers a common local-business pattern, especially in the US.
- `Manual / CSV` keeps the plugin usable when a business depends on a source outside the shipping connector set.

This is small enough to harden properly and broad enough to feel like a real builder-grade reviews product on day one.

## Product Boundary

### What v1 must do

1. Connect `google`, `trustpilot`, and `yelp`, plus `manual / csv` import.
2. Normalize disparate provider data into one review library inside Vivd.
3. Let operators feature, hide, archive, and sort reviews before site display.
4. Expose a public feed plus copy-paste HTML/Astro snippets for list, grid, badge, and carousel usage.
5. Preserve attribution, source URLs, sync metadata, and provider-specific display/compliance rules.
6. Offer manual/CSV import so the plugin is still usable for unsupported or deferred sources.

### What v1 must not try to do

- fake or agent-generated reviews
- promise perfect live API sync for every provider on day one
- scraping sources whose terms or stability make that unsafe
- full reputation-management workflow like replying to reviews
- product reviews for ecommerce catalogs
- email review solicitation campaigns
- AI sentiment analysis or rewrite pipelines
- broad schema/SEO claims that need separate policy review

## Source Priority

### Shipping v1 source set

These are the only sources that should ship in the first prod-ready version:

1. Google Business Profile / Google Reviews
2. Trustpilot
3. Yelp
4. Manual / CSV import

### Next source candidates after v1

- TripAdvisor
- Facebook Recommendations
- Booking.com
- Airbnb
- other vertical-specific sources only after direct demand proves they matter

### Why this set

- `Google` is the broadest mainstream trust signal for local businesses, clinics, agencies, salons, trades, restaurants, gyms, and consultants.
- `Trustpilot` is common for service businesses, SaaS, and general trust badges.
- `Yelp` remains common for local-service and food businesses.
- `Manual / CSV import` keeps the plugin broadly usable even when a source is niche, gated, or operationally awkward.

### Product stance on verticals

- This plugin is for business/site reputation reviews.
- Store/product reviews should be a separate future plugin.
- Hospitality-heavy providers such as Booking.com or Airbnb can be later adapters, not day-one core scope.

## Connector Strategy

The plugin promise is multi-source reviews, but the implementation should be connector-aware rather than pretending every provider behaves the same.

Each provider adapter should declare capabilities such as:

- direct API sync vs import-only
- full review text vs excerpt-only
- max returned reviews
- cache TTL or refresh limits
- whether provider attribution is mandatory
- whether star ratings, recommend/not-recommend, or both are supported

Shipping source strategy:

- `google`: direct connector
- `trustpilot`: direct connector when the customer has the required account/API access
- `yelp`: direct connector with excerpt/caching constraints
- `manual`: explicit operator-entered or CSV-imported reviews with required attribution fields

Deferred adapters:

- `tripadvisor`: phase 2
- `facebook`: phase 2 or later

## Trust Rules

This plugin must stay strict about authenticity:

- never generate fake reviews
- never invent reviewer names, companies, ratings, or source URLs
- keep provider/source attribution attached to every displayed review
- keep raw/provider metadata so the origin of a review remains auditable
- do not hide provider restrictions behind a fake "all providers work the same" abstraction

Suggested durable agent hint:

- `Never invent reviews, reviewer names, companies, or ratings. Only use real reviews from connected sources or operator-supplied manual imports with attribution.`

## Proposed Plugin Shape

Create a new extracted package:

- `plugins/native/reviews`

Initial package shape should mirror the current extracted-plugin model:

- `src/descriptor.ts`
- `src/manifest.ts`
- `src/backend/plugin.ts`
- `src/backend/module.ts`
- `src/backend/contribution.ts`
- `src/backend/service.ts`
- `src/backend/config.ts`
- `src/backend/providerTypes.ts`
- `src/backend/providers/google.ts`
- `src/backend/providers/trustpilot.ts`
- `src/backend/providers/yelp.ts`
- `src/backend/providers/manual.ts`
- `src/backend/publicApi.ts`
- `src/backend/snippets.ts`
- `src/backend/http/feed.ts`
- `src/frontend/plugin.ts`
- `src/frontend/module.ts`
- `src/frontend/ReviewsProjectPage.tsx`
- `src/cli/plugin.ts`
- `src/cli/module.ts`
- `src/shared/projectUi.ts`
- `src/shared/summary.ts`

Host apps should stay generic:

- backend/frontend/CLI/studio registries consume package-owned exports
- review-specific UI stays inside the plugin package
- backend keeps only thin runtime binding and cleanup adapters
- plugin code must not import backend internals from `@vivd/backend/src/...`

## Proposed Definition

Suggested definition shape:

- `pluginId`: `reviews`
- `name`: `Reviews & Social Proof`
- `description`: `Connect external review sources and display real customer reviews on your site.`
- `category`: `marketing`
- `sortOrder`: `40`
- `listUi.projectPanel`: `custom`
- `listUi.usageLabel`: `Reviews`
- `listUi.limitPrompt`: `Review-source limits are configured per plan or instance policy.`
- `listUi.supportsMonthlyLimit`: `false`
- `listUi.supportsHardStop`: `false`
- `listUi.supportsTurnstile`: `false`
- `listUi.dashboardPath`: `null`

Capabilities:

- `supportsInfo: true`
- config `show/apply/template`: yes
- actions:
  - `sync_all`
  - `sync_source <sourceId>`
  - `feature_review <reviewId>`
  - `unfeature_review <reviewId>`
  - `archive_review <reviewId>`
  - `restore_review <reviewId>`
- reads:
  - `summary`
  - `reviews`
  - `sources`

The custom project page should handle the richer connection, moderation, preview, and snippet UX.

## Minimal Config

Keep project config small and source-oriented:

```json
{
  "sources": [
    {
      "provider": "google",
      "label": "Main Google Business Profile",
      "externalRef": "PLACE_ID",
      "enabled": true,
      "syncMode": "automatic"
    },
    {
      "provider": "trustpilot",
      "label": "Trustpilot",
      "externalRef": "BUSINESS_UNIT_ID",
      "enabled": true,
      "syncMode": "automatic"
    }
  ],
  "defaultFeedLimit": 12,
  "defaultSort": "featured_first",
  "showAggregateRating": true,
  "showSourceAttribution": true
}
```

Recommended v1 schema:

- `sources: ReviewSourceConfig[]`
- `defaultFeedLimit: number`
- `defaultSort: "featured_first" | "newest" | "highest_rating"`
- `showAggregateRating: boolean`
- `showSourceAttribution: boolean`

Each `ReviewSourceConfig` should include:

- `id`
- `provider`
- `label`
- `externalRef`
- `enabled`
- `syncMode: "manual" | "automatic"`
- `locale` optional
- `filters` optional

What is intentionally missing from v1:

- visual theme-builder config
- per-widget design systems inside plugin config
- provider-specific deep settings explosion
- campaign/outreach automation
- response/reply management
- per-page personalization logic

## Core UX

### Operator workflow

1. Enable the plugin.
2. Add one or more review sources.
3. Match or verify the external business/profile.
4. Run first sync.
5. Review imported entries in a unified library.
6. Feature, hide, or archive entries.
7. Copy the chosen snippet or use the public feed.
8. Publish the site with real social proof already in place.

### Site-owner outcomes

The site owner should be able to add:

- a compact rating badge near the hero or CTA
- a featured review carousel on the homepage
- a full review grid/list on a trust or contact page
- source-filtered sections, for example Google-only or Yelp-only

## Data Model

Recommended initial tables:

### `review_source_connection`

Core fields:

- `id`
- `organizationId`
- `projectSlug`
- `pluginInstanceId`
- `provider`
- `label`
- `externalRef`
- `status`
- `syncMode`
- `capabilities` JSON
- `providerConfig` encrypted/JSON as needed
- `lastSyncedAt` nullable
- `cacheExpiresAt` nullable
- `lastError` nullable
- `createdAt`
- `updatedAt`

### `review_entry`

Core fields:

- `id`
- `organizationId`
- `projectSlug`
- `pluginInstanceId`
- `sourceConnectionId`
- `provider`
- `externalReviewId`
- `status: "active" | "featured" | "archived"`
- `authorDisplayName`
- `authorAvatarUrl` nullable
- `ratingValue` nullable
- `recommendState` nullable
- `title` nullable
- `body`
- `excerpt` nullable
- `reviewUrl` nullable
- `sourceLabel`
- `sourceUrl` nullable
- `languageCode` nullable
- `reviewedAt` nullable
- `syncedAt`
- `rawPayload` JSON nullable
- `featuredRank` nullable
- `createdAt`
- `updatedAt`

Notes:

- provider/source provenance must remain explicit
- `rawPayload` is useful for debugging and future connector evolution
- provider constraints such as excerpt-only text should be recorded in source capabilities, not hidden
- add indexes by org/project/provider/status and by source connection

## Public Runtime API

This plugin is read-heavy, not public-write-heavy.

Recommended endpoints:

- `GET /plugins/reviews/v1/feed`
- `GET /plugins/reviews/v1/summary`

`GET /feed` should support optional query params such as:

- `provider`
- `limit`
- `featuredOnly`
- `minRating`
- `locale`

The public feed should return only display-safe fields, for example:

- `id`
- `provider`
- `authorDisplayName`
- `authorAvatarUrl`
- `ratingValue`
- `recommendState`
- `title`
- `body`
- `excerpt`
- `reviewUrl`
- `sourceLabel`
- `sourceUrl`
- `reviewedAt`
- `featured`

`GET /summary` should return:

- connected source count
- active review count
- featured review count
- aggregate rating/count when meaningful
- per-provider counts

Implementation rules:

- include provider attribution fields in public output
- do not leak raw/provider-private data
- respect provider-specific cache constraints

## Snippet Strategy

V1 should feel builder-like out of the box.

Recommended snippet outputs:

- `badge`
- `list`
- `grid`
- `carousel`
- each in `html` and `astro`

The snippets should:

- fetch the public feed endpoint
- optionally filter by provider
- render rating stars only when a source supplies stars
- render recommendation state cleanly for non-star sources
- preserve source attribution and outbound source link
- work on both static HTML and Astro projects

Do not turn v1 into a full visual widget designer. Layout choices should stay constrained and easy to restyle.

## Frontend Project Page

The custom project page should include:

- source connection cards with status and last-sync info
- first-sync/setup guidance for each provider
- provider capability warnings such as excerpt-only or attribution-required
- unified review library with filters by provider, status, rating, locale
- feature/archive controls and simple ordering for featured reviews
- preview of badge/list/grid/carousel outputs
- feed endpoint and snippet copy area
- sync logs/errors at a lightweight level

## CLI / Agent Surface

The plugin should fit the generic plugin surface:

- `vivd plugins ensure reviews`
- `vivd plugins info reviews`
- `vivd plugins config template reviews`
- `vivd plugins config show reviews`
- `vivd plugins config apply reviews --file ...`
- `vivd plugins action reviews sync_all`
- `vivd plugins action reviews sync_source <sourceId>`
- `vivd plugins read reviews summary`
- `vivd plugins read reviews sources`

Agent expectations:

- agent may install snippets and help connect supported sources
- agent may help format display order and filtering
- agent must not invent reviews or fabricate imports

## Provider Constraints To Design Around

The backend connector architecture should assume source differences are real:

- Google Places/Place Details exposes rating and reviews, but review retrieval is provider-bounded and must be requested explicitly.
- Yelp exposes business/review data, but its API does not return full review text, only limited excerpts, and cache/storage limits apply.
- Trustpilot supports APIs for collecting and displaying reviews, but access depends on the customer having the required Trustpilot Business/API access.
- Tripadvisor has a real Content API, but it is metered and attribution-sensitive.
- Facebook should not block the main product; if direct integration is awkward, import-mode support should keep the plugin useful anyway.

These constraints are product-shaping, not edge cases.

## Boundary With CMS

Vivd CMS still has a role:

- long-form case studies or curated testimonial pages can stay CMS-owned
- this plugin owns external review ingestion, moderation, and display feed workflow
- manual testimonials can either live in CMS or come through the plugin's `manual` source type

Do not duplicate CMS just to render a few curated quotes.

## Deferred Follow-Ups

Phase 2 candidates:

- TripAdvisor direct connector
- Facebook direct connector if the approval flow is worth the product value
- hospitality/source-specific adapters such as Booking.com or Airbnb
- stronger manual import UX from CSV/JSON/export files
- richer per-provider filter controls
- optional one-way export of featured reviews into Astro collections

Phase 3 candidates:

- review solicitation/email flows
- reply management for providers that support it
- analytics on review-widget impressions/clicks/conversions
- policy-reviewed structured-data helpers
- vertical-specific packs such as dentists, salons, restaurants, hotels

## Docs Surfaces To Update When Implementing

- `packages/docs/src/content/docs/plugins.mdx`
- `packages/docs/src/content/docs/plugins/reviews.mdx`

## Validation

This plan is doc-only.

When implementation starts, validate at least:

- `npm run typecheck -w @vivd/plugin-reviews`
- `npm run typecheck -w @vivd/backend`
- `npm run typecheck -w @vivd/frontend`
- `npm run typecheck -w @vivd/cli`
- focused backend tests for source connection, sync normalization, caching, and feed output
- focused frontend tests for the custom project page and snippet generation
