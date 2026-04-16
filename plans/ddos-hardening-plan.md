# DDoS Hardening Plan

Status: Proposed  
Last updated: 2026-04-14

## Goal

Improve Vivd's resilience against both:

1. volumetric attacks that try to saturate bandwidth, connection tables, or TLS termination, and
2. application-layer abuse that tries to force expensive work such as Studio wakes, runtime bootstrap, preview fetches, ZIP exports, imports, or plugin ingest spam.

The plan is split into:

- internal platform work Vivd can do itself,
- external shielding that should sit in front of Vivd origins.

## Current Surface

Today, Vivd exposes several traffic classes that should not share the same abuse budget:

- published-site traffic on customer domains and tenant hosts,
- control-plane frontend and backend traffic under `/vivd-studio`,
- public plugin runtime endpoints such as analytics and contact/newsletter submission paths,
- preview and artifact routes,
- Studio runtime and compatibility routes,
- expensive authenticated actions such as `startStudio`, `hardRestartStudio`, publish, ZIP import, and ZIP download.

There are already a few useful protections in the codebase:

- request body and upload size limits in backend and Studio servers,
- plugin-local abuse checks in Contact Form,
- plugin-local rate limiting in Analytics,
- per-project in-flight dedupe for Studio starts,
- local resource caps such as max local Studio/OpenCode server counts.

Those controls are helpful, but they do not yet form a complete cross-platform abuse posture.

## Threat Model

### High-risk public paths

- public site requests on shared origin infrastructure,
- `/plugins/*` runtime endpoints,
- `/email/v1/feedback/*`,
- any public preview route,
- any path that can fan out into database, object storage, archive generation, or Studio runtime work.

### High-risk authenticated paths

- starting or hard-restarting Studio,
- repeated keepalive/touch traffic,
- ZIP import/download,
- publish/build/generation flows,
- anything that can wake or reconcile isolated Studio runtimes.

### Design principle

Cheap work must happen before expensive work.

That means:

- reject early,
- cache early,
- queue scarce work,
- isolate blast radius by host and route class,
- do not let anonymous traffic compete with Studio/runtime capacity.

## Internal Platform Work

## 1. Split traffic classes at the origin

Vivd should stop treating all hostnames and paths as one shared pool.

Target separation:

- public published-site traffic,
- app/control-plane traffic,
- public plugin ingest traffic,
- Studio runtime and compatibility traffic.

This does not require two Caddy binaries immediately. One Caddy instance with clearly separated virtual hosts and upstream pools is acceptable as a first step. The important part is that traffic classes do not share the same throttles, cache rules, and origin capacity.

Desired origin shape:

- `app.*` or equivalent first-party hostnames for `/vivd-studio`,
- dedicated runtime host/path namespace for Studio compatibility routes,
- separate public-site hostnames and customer-mapped domains,
- public ingest endpoints classified separately from general control-plane traffic.

## 2. Add shared backend abuse controls

Introduce platform-wide middleware or service-level guards in backend for:

- IP-based limits,
- session/user-based limits,
- organization-based limits,
- host/path-class limits,
- concurrent in-flight expensive-operation caps.

Prioritize these route classes:

- Studio start/restart/touch,
- preview routes,
- ZIP import/upload/download,
- publish/build/generation,
- public plugin runtime endpoints.

Implementation guidance:

- use token-bucket or leaky-bucket semantics,
- make route classes configurable via env,
- respond with `429` before hitting DB, object storage, or machine providers where possible,
- log structured rejection metadata for later tuning.

## 3. Protect expensive Studio lifecycle operations

Studio start and restart are the clearest amplification risk inside the platform.

Add:

- per-user cooldown for `startStudio` and `hardRestartStudio`,
- per-org concurrent start cap,
- per-project restart cooldown,
- queueing for wake/start work instead of unlimited parallel starts,
- degraded-mode circuit breaker when provider errors or startup latency spike,
- stricter keepalive/touch throttling so background tab churn cannot pin machines indefinitely.

Desired behavior under load:

- a small number of starts continue,
- excess requests are queued or rejected quickly,
- repeated retries do not multiply provider/API load.

## 4. Tighten preview and artifact exposure

