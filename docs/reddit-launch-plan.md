# Reddit Launch Plan

Status: Proposed  
Last updated: 2026-04-11

## Goal

Launch Vivd publicly on Reddit in a way that:

1. announces that `vivd.studio` exists,
2. pushes most traffic toward low-risk read-only surfaces,
3. keeps hosted usage intentionally controlled,
4. improves platform launch-readiness in ways that remain useful after Reddit.

## Current Launch Shape

- Public marketing site: `https://vivd.studio`
- Public docs/self-host path: `https://docs.vivd.studio`
- Hosted product posture: invite/manual organization creation only
- Open registration: intentionally off for now
- Public story: self-host is available now; hosted access is limited/beta-style

This is not a “fully open SaaS signup” launch. It is a public product-existence launch with a self-host-first CTA and a controlled hosted-access story.

## Traffic Model

### Likely traffic

- Anonymous visitors reading the landing page
- Visitors opening docs and install instructions
- A smaller number of people clicking through to hosted product/login pages
- Bots, crawlers, link preview fetchers, and scraper traffic around the Reddit post

### Less likely traffic

- Large numbers of users creating organizations or opening Studio sessions immediately
- Heavy publish/edit workload from strangers, because hosted access is still gated manually

## Risk Assessment

### Lower-risk paths

- `vivd.studio` landing-page traffic if the page is already published and stable
- `docs.vivd.studio` reads for self-host evaluation
- Static asset fetches for screenshots, fonts, CSS, and images

### Higher-risk paths

- `/vivd-studio` and any login/auth entry points
- Public plugin runtime endpoints under `/plugins/*`
- Feedback/contact-form endpoints under `/email/v1/feedback/*`
- Any path that wakes or depends on isolated Studio runtime capacity
- Any origin setup where the marketing site and hosted control plane compete for the same CPU/bandwidth budget

## Recommended Launch Posture

### Product messaging

- Primary CTA: self-host and read the docs
- Secondary CTA: request hosted access / ask for an invite
- Avoid positioning the hosted platform as broadly open until registration, org creation, and runtime capacity are intentionally ready for that

### Operational stance

- Treat the launch as a read-mostly traffic event, not as a usage-conversion event
- Keep the landing page content stable during the launch window
- Avoid republishing the homepage or docs during the initial traffic spike unless required

## Infrastructure Preparation

### 1. Put Cloudflare in front of `vivd.studio` and `docs.vivd.studio`

This is the highest-leverage low-effort prep.

Expected benefits:

- edge caching for static assets,
- origin shielding,
- bot filtering and basic abuse protection,
- simpler TLS/edge control,
- better headroom if Reddit or crawlers generate bursty traffic.

Cloudflare is not strictly required for a first Reddit post, but it is the most practical safety margin to add before launch.

### 2. Cache the right surfaces

Prefer aggressive caching for:

- images,
- fonts,
- CSS,
- JS bundles,
- read-only docs assets,
- other immutable public assets.

Prefer bypass/no-cache rules for:

- `/vivd-studio*`,
- `/plugins/*`,
- `/email/v1/feedback/*`,
- auth/login/session-sensitive paths,
- any dynamic control-plane/API surfaces.

### 3. Keep hosted product traffic intentionally bounded

- Do not enable open registration for the Reddit launch.
- Keep hosted onboarding manual and explicit.
- If a waitlist or interest form exists, keep it lightweight and rate-limitable.

### 4. Monitor the shared origin

Before launch, make sure there is an easy way to watch:

- origin CPU,
- memory,
- bandwidth,
- response time,
- 5xx rates,
- backend health,
- Caddy health.

### 5. Reduce landing-page origin cost

- Compress and optimize hero images/video.
- Avoid unnecessary client-side JS on the landing page.
- Keep the first public experience mostly static.

## Platform Hardening That Helps Beyond Launch

These are worthwhile even if the first Reddit post is modest.

### 1. Publish-path robustness

The current publish review already identifies reliability gaps worth addressing before relying more heavily on `vivd.studio` as a public-facing origin:

- non-atomic publish materialization,
- Caddy reload success semantics,
- process-local publish locking only,
- collision-prone snippet naming.

These are not mainly “traffic scale” problems; they are “public-site reliability under change” problems.

### 2. Clear public-vs-dynamic separation

Longer term, prefer a topology where:

- the marketing/docs surfaces can absorb bursty anonymous traffic cheaply,
- control-plane and Studio traffic remain isolated from that burst as much as practical.

That can mean either:

- strong CDN shielding in front of the existing origin, or
- eventually separating marketing/docs delivery from the more dynamic hosted product surfaces.

### 3. Basic abuse posture

Even a small Reddit post can attract disproportionate bot traffic.

Prepare for:

- login abuse,
- endpoint probing,
- contact-form spam,
- crawler bursts,
- cache-busting asset fetches.

## Launch Plan

### Slice 0: Decide the public promise

- Confirm the Reddit post is announcing:
  - Vivd exists,
  - self-host is available today,
  - hosted access is limited/manual by design.
- Keep the CTA aligned with current operational reality.

### Slice 1: Edge and DNS prep

- Put `vivd.studio` and `docs.vivd.studio` behind Cloudflare.
- Enable proxy/CDN for the marketing/docs surfaces.
- Create or confirm cache rules that protect static assets while bypassing dynamic paths.

### Slice 2: Landing-page and docs readiness

- Confirm the landing page explains the current product posture clearly.
- Make the self-host docs path prominent.
- Add a clear hosted-access expectation if invites are manual.

### Slice 3: Runtime and monitoring readiness

- Confirm origin health checks are working.
- Make sure logs/metrics are reachable during launch.
- Have a simple rollback or traffic-reduction plan if needed.

### Slice 4: Launch-day ops

- Publish only after the site is already stable.
- Watch traffic and error rates during the first hour.
- If traffic is higher than expected, prioritize keeping docs and landing pages healthy over opening more hosted access.

## Go / No-Go Checklist

- `vivd.studio` landing page is published and stable
- self-host docs are current and easy to find
- hosted product messaging does not imply open registration
- Cloudflare edge/proxy setup is in place, or an explicit decision has been made to launch without it
- basic monitoring is available
- contact/auth/public runtime endpoints have at least minimal abuse protection
- launch-day operator checklist exists

## Cloudflare Setup Note

Cloudflare setup does not require the Cloudflare UI if an API token with the right DNS/zone permissions is available. DNS records, proxy enablement, and some cache/security configuration can be applied through the Cloudflare API or CLI.

For this launch, the likely first step is:

1. put the relevant DNS records under Cloudflare,
2. enable proxying for the public marketing/docs hosts,
3. keep dynamic hosted-product paths out of broad cache rules.

## Acceptance Criteria

- Reddit traffic can hit `vivd.studio` without immediately forcing open hosted usage.
- Most launch traffic is steered toward cheap read-only surfaces.
- Edge protection is in place or intentionally deferred with known risk.
- The launch prep leaves behind useful platform hardening rather than one-off launch hacks.
