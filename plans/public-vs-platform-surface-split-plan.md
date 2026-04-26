# Public vs Platform Surface Split Plan

Status: In Progress  
Last updated: 2026-04-23

## Goal

Separate Vivd's public published-site traffic from platform and Studio traffic so:

- anonymous traffic cannot easily degrade control-plane availability,
- rate limits and cache policy can be tuned by traffic class,
- external shielding can be applied more cleanly later,
- origin topology can evolve from one shared Caddy to multiple origin services without rewriting the whole routing model.

## Decision

The first implementation step should be:

- two logical surfaces,
- still on one Caddy process.

Only after that split is working and measurable should Vivd consider:

- two Caddy services/processes,
- or separate public/platform origins behind an external shield.

This keeps the first step high-leverage without immediately multiplying operational moving parts.

## Current Coupling

Today the default Caddy setup mixes these responsibilities:

- published-site serving from `/srv/published`,
- control-plane frontend routing under `/vivd-studio*`,
- control-plane backend routing under `/vivd-studio/api/*`,
- same-host plugin runtime endpoints under `/plugins/*`,
- same-host feedback endpoints under `/email/v1/feedback/*`,
- active Studio runtime routes imported from `/etc/caddy/runtime.d/*.caddy`.

Relevant files:

- root [Caddyfile](/Users/felixpahlke/code/vivd/Caddyfile)
- publish config generation in [packages/backend/src/services/publish/PublishService.ts](/Users/felixpahlke/code/vivd/packages/backend/src/services/publish/PublishService.ts)
- Studio runtime route generation in [packages/backend/src/services/studioMachines/runtimeUrlRouteService.ts](/Users/felixpahlke/code/vivd/packages/backend/src/services/studioMachines/runtimeUrlRouteService.ts)
- Caddy reload helper in [packages/backend/src/services/system/CaddyAdminService.ts](/Users/felixpahlke/code/vivd/packages/backend/src/services/system/CaddyAdminService.ts)
- compose wiring in [docker-compose.yml](/Users/felixpahlke/code/vivd/docker-compose.yml) and [packages/docs/public/install/docker-compose.yml](/Users/felixpahlke/code/vivd/packages/docs/public/install/docker-compose.yml)

The key shared assumptions today are:

- one `CADDY_ADMIN_URL`,
- one generated published-site config directory,
- one generated runtime-route directory,
- one default fallback server for both public and platform traffic.

## Target Surface Model

## Surface 1: Public

Traffic that should be treated as public/read-mostly:

- published customer sites,
- tenant hosts serving live published sites,
- unpublished placeholder pages,
- docs host,
- static default/fallback pages.

Characteristics:

- cache-friendly,
- high anonymous volume expected,
- should remain available even when platform load is constrained,
- should not route into Studio lifecycle work.

## Surface 2: Platform

Traffic that should be treated as authenticated or platform-sensitive:

- `/vivd-studio*`,
- `/vivd-studio/api/*`,
- Studio runtime compatibility routes,
- preview-control and runtime bootstrap flows,
- platform-side plugin/admin/control-plane APIs.

Characteristics:

- lower-volume but more expensive,
- authentication-sensitive,
- stricter rate limiting and bot posture,
- should not compete with public published-site traffic for the same budgets.

## Same-host public ingest endpoints

Vivd currently also has public POST-style runtime endpoints such as:

- `/plugins/*`,
- `/email/v1/feedback/*`.

These should be classified separately in backend policy even if they remain host-collocated temporarily. They are not equivalent to either static public-site traffic or authenticated platform traffic.

## Phase 1: One Caddy, Two Logical Surfaces

## Topology

Keep one Caddy service/process, but introduce explicit public and platform host classes.

Example direction:

- public hosts:
  - customer domains,
  - tenant publish hosts,
  - docs host
- platform hosts:
  - control-plane host,
  - Studio/runtime host namespace,
  - optional dedicated public plugin API host

This phase does not require changing how Caddy is operated. It changes how traffic is classified and routed.

