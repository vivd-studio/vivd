# Publishing Flow Review (Control Plane + Studio)

Date: 2026-02-14  
Owner: backend + frontend + studio  
Status: findings + proposed hardening (no implementation in this doc)

This document captures a code-review of Vivd’s publishing flow and proposes a refactor + test plan to make it simpler and more robust.

Related docs:
- `plans/publishing-bucket-first-plan.md` (original consolidation plan; this doc is the follow-up hardening/refactor/test planning)
- `plans/tenant-subdomain-domain-governance-plan.md` (domain registry + host routing governance)

---

## Scope

- Domain publishing flow (publish/unpublish) and its UI gating.
- Artifact readiness / commit-hash compare-and-swap behavior.
- Caddy snippet generation + reload mechanics.
- Duplication between control-plane UI and Studio connected-mode UI.
- Test strategy for the full end-to-end publishing pipeline + key edge cases.

Out of scope:
- Replacing Caddy-based local serving with direct bucket serving.
- Re-architecting object storage / artifact formats (except where required for correctness).

---

## Current Flow Map (what happens today)

### Control plane (frontend)

UI: `packages/frontend/src/components/projects/publish/PublishSiteDialog.tsx`

1. Polls:
   - `project.publishStatus` (published domain + publishedAt + version)
   - `project.publishState` (artifact readiness + commit hashes + Studio safety hints)
   - `project.publishChecklist` (checklist status + freshness)
2. Debounces and validates domain via `project.checkDomain`.
3. Blocks publish if:
   - artifact not ready / build in progress
   - domain not allowed or not available
   - object storage not enabled
   - Studio indicates unsaved changes / older snapshot / state unavailable
   - publishable artifact commit hash does not match “target” commit hash
4. Calls `project.publish` with `expectedCommitHash` (a CAS guard), then invalidates queries.

### Control plane (backend)

Router: `packages/backend/src/trpcRouters/project/publish.ts`

1. Validates allowlist via `domainService.ensurePublishDomainEnabled`.
2. Applies Studio-safety checks (based on live in-memory studio workspace-state reporting):
   - blocks publish if Studio is running and state is stale/unavailable
   - blocks if there are unsaved changes
   - blocks if Studio is viewing an older snapshot
3. Calls `publishService.publish(...)`.
4. Maps `PublishConflictError` to tRPC `CONFLICT` errors.

### Publish orchestration (backend service)

Service: `packages/backend/src/services/PublishService.ts`

`PublishService.publish()` currently does all of the following:
- Validate + normalize domain (delegates to `DomainService` for most of this).
- Re-check allowlist and domain availability (DB uniqueness + exclude current project).
- Resolve a “publishable artifact” from bucket metadata and presence checks:
  - `resolvePublishableArtifactState` in `packages/backend/src/services/ProjectArtifactStateService.ts`
  - chooses `source` for generic/static, `preview` for Astro-style builds
  - enforces readiness (`ready` vs `build_in_progress` / `artifact_not_ready`)
  - enforces `expectedCommitHash` CAS check
- Materialize the artifact locally:
  - download bucket prefix into a staging dir
  - delete existing `/srv/published/<org>/<slug>` and copy in new files
  - parse `redirects.json` from artifact (and fallback for Astro) and render Caddy `redir` blocks
- Best-effort: upload `published/` artifact back to bucket.
- Write/update Caddy snippet in `/etc/caddy/sites.d/*.caddy` and call Caddy admin API `/load`.
- Upsert the `published_site` DB row.

### Studio (connected vs standalone)

Studio UI: `packages/studio/client/src/components/publish/PublishDialog.tsx`

- **Connected mode:** duplicates most of the control-plane’s domain publishing gating + disabled-reason logic, and calls backend publish through a proxy.
- **Standalone mode:** “publish” is a local git tag + best-effort artifact uploads; domain publishing is not available.

Studio server proxy: `packages/studio/server/trpcRouters/project.ts`
- `callConnectedBackendQuery/Mutation` forward Studio requests to backend tRPC via HTTP, using `Authorization: Bearer <session token>`.

---

## Code Health Assessment

### Not “total spaghetti”, but high-friction in two places

1. **`PublishService` is a god-object**
   - It mixes: bucket artifact selection, filesystem operations, redirect parsing, Caddy config generation, Caddy reload, and DB writes.
   - This makes it hard to test and hard to reason about partial failure modes.

2. **Connected-mode publishing logic is duplicated in UI**
   - Domain-input completeness heuristics, debouncing, disabled reasons, and “publish target commit hash” selection appear in both:
     - `PublishSiteDialog.tsx` (control plane)
     - `PublishDialog.tsx` (Studio connected mode)
   - This duplication risks drift (one UI “allows publish” while the other blocks, or different reasons/messages).

---

## Robustness & Correctness Gaps (priority hardening list)

### 1) Non-atomic publish materialization (downtime/partial state risk)

Current behavior deletes the live published directory and then copies the new content in.

Risk:
- If copy fails mid-way (disk issues, partial artifact download, unexpected files), the site can be partially missing.

Desired:
- Stage → atomic swap:
  - materialize into `/srv/published/<org>/<slug>.tmp-*`
  - then `rename()` into place (or `swap` via a stable symlink)
  - only then clean up old content

### 2) Caddy snippet filename collisions

Current snippet naming is `domain.replace(/\./g, "-") + ".caddy"`.

Risk:
- `a-b.com` and `a.b.com` collide (both become `a-b-com.caddy`).

Desired:
- Collision-proof filenames (e.g. `domain--<hash>.caddy`, or `encodeURIComponent`-style escaping that preserves dots and hyphens unambiguously).

### 3) Publish “success” even when Caddy reload fails