Preview routes should not become a public origin bypass.

Move toward:

- public preview disabled by default,
- signed short-lived preview access when public sharing is needed,
- aggressive caching of immutable preview assets,
- no runtime wake or on-demand build triggered by anonymous preview traffic,
- explicit response shaping for `build_in_progress` and `artifact_not_ready` so retries do not hammer the system.

Also revisit ZIP download/export:

- prefer prebuilt or cached export artifacts where practical,
- throttle synchronous archive generation heavily,
- cap concurrent exports per org and globally.

## 5. Extract plugin-local abuse patterns into shared infrastructure

Contact Form already has strong abuse checks:

- per-IP and per-token rate limits,
- duplicate suppression,
- minimum repeat delay,
- field-size caps,
- link-count heuristics.

Analytics already has basic ingest rate limiting.

Vivd should extract the shared primitives into reusable backend infrastructure so every public runtime endpoint can opt into the same model instead of re-implementing local checks.

## 6. Add cache-aware response shaping

Many Vivd surfaces are safe to cache more aggressively than they are today.

Priorities:

- published static assets,
- docs assets,
- immutable preview assets,
- static placeholder and fallback pages.

Avoid broad caching for:

- authenticated control-plane traffic,
- Studio runtime responses,
- mutable preview HTML without signed-version semantics,
- public ingest POSTs.

## 7. Add operational load shedding

Vivd should have an explicit degraded mode.

When enabled automatically or manually:

- reject new Studio starts above a tighter threshold,
- reject hard restarts unless explicitly privileged,
- reject or defer ZIP export/import,
- keep published sites and read-only control-plane pages available,
- preserve health and metrics endpoints.

## 8. Improve visibility and forensic signals

Add dashboards and logs for:

- requests by host/path class,
- top source IPs and ASNs when available,
- 429 rates by route class,
- Studio startup queue depth,
- provider error rate,
- object storage and DB latency under load,
- cache hit ratio where edge headers are available.

Without this, Vivd will guess at thresholds instead of operating from evidence.

## External Shield

## 1. Put a real edge in front of first-party domains

Vivd should put first-party public domains and subdomains behind an external edge shield such as Cloudflare, Fastly, or a comparable provider.

First-party targets include:

- `vivd.studio`,
- docs hosts,
- app/control-plane hosts,
- preview/runtime hosts owned by Vivd,
- any other Vivd-managed tenant subdomains.

Primary value:

- volumetric DDoS absorption,
- TLS termination offload,
- connection flood protection,
- bot mitigation,
- edge caching,
- origin shielding.

## 2. Lock origin access behind the shield

A shield only helps if attackers cannot bypass it.

Vivd origins should accept traffic only from:

- the shield provider,
- trusted internal networks,
- explicit provider control-plane paths where necessary.

Practical examples:

- firewall or allowlist by provider ranges where feasible,
- origin auth headers or mTLS for shield-to-origin traffic where supported,
- no publicly documented direct origin hostname for first-party surfaces.

## 3. Use provider SaaS/custom-hostname support for customer domains

For customer-owned custom domains, the best protection model is not "point directly at origin and hope the edge still helps."

Preferred model:

- onboard customer domains as managed custom hostnames on the shield provider,
- validate ownership,
- terminate TLS at the shield edge,
- forward to Vivd origin with original host preserved.

This gives customer domains the same edge protection model as Vivd-owned subdomains.

Fallback model:

- if a customer domain cannot be onboarded to the shared shield, treat it as a lower-protection path and document that tradeoff clearly.

## 4. Apply route-aware edge rules

At the shield, configure different policies for:

- published static site traffic,
- `/vivd-studio` and auth flows,
- public plugin ingest endpoints,
- preview paths,
- health and admin-only surfaces.

Examples:

- broader caching for static sites and docs,
- stricter bot and rate rules for login and runtime paths,
- POST rate controls for plugin ingest,
- challenge or tarpitting for obvious probing/scanning patterns.

## 5. Separate origins if one-origin shielding remains too coupled

If one shared origin still creates unacceptable coupling after edge shielding, split origins:

- public-sites origin,
- app/control-plane origin,
- optional runtime origin.