## Caddy changes

1. Stop relying on one default catch-all server for both public and platform behavior.
2. Introduce explicit host-based server blocks for platform surfaces.
3. Keep published-site config generation under the public surface only.
4. Keep runtime-route imports under the platform surface only.
5. Ensure placeholder and 404 behavior for public hosts does not also serve as platform fallback behavior.

Concrete direction:

- public server block:
  - serve `/srv/published`,
  - serve placeholder/default public pages,
  - do not own `/vivd-studio*`
- platform server block:
  - own `/vivd-studio*`,
  - own runtime route imports from `runtime.d`,
  - own same-host platform-facing plugin/runtime routes when needed

## Backend changes

1. Add explicit host/surface classification to app config and backend route policy.
2. Ensure generated published-site Caddy configs target the public surface only.
3. Ensure generated runtime-route Caddy fragments target the platform surface only.
4. Keep a single reload path initially, but stop assuming all generated fragments belong to the same behavioral surface.

## Traffic policy changes

Once the surfaces are explicit, backend and edge policy can diverge:

- public surface:
  - aggressive static caching,
  - looser anonymous GET budgets,
  - no Studio lifecycle ownership
- platform surface:
  - tighter rate limits,
  - login/runtime/start protection,
  - clearer observability around expensive actions

## First code slices

### Slice 1: Surface classification

Add a small shared resolver that classifies requests and hostnames into:

- `public_site`,
- `platform`,
- `public_ingest`,
- `runtime`,
- `preview`.

Use it first in backend logging, rate limiting, and route policy.

### Slice 2: Caddyfile split by host class

Refactor the root Caddyfile so:

- public serving and platform serving are represented as separate host-oriented blocks,
- runtime route imports live only under the platform block,
- the fallback public file server no longer doubles as the platform fallback.

### Slice 3: Generated config ownership cleanup

Adjust publish/runtime config generation so ownership is explicit:

- published-site configs belong to the public surface,
- runtime route fragments belong to the platform surface.

### Slice 4: Platform-specific rate limits

Use the new surface classifier to enforce stricter limits on:

- `startStudio`,
- `hardRestartStudio`,
- `touchStudio`,
- preview control,
- ZIP export/import,
- public ingest endpoints.

## Phase 2: Promote to Two Caddy Services if Needed

Implementation note:

- the default hosted/platform Docker stack stays on one `caddy` service while Dokploy/Traefik still routes everything through one upstream,
- backend publish/runtime code can already route reloads to public or platform Caddy targets when separate admin/config envs are provided,
- two Caddy services should be introduced later through explicit deployment wiring rather than as the default Compose shape.

Only do this after phase 1 proves that:

- the surface split is correct,
- the route ownership is stable,
- the remaining coupling is operational, not conceptual.

## Topology

Example:

- `caddy-public`
- `caddy-platform`

Likely implications:

- separate admin URLs,
- separate config directories or separate generated roots,
- separate reload logic,
- explicit ownership of published-site config vs runtime-route config,
- separate private service addresses behind the external shield.

## Why defer this

Jumping directly to two Caddy services would force several changes at once:

- admin/reload plumbing,
- volume layout,
- compose/deploy changes,
- publish/runtime config generation rewiring.

That is more risk than needed for the first win.

## Validation

Phase 1 is successful when:

- public published-site traffic can be reasoned about independently from platform traffic,
- runtime route imports no longer sit on the same generic fallback surface as published sites,
- platform rate limits can be applied by host/surface without touching published-site behavior,
- public fallback pages and platform error behavior are no longer implicitly the same thing.

Phase 2 is only justified if:

- one shared Caddy process still creates unacceptable contention or operational ambiguity after the logical surface split.

## Recommendation

Start with:

1. one Caddy,
2. two logical surfaces,
3. surface-aware backend policy,
4. stricter platform-side rate limiting.

Only then evaluate:

5. two Caddy services or two origins,
6. external shield mapping by surface.
