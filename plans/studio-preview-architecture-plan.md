# Studio Preview Architecture Plan

## Why This Exists

Vivd's current live preview for dev-server projects is built around path-mounted Studio runtimes and best-effort response rewriting. That approach is pragmatic, but it is not robust enough if preview fidelity is a product requirement.

Recent failures make the problem concrete:

- Astro image URLs like `/_image?...` can render differently in preview than in published output.
- Async forms such as the contact-form plugin can trigger the preview loading overlay incorrectly and leave the preview visually stuck.
- Root-relative assets, redirects, router transitions, worker-like APIs, and inline script data all depend on browser origin semantics that are difficult to emulate under a nested path prefix.

The goal of this plan is to replace "best-effort path rewrite preview" with a transport model that behaves like a normal site running on a developer's machine.

## Problem Summary

Today, Studio embeds live preview behind nested routes such as:

- `/_studio/<runtime-id>/vivd-studio/...`
- `/vivd-studio/api/devpreview/:slug/v:version/...`

That forces Vivd to compensate with:

- response rewriting for HTML, CSS, JS, and selected string patterns
- injected runtime helpers that rewrite some browser APIs
- heuristic iframe listeners that guess whether clicks or form submits will cause navigation

This creates a long tail of framework-specific and browser-specific edge cases.

## Goals

- Make Studio live preview behave like a normal dev preview at the browser level.
- Ensure the product has an explicit "publish-fidelity" preview path that matches publish output exactly.
- Support both platform deployments and self-hosted deployments without requiring wildcard subdomains in the default self-host setup.
- Remove the need for most path-prefix response rewriting for live preview.
- Replace heuristic loading/navigation detection with explicit preview-runtime events.

## Non-Goals

- Do not change public published-site URLs as part of this work.
- Do not remove stable/shareable project preview URLs.
- Do not require wildcard DNS for self-hosted installs.
- Do not block on full deprecation of old routes before shipping the new architecture behind a flag.

## Proposed Model

### Two Preview Surfaces, Chosen by Context

Vivd should keep two distinct preview surfaces, but the product should choose
between them automatically instead of exposing a manual mode switch in normal UX:

1. Live Preview
   Fast, editable, framework-native preview for active Studio sessions.

2. Publish Preview
   Built artifact preview that matches publish output as closely as possible for
   project pages and share flows.

The product should stop implying that one preview surface can perfectly satisfy
both goals, while also avoiding unnecessary user-facing surface switching.

### Live Preview Transport

Live preview should run on a real browser origin for each Studio runtime.

Recommended runtime layout:

- `/` = live preview site root
- `/vivd-studio` = Studio app shell
- `/vivd-studio/api/*` = Studio APIs
- optional internal-only helper routes remain under `/vivd-studio/*`

This avoids nesting the preview itself under `/preview` or `/devpreview/...`, which is the main source of root-relative URL drift.

### Runtime URL Strategy by Deployment Mode

#### Platform

Use a dedicated host/subdomain per running Studio runtime.

Examples:

- `https://rt-7f3c2a.preview.vivd.studio/`
- `https://rt-5b91d0.preview.customer-vivd.net/`

The hostname can be an opaque runtime ID. It does not need to encode project/version identity.

#### Self-Hosted Default

Use a dedicated origin by port, not by subdomain.

Examples:

- `http://localhost:4107/`
- `https://example.com:4107/`

This keeps the browser origin correct without requiring wildcard DNS or wildcard TLS.

#### Self-Hosted Advanced

If a self-hosted operator has wildcard DNS/TLS available, allow the same host-based runtime model as platform, but treat that as an optional enhancement, not the baseline requirement.

## Preview Identity Model

Use two identifiers:

- Ephemeral runtime identity
  Used for the actual live Studio session transport.

- Stable project/version preview identity
  Used for shareable preview URLs and publish-adjacent preview UX.

This implies:

- internal Studio embedding can use runtime URLs such as `rt-7f3c2a.preview.vivd.studio`
- external/shareable preview should remain stable at the project/version level

## Preview Bridge

Once the preview is on its own origin, the control-plane host cannot rely on direct `iframe.contentWindow` and `iframe.contentDocument` access for core behavior.

Studio therefore needs a first-class preview bridge using `postMessage`.