This is an origin-topology decision, not a shield requirement. The shield can still front all three.

## Coordination Backend

Vivd should treat rate limiting, cooldowns, bans, and start queues as a coordination concern, not as a Redis-specific feature.

The interface should be expressed in backend terms such as:

- consume budget,
- acquire or release lease,
- set or read cooldown,
- set or read degraded-mode flags,
- enqueue scarce work,
- dedupe repeated expensive actions.

That keeps app policy stable even if the storage backend changes.

## Redis / Valkey

Redis-style infrastructure can help, but it is not a DDoS shield by itself.

## What Redis / Valkey is good for

- distributed rate limiting across multiple backend instances,
- shared token buckets and cooldowns,
- short-lived IP/session bans,
- counters for preview/export/import abuse,
- start/restart queues for Studio lifecycle work,
- circuit-breaker state and degraded-mode flags,
- request dedupe keys for expensive actions.

For Vivd specifically, Redis or Valkey is most valuable for:

- cross-instance `startStudio` / `hardRestartStudio` gating,
- shared public-endpoint rate limiting,
- temporary hot-IP suppression,
- queueing scarce runtime-start work,
- keeping abuse counters out of the primary relational DB hot path.

Recommended posture:

- use Redis or Valkey as the first distributed production backend for more AWS/VPC-style deployments,
- keep an in-memory backend for local/dev and small single-node installs,
- leave room for a future Cloudflare-native backend if some coordination moves to the edge.

## What Redis / Valkey is not good for

- absorbing volumetric bandwidth floods,
- replacing an edge CDN/WAF,
- protecting the origin if attackers can still reach it directly,
- solving TLS handshake exhaustion on the public edge by itself.

## Cloudflare-native alternative

If Vivd moves toward a more Cloudflare-heavy architecture, some of the same coordination semantics may be implemented through platform-native primitives instead of Redis.

That does not invalidate the plan. It reinforces the need for a provider-agnostic coordination interface above the storage layer.

## Recommendation on the coordination backend

Use a provider-agnostic coordination interface as the architectural seam, with Redis or Valkey as the first serious distributed backend rather than the only intended implementation.

Recommended sequence:

1. external shield first,
2. origin separation and lock-down,
3. coordination-backed distributed rate limits and queues,
4. route-specific hardening and tuning.

## Proposed Rollout

## Slice 0: Immediate low-risk changes

- classify Vivd routes into public-site, app, runtime, preview, and public-ingest buckets,
- add missing backend/global rate limiting for the most expensive paths,
- disable or tighten public preview defaults,
- document the intended edge model for first-party and customer domains.

## Slice 1: Internal platform hardening

- add shared abuse middleware,
- add Studio lifecycle cooldowns and concurrency caps,
- add degraded-mode load shedding,
- move expensive synchronous export/import paths behind better gating,
- define metrics and dashboards.

## Slice 2: External shielding

- front first-party domains with shield provider,
- lock down origin access,
- add route-aware cache and security rules,
- verify that control-plane and published-site traffic do not compete excessively at origin.

## Slice 3: Customer-domain shielding

- design managed custom-hostname onboarding flow,
- define ownership-validation flow,
- define fallback behavior when a domain is not onboarded to the shield,
- make the domain protection state visible in admin/product surfaces.

## Open Decisions

| Question | Current direction |
|---|---|
| Do we need two Caddies immediately? | No; separate traffic classes first, then split origins only if one origin remains too coupled |
| Should public preview remain directly reachable? | Prefer off by default; move toward signed short-lived access |
| Should Redis or Valkey be introduced? | Yes as the first distributed coordination backend for rate limiting and queues, but not as a substitute for edge shielding |
| Should all customer custom domains be forced through shield-managed onboarding? | Preferred long-term direction; fallback path may remain for simpler/self-host scenarios |

## Success Criteria

- anonymous floods against published sites do not materially degrade Studio/control-plane availability,
- repeated requests cannot multiply Studio wake/start work beyond configured caps,
- public plugin endpoints fail cheap under abuse,
- first-party domains cannot bypass the shield to hit origin directly,
- customer domains have a clear and visible protection mode,
- operators can see abuse pressure and mitigation behavior in real time.
