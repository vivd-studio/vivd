# Docker Studio Image Reconciliation Plan

## Problem

The Docker Studio provider already has a scheduled reconciler and a warm recreate path, but image drift is still evaluated by comparing image reference strings.

That breaks down for floating or reused tags:

- `ghcr.io/vivd-studio/vivd-studio:latest` still compares equal after a newer image is pushed.
- local tags such as `vivd-studio:local` still compare equal after a rebuild retags the name to different content.
- the Super Admin UI only shows the configured tag/ref, so a running container can say `latest` without telling us which actual build or digest is running.

Today the provider also only pulls the Studio image on create when Docker says the image is missing. That means a self-hosted backend restart can keep serving an older cached Studio image forever unless the operator manually deletes it first.

## Goals

- Make Docker/self-hosted Studio image rollout behave like Fly in practice: stopped Studio runtimes should reconcile automatically onto the new Studio image after backend startup and during scheduled reconcile passes.
- Detect content drift even when the desired ref string is unchanged.
- Surface the actual running Studio build in Super Admin instead of only showing `:latest`.
- Keep the default reconcile behavior non-disruptive for active Studio sessions.

## Non-Goals

- Force-replacing running Docker Studio containers during the background reconcile loop.
- Requiring GHCR access for purely local image refs.

## Current Constraints

- `packages/backend/src/services/studioMachines/docker/provider.ts` currently stores `vivd_image` as the desired ref string and computes `imageOutdated` from string equality.
- `packages/backend/src/services/studioMachines/docker/imageResolver.ts` resolves the desired ref, but not the actual host-local image ID/digest behind that ref.
- the solo self-host install/docs path commonly pins `DOCKER_STUDIO_IMAGE=...:${VIVD_SELFHOST_IMAGE_TAG:-latest}`, so the image selector is locked and the Docker provider must handle `latest` correctly on its own.

## Proposed Design

### 1. Separate desired image ref from resolved image state

Add a Docker-specific image-state helper that resolves more than just the desired ref.

Suggested shape:

- `requestedRef`: configured ref such as `ghcr.io/vivd-studio/vivd-studio:latest`
- `imageId`: host-local Docker image ID
- `repoDigest`: resolved digest when available
- `versionLabel`: OCI version label when available
- `revisionLabel`: OCI revision label when available
- `source`: `local`, `pulled`, `cached`, or `unknown`
- `checkedAt`

Resolution rules:

- For registry-backed refs, the scheduled/manual reconcile flow should refresh the host-local image first, then inspect it.
- For local tags, inspect the local image directly and treat a changed image ID as drift even when the tag string is unchanged.
- Cache the resolved desired image state for list views, but force refresh it on manual reconcile and on the reconciler's startup/timer pass.

### 2. Extend the Docker API surface for image inspection

Add Docker API helpers for image inspection so the provider can compare actual content, not just refs.

Minimum additions:

- `inspectImage(imageRefOrId)`
- Docker image types exposing `Id`, `RepoDigests`, and `Config.Labels`
- extend container inspect typing to include the runtime image ID returned by Docker

This lets the provider compare:

- desired ref -> resolved desired image ID/digest
- running/stopped container -> actual image ID currently backing the container

### 3. Persist runtime image identity on containers

When creating or recreating a Studio container, persist the resolved image identity into labels alongside the human-readable ref.

Implemented label set:

- `vivd_image` (existing ref label retained as the human-readable requested ref)
- `vivd_image_id`
- `vivd_image_digest`
- `vivd_image_version`
- `vivd_image_revision`

Keep the ref label for readability and backward compatibility, but stop treating it as the sole source of truth for drift.

### 4. Make Docker reconcile content-aware

Update `resolveContainerReconcileState()` and summary generation so image drift is based on resolved content identity.

Recommended image-drift order:

1. If desired image state resolves to an image ID and the container image ID differs, mark outdated.
2. Else if both sides have digests and they differ, mark outdated.
3. Else fall back to ref comparison for legacy containers and degraded paths.
4. If the desired image state cannot be resolved, surface `unknown` instead of silently showing `ok`.

This same logic should be used by:

- `ensureRunningInner()`
- `warmReconcileContainer()`
- `reconcileStudioMachinesInner()`
- `listStudioMachines()`

## Reconciliation Flow

### Backend startup / scheduled reconcile

1. Resolve the desired Studio image ref.
2. Refresh/inspect the desired Docker image state on the host.
3. Scan Studio containers.
4. For stopped/exited containers with image drift, recreate -> start -> wait for `/health` -> stop.
5. Skip running containers, but report them as outdated so operators can see that they are still on older content.
6. Continue existing GC behavior for inactive containers.

### Runtime stop / idle-stop follow-up

Once a running container becomes stopped via park/idle cleanup/manual stop, prefer reconciling it immediately if the desired image state already says it is outdated. That avoids waiting for the next full reconcile interval to roll a container that just became eligible.

### Manual targeted reconcile

Keep the current safety rule: only reconcile non-running Docker Studio containers from the UI. The difference is that the operation should now refresh the desired image state first, so `latest` and local rebuilt tags actually roll forward.

## Super Admin UI

Extend `StudioMachineSummary` and the tRPC schema to expose both the desired image state and the actual runtime image state.

Recommended fields to surface:

- desired ref
- desired resolved version/digest
- actual runtime ref
- actual runtime image ID/digest
- actual runtime version/revision when available
- image status: `ok`, `outdated`, or `unknown`

UI changes:

- header should keep showing the desired ref, but also show what it currently resolves to
- each row should show the actual running build, not only `:latest`
- if the selector is env-locked, the UI should still make clear whether `latest` currently resolves to a newer build than the running container

## Image Build Metadata

The Studio image should publish explicit OCI labels so the UI can show a real version/build string instead of only a digest.

Add at least:

- `org.opencontainers.image.version`
- `org.opencontainers.image.revision`

Wire those labels into:

- `packages/studio/Dockerfile`
- `.github/workflows/publish.yml`
- `.github/workflows/publish-selfhost-arm64.yml`
- `scripts/push-images.sh`
- `scripts/push-studio.sh`

If labels are missing in local/manual builds, the UI should fall back to the digest or image ID.

## Tests

Add targeted coverage for the new behavior:

- Docker provider unit test: same tag string, different image ID -> image drift detected
- Docker provider unit test: desired `latest` refresh changes resolved image ID -> stopped container gets warm reconciled
- Docker provider unit test: local tag rebuild (`vivd-studio:local`) changes image ID without a registry pull
- Docker provider unit test: running outdated container is reported but not replaced by background reconcile
- Superadmin/router/UI tests: image summary exposes desired-vs-actual runtime identity and shows non-string drift correctly

If we later add a Docker integration smoke, it should prove the exact self-host case this plan targets:

- old Studio container on host
- newer Studio image available under the same tag/ref
- backend startup or manual reconcile replaces the stopped Studio container without manual image deletion

## Recommended Implementation Order

1. Add Docker image inspect support and a resolved desired-image-state helper.
2. Change Docker drift detection and summary generation to use image identity, not only ref strings.
3. Persist and expose runtime image metadata in the summary/tRPC/UI.
4. Add OCI version/revision labels to Studio image builds.
5. Update self-host docs to explain that Docker Studio reconciliation now follows resolved image content, including `latest`.