### Bridge Responsibilities

- announce preview readiness
- report location changes
- report navigation start and navigation completion
- expose selection/highlight/edit affordances
- report preview-side errors relevant to Studio
- coordinate asset-drop/edit overlays where needed

### Bridge Principles

- explicit messages instead of click/submit heuristics
- versioned message schema
- origin validation on both sides
- graceful no-bridge fallback during migration

## Loading State Model

The current loading behavior is too heuristic and too easy to wedge.

Target behavior:

- loading starts only on explicit `navigation-start` bridge events or actual iframe navigations
- loading ends on explicit `navigation-complete` bridge events or iframe `load`
- same-document async operations such as `fetch` form submits must not trigger page-loading UI
- add a watchdog timeout so the iframe can never remain hidden indefinitely

## Publish Preview Model

Publish Preview should continue to be build/artifact based for compiled frameworks such as Astro.

This surface should be treated as the canonical answer to:

"What will the published site actually look like?"

Studio should make this distinction visible in the product rather than forcing the live preview transport to carry publish-fidelity guarantees it cannot reliably satisfy.

## Provider and Runtime Changes

### Studio Machine Providers

Providers should return a runtime URL that is a real origin:

- local provider: already close to the target because it returns host+port URLs
- Fly/platform provider: should prefer host-based runtime origins
- Docker/self-host provider: should support port-based runtime origins as the default path for live Studio sessions

### Path-Mounted Runtime Routes

Path-mounted routes like `/_studio/...` should become compatibility-only for existing flows during migration.

Long term:

- keep them only where they are truly needed for backwards compatibility
- stop using them as the primary live-preview transport for dev-server projects

## Migration Plan

### Phase 0: RFC and Transport Spike

- finalize runtime URL strategy per provider
- validate auth/bootstrap across same-origin and cross-origin runtime layouts
- confirm the Studio app can bootstrap against a runtime-root deployment

### Phase 1: Runtime Root Support

- add provider/runtime support for root-served live preview
- serve Studio app at `/vivd-studio`
- serve preview site at `/`
- keep existing path-mounted mode behind a compatibility flag

### Phase 2: Preview Bridge

- introduce a typed `postMessage` bridge
- move location sync, navigation sync, selector/highlight, and readiness signaling onto the bridge
- remove submit/click-based loading heuristics where bridge coverage exists

### Phase 3: Product Split

- keep the product split implicit: project page/share flows use Publish Preview, Studio uses Live Preview
- use built preview for the "matches publish" promise on the project page/shareable surface
- keep Live Preview optimized for edit speed and interaction fidelity

### Phase 4: Default Cutover

- enable root-origin live preview by default for dev-server projects
- keep path-mounted preview as an opt-out fallback until confidence is high

### Phase 5: Compatibility Cleanup

- remove most text-rewrite logic for live preview paths
- delete obsolete iframe heuristic code
- retain only the minimum legacy compatibility surface needed for older installs

## Testing Plan

Add end-to-end and targeted regression coverage for:

- Astro `Image` and `/_image` flows
- root-relative asset URLs
- runtime-generated image URLs inside inline JSON/script data
- async form submits using `fetch`
- redirecting forms and success redirects
- client-side router navigations
- publish-preview equality checks for Astro
- CSP-restricted pages where inline injection behavior changes
- self-host port-based runtime URLs
- platform host-based runtime URLs

## Open Questions

- How much of the current edit-mode DOM patching should move into the new preview bridge versus staying as same-origin-only behavior on runtime-hosted Studio?
- Do we want a stable runtime hostname per project/version in platform mode, or only ephemeral runtime IDs plus stable shareable preview URLs?
- What minimum self-host ergonomics are acceptable for port-based runtimes in solo installs?

## Recommended Decision

Adopt this architecture and stop expanding the current path-rewrite live preview as the mainline solution.

Short version:

- Platform live preview: per-runtime host/subdomain
- Self-hosted live preview: per-runtime port by default, optional host-based mode with wildcard DNS/TLS
- Shareable/public preview: stable project/version URL
- Publish-fidelity preview: built artifact
- Product UX: context-sensitive selection, with Publish Preview on the project page and Live Preview automatically inside Studio
- Studio/preview coordination: explicit `postMessage` bridge