`reloadCaddy()` logs errors but doesn’t throw. That means publish can return success even if routing wasn’t reloaded.

Desired:
- Decide semantics:
  - **Strict:** fail the publish if reload fails (recommended for prod).
  - **Soft:** return success-but-warn with explicit “routing update failed” state.

### 4) Locking is in-memory + publish-only

- `withPublishLock` only guards `publish()` and only within a single node process.
- `unpublish()` is not locked.

Risk:
- Multi-replica backend (or concurrent requests) can interleave publish/unpublish and corrupt Caddy snippet / published dir state.

Desired:
- Enforce a consistent locking strategy:
  - local dev: in-memory OK
  - prod: DB advisory lock (Postgres) or another distributed lock
  - include unpublish in same lock key

### 5) Redirect token safety checks are permissive

`isSafeCaddyToken` rejects whitespace/control chars only.

Risk:
- Accidental invalid Caddy tokens; harder-to-audit redirect rule outputs.

Desired:
- Either tighten token validation to a conservative allowlist, or escape/quote more robustly in rendered snippets.

---

## Simplification / Refactor Plan (incremental, low-risk)

This is designed to be shipped in small PRs while keeping behavior stable.

### Step 1: Split `PublishService` into composable units

Keep `PublishService.publish()` as an orchestrator, but extract pure-ish components:
- Redirect manifest parsing + validation.
- Redirect → Caddy block rendering.
- Caddy snippet string builder.
- Filesystem publisher (“stage + atomic swap”).
- Caddy reload client (HTTP).
- Published site repository wrapper (DB reads/writes).

Goal:
- Make most logic unit-testable without bucket/DB/Caddy.

### Step 2: Make artifact materialization atomic

- Download artifact into staging dir.
- Copy to a new “next” publish dir.
- Swap it into place atomically.
- Only after successful swap:
  - write the new Caddy snippet
  - reload Caddy
  - upsert DB mapping

### Step 3: Fix snippet naming + update remove logic

- Replace `domain.replace(/\./g, "-")` with a collision-proof mapping.
- Ensure `removeCaddyConfig()` uses the same mapping (and can still delete legacy filenames during transition if needed).

### Step 4: Decide & enforce reload failure semantics

- In prod: prefer strict semantics (publish should fail if routing reload fails).
- In dev: allow “reload skipped” if Caddy isn’t running, but do not silently claim success if it matters for correctness.

### Step 5: Remove duplicate allowlist checks from router/service boundary

Today both router and service call `ensurePublishDomainEnabled`.

Option A (preferred):
- Only `PublishService.publish()` enforces allowlist + domain validation + availability.
- Router only does: input validation + auth + studio safety checks + error mapping.

Option B:
- Router owns allowlist; service assumes allowed. (Harder to reuse safely.)

### Step 6: Deduplicate connected publish UI logic

Extract a shared helper (or shared hook) for:
- domain “complete enough” heuristics + debounce policy
- publish readiness → disabled reason mapping
- publish target commit selection logic (`studioHeadCommitHash` vs `publishableCommitHash`)

Reuse it in both:
- control-plane `PublishSiteDialog`
- Studio connected-mode `PublishDialog`

---

## Test Plan (meaningful integration + edge coverage)

Target: verify the *entire publish pipeline* and the failure modes users actually hit.

### Backend unit tests (Vitest)

Fast, no DB/bucket required.

1. `redirects.json` parsing + validation
   - invalid JSON, wrong shapes, missing keys
   - wildcard handling (`/*` only, single `*` in destination only when prefix rule)
   - disallow Studio routes (`/vivd-studio`)
   - status codes limited to {301, 302, 307, 308}

2. Redirect → Caddy rendering
   - exact match vs prefix match rules
   - correct placeholder substitution for prefix rules

3. Caddy snippet filename mapping
   - explicit collision tests (`a-b.com` vs `a.b.com`)
   - ensure remove uses same mapping

4. “Publish readiness” mapping helpers (once extracted)
   - convert a `publishState` + domain state into a deterministic disabled reason

### Backend integration tests (Vitest “integration” suite)

These should run under `packages/backend/test/integration/**` and can:
- use a real Postgres (docker-compose or a test DB)
- stub bucket operations (or run against a local S3-compatible endpoint if available)
- mock Caddy reload HTTP call

Recommended integration scenarios:
1. Publish happy path
   - creates/updates `published_site`
   - writes the snippet
   - materializes published files

2. Republish same project/domain (idempotent-ish)
3. Switch domain for an already published project
   - old snippet removed only after new snippet is written (and reload succeeds)

4. Conflict & validation failures
   - domain in use by another project
   - allowlist missing / inactive / pending verification
   - artifact readiness: build in progress / not ready / not found
   - `expectedCommitHash` mismatch → deterministic `CONFLICT` response
   - invalid redirects manifest → deterministic error surfaced to UI

5. Concurrency semantics (define expected outcome)
   - publish + unpublish racing the same project should serialize and end in a consistent state

### End-to-end smoke (optional, highest confidence)

Docker-compose based E2E (if/when desired):
- start backend + caddy + postgres
- seed a minimal artifact in bucket (or via a test double)
- publish a domain
- verify:
  - Caddy route exists (e.g. `curl -H Host: ...` returns the expected HTML)
  - `/vivd-studio` routes still proxy correctly

---

## Open Decisions (need explicit answers)

1. Backend deployment topology:
   - single instance only, or multiple replicas?
   - if multiple: do we implement a distributed lock (DB advisory lock) for publish/unpublish?

2. Caddy reload failure semantics in production:
   - strict fail vs soft success-but-warn?

3. Atomic publish approach preference:
   - directory rename swap vs stable symlink pointer (symlink can be attractive but must be safe with Docker volumes and Caddy file_server behavior).

