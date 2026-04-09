# OpenCode Persistence

Use this playbook when Studio/OpenCode edits succeed locally but state is missing after restart, when revert/rehydrate smoke coverage is failing, or when the runtime event-to-persistence wiring is being changed.

## Failure Staging

Work from the inside out before changing code:

1. Local workspace mutation:
   - prove the file changed inside the running Studio container or local runtime workspace
   - if revert/unrevert works locally, the revert API is probably not the failing layer
2. Persisted OpenCode state on disk:
   - inspect `opencode.db`, `opencode.db-shm`, `opencode.db-wal`, `storage/session_diff`, and `snapshot`
3. Sync request:
   - inspect the sync-request path before blaming object storage
   - if the request is file-based today, prove whether the trigger is written, consumed, or never requested
4. Entrypoint bucket sync:
   - read `packages/studio/entrypoint.sh` and confirm the current runtime contract before changing tests
   - do not assume interval syncing exists unless the current file says so
5. Hydrate/restore after restart:
   - after a second boot, verify source plus OpenCode state landed back on disk before blaming revert or session tracking

## Current Repo Surfaces

- `packages/studio/server/opencode/useEvents.ts`
  Maps raw OpenCode events into Vivd's settle/idle callbacks.
- `packages/studio/server/opencode/index.ts`
  Decides when to emit `session.completed` and when to request a persistence sync.
- `packages/studio/server/services/sync/AgentTaskSyncService.ts`
  Writes the sync request only when bucket sync is configured.
- `packages/studio/entrypoint.sh`
  Owns hydrate plus the runtime sync loop.
- `scripts/studio-image-revert-smoke.mjs`
  Encodes the release-shaped contract and is the fastest way to localize where the flow broke.
- `vendor/opencode`
  Reference checkout for upstream event, session, and persistence semantics.

## Useful Live Checks

- `docker logs <studio-container>`
- `docker exec <studio-container> sh -lc 'head -n 3 /workspace/project/index.html'`
- `docker exec <studio-container> sh -lc 'find /root/.local/share/opencode -maxdepth 3 -type f | sort | tail -n 30'`
- `docker exec <studio-container> sh -lc 'ls -l /tmp/vivd-sync.trigger 2>/dev/null || true'`

Compare local workspace state and persisted OpenCode files before changing code. If the local file is correct but bucket state is absent, focus on persistence rather than revert logic.

## Common Failure Signatures

- Edit and revert work locally, but the smoke never reaches its persisted-state checkpoint:
  treat this as a persistence or sync failure, not a revert failure
- Source files and `opencode.db*` are missing in object storage after a successful local edit:
  the sync request and/or entrypoint sync loop is broken
- Local file changed but no `session.idle` or terminal `session.status` arrives:
  inspect the actual event stream instead of hardcoding assumptions about one event name
- State restores only when explicitly copied from the container, not via automatic restart:
  bucket persistence is incomplete or hydrate is only restoring part of the payload

## Change Strategy

- First separate completion from persistence if they were coupled.
- Then drive persistence from settled assistant activity, not from one hardcoded event name.
- Keep deduping at the request layer so multiple settle hints do not cause sync storms.
- Only add periodic syncing if the real product contract requires background durability independent of task settle or shutdown.

## Focused Protecting Tests

- `npm run test:run -w @vivd/studio -- server/opencode/useEvents.test.ts server/opencode/index.sessions.test.ts server/opencode/runTask.bucketSync.test.ts`
- `npm run typecheck -w @vivd/studio`
- `npm run build:studio:local`
- `STUDIO_IMAGE=vivd-studio:local npm run studio:image:revert-smoke`
- Optional heavier integration path when supported:
  - `VIVD_RUN_OPENCODE_REVERT_TESTS=1 npm run test:run -w @vivd/studio -- server/opencode/revert.integration.test.ts`
