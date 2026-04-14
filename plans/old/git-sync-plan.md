# Git Sync Plan (GitHub ↔ Studio ↔ Bucket)

**Goal:** Let users make changes on GitHub and reliably pull them into a Vivd project workspace, while keeping the bucket-backed source/artifacts consistent for preview/publish and future studio boots.

This document focuses on *GitHub pull into Vivd* in the current bucket-first + studio-machine architecture, including conflict/overwrite behaviors.

---

## Current Architecture (as implemented)

### Where the “real” workspace lives

- **Studio machine workspace is a Git repo**:
  - `packages/studio/server/workspace/WorkspaceManager.ts` initializes/operates git in the workspace directory.
  - “Snapshots” are git commits created from the studio UI via `gitSave`.
  - Studio supports “viewing older snapshot” via `.vivd-working-commit` marker (files can be checked out from an older commit without moving `HEAD`).

### Source-of-truth for preview + publish

- **Object storage is the source of truth**:
  - Bucket prefixes contain **source**, **preview**, and **published** artifacts.
  - Control plane resolves “what’s publishable” from bucket state via `resolvePublishableArtifactState`:
    - `packages/backend/src/services/ProjectArtifactStateService.ts`
  - Publish hydrates bucket artifacts to Caddy-served publish dir:
    - `packages/backend/src/services/PublishService.ts`

### How the bucket is kept up-to-date

- **Studio → Bucket sync**
  - Studio periodically syncs local workspace files to bucket in the container entrypoint:
    - `packages/studio/entrypoint.sh` (`aws s3 sync` without `--delete`)
  - Studio also syncs source after saves and snapshots from Node code:
    - `packages/studio/server/services/ArtifactSyncService.ts` (`syncSourceToBucket`)
  - For Astro projects, studio also builds and uploads preview/published artifacts.

### GitHub integration (today)

- **Push exists**:
  - On snapshot commit, studio pushes `HEAD:main` to GitHub:
    - `packages/studio/server/services/GitHubSyncService.ts`
- **Pull is backend-only / best-effort**:
  - Control plane contains a `GitService.syncPullFromGitHub` that only helps when the backend actually has a local version directory:
    - `packages/backend/src/services/GitService.ts`
  - In bucket-first SaaS, the backend typically does *not* own the live workspace; it only sees bucket artifacts.

---

## Problem Statement

We effectively have **three states that can drift**:

1) **Studio workspace** (local files + local git history)  
2) **Bucket “source” prefix** (what new studios hydrate + what generic preview/publish uses)  
3) **GitHub remote** (optional upstream/mirror)

If we “pull from GitHub” but don’t also make the bucket match, previews/publishes (and the next studio boot) can show a different version than what was pulled.

Additionally, current **source sync is upload-only** (no delete) in multiple places. This can cause **ghost files**:

- If GitHub deletes/renames a file and we pull, that deletion may not propagate to the bucket unless we sync with delete semantics.

---

## Design Goals / Non-Goals

### Goals

- **Reliable GitHub → Studio → Bucket** flow:
  - Pull should update the studio workspace and then update bucket-backed source/preview state.
- **Safe-by-default**:
  - Avoid implicit merges/rebases/conflict states in MVP.
  - Provide clear UI for “fast-forward pull” vs “force overwrite”.
- **Deterministic publish/preview**:
  - After a successful pull/reset, bucket artifacts should reflect that state (including deletions where applicable).

### Non-goals (MVP)

- Interactive conflict resolution UI.
- Multi-writer concurrency (two studios editing the same project/version at once) beyond “best-effort safety checks”.

---

## Proposed Approach (incremental MVP)

### Principle: “Pull happens on the Studio machine”

Implement GitHub pull/sync operations in the **studio server**, not the control plane backend.

Rationale:
- The studio machine owns the live workspace and can atomically:
  - pause sync loop,
  - fetch/pull/reset git,
  - rebuild preview (Astro),
  - sync the resulting state to the bucket.

### Add a GitHub sync status endpoint (Studio)

Expose a studio tRPC query that performs a `git fetch` and reports:
- `hasUncommittedChanges` (via `WorkspaceManager.hasChanges()`)
- `workingCommitPinned` (if `.vivd-working-commit` exists and differs from `HEAD`)
- current branch / detached state
- `ahead/behind/diverged` vs `${remote}/main`
- remote repo existence and “main branch exists” diagnostics

The UI uses this to guide the user (and to enable/disable safe actions).

### Two user actions

#### A) **Pull (fast-forward only)** — default, safe

Only allow if:
- not viewing an older snapshot (no working commit pin),
- no local uncommitted changes,
- not detached HEAD,
- remote has `main`,
- and local history is strictly behind remote (`behind > 0`, `ahead === 0`).

Operation:
- `git fetch` (auth via `http.extraHeader`)
- `git merge --ff-only origin/main`

After success:
- `syncSourceToBucket({ commitHash: HEAD })`
- if Astro: `buildAndUploadPreview({ commitHash: HEAD })`
- trigger thumbnail refresh (existing pattern after snapshot saves)

#### B) **Force sync from GitHub (overwrite)** — explicit, destructive

Use when:
- local changes exist,
- viewing older snapshot,
- histories diverged,
- or user explicitly wants “GitHub wins”.

Recommended safety:
- require user to create a snapshot first *or* automatically create a backup branch/tag before overwrite.

Operation:
- pause bucket sync loop (see “Concurrency” below)
- `git fetch`
- `git reset --hard origin/main`
- `git clean -fd`

After success:
- perform an **exact bucket sync** (see next section)
- rebuild preview for Astro
- refresh thumbnails/state

---

## Bucket Correctness: “Exact sync” for overwrite mode

To ensure GitHub deletions propagate to bucket, overwrite mode should sync with delete semantics:

- **Delete** the `source` prefix first, then upload workspace, **or**
- run `aws s3 sync --delete` (or SDK equivalent) for that single operation.

Notes:
- `packages/studio/server/services/ArtifactSyncService.ts` already has a `syncDirectoryToBucket({ delete })` primitive (used for preview/published). The `source` sync can add an “exact” mode that sets `delete: true` when invoked by “force sync”.
- The entrypoint periodic sync loop in `packages/studio/entrypoint.sh` is upload-only; the “force sync” operation should do at least one delete-sync so the bucket state becomes exact.

Also consider excluding `.git/index.lock` in `entrypoint.sh` sync exclude list (Node uploader already excludes it) to reduce lock churn.

---

## Concurrency / Reliability

### Pause bucket sync while mutating git

The studio container already supports pausing the sync loop using:
- `VIVD_SYNC_PAUSE_FILE` (default `/tmp/vivd-sync.pause`) in `packages/studio/entrypoint.sh`

Dev server install uses this technique in:
- `packages/studio/server/services/DevServerService.ts`

For pull/reset operations:
- create pause file before git operations,
- remove pause file after bucket sync completes.

### Serialize all git operations

`WorkspaceManager` queues git operations internally.

However, `GitHubSyncService` currently shells out to git outside of `WorkspaceManager`’s lock. For pull/reset we should ensure:
- push/pull/reset happen through a single serialized path (either by moving these into `WorkspaceManager` or by adding a shared lock in a GitHub sync service that wraps git calls).

---

## UI Integration (Studio)

Target component:
- `packages/studio/client/src/components/projects/versioning/VersionHistoryPanel.tsx`

Add a “GitHub Sync” section:
- (Connected mode) **super-admin only** for now.
- show status: Up to date / Behind / Ahead / Diverged / Local changes / Viewing older snapshot
- buttons:
  - **Pull** (enabled only when fast-forward safe)
  - **Force sync** (confirmation dialog; recommends snapshot backup)

On success, invalidate:
- `gitHistory`, `gitHasChanges`, `gitWorkingCommit`
- any preview state that depends on bucket artifacts (existing refresh hooks)

---

## Repo Mapping (important open decision)

Current repo naming is **per project version**:
- `${slug}-v${version}` (plus optional org/tenant prefix rules)
- implemented in both backend and studio GitHub sync code

This is workable for MVP, but may not match user expectations (“one repo per project”).

Open decision:
- **Per-version repos** (current): simplest, but more repos.
- **Single repo per project**: versions become tags/branches; better DX, but requires migration + new conventions.

---

## Rollout Plan

1) Implement studio-side “GitHub sync status” query + UI display.
2) Implement **Pull (ff-only)** + post-pull bucket sync + preview rebuild.
3) Implement **Force sync (overwrite)** with:
   - explicit confirmation
   - backup strategy (tag/branch or “snapshot required”)
   - exact bucket sync (delete + upload)
4) Optional: surface sync status in the control plane app (read-only) by asking the connected studio to report it, similar to `reportWorkspaceState`.

---

## Open Questions

- For force sync, should we:
  - require a manual “Save snapshot” first, or
  - auto-create a backup tag/branch (and where do we surface it in the UI)?
- Do we support merges/rebases/conflicts at all, or keep the model:
  - “fast-forward only” + “overwrite”?
- Should hydration from bucket ever use `--delete` (or a clean workspace) on “hard restart” to avoid local ghost files?
- Do we keep per-version repos, or move to per-project repos?
