# Async Preview Builder Plan

Date: 2026-04-28
Owner: platform/runtime
Status: planned

## Why This Exists

Preview artifact builds can still run inside the control-plane backend request path. That means a dependency install or Astro build can consume CPU, memory, disk, and event-loop attention in the same process that should keep projects, tenants, and Studio orchestration responsive.

Vivd already has a `packages/builder` runtime and a builder Docker image shape, but the backend does not yet have a job service or provider implementation that actually starts builder jobs. Until that exists, the builder is an available runtime package rather than an operational isolation boundary.

## Current State

Already present:

- `packages/builder` can hydrate a project source artifact from object storage.
- It can detect Astro projects, install dependencies, run `astro build`, upload preview/published artifacts, and write artifact build metadata.
- Docker and Fly provider config already expose builder image, CPU, and memory settings.

Missing:

- no backend build queue or build-job table,
- no provider-neutral `BuilderJobProvider`,
- no Docker one-shot container runner,
- no Fly one-shot machine runner,
- no retry/stale-job/cancellation policy,
- no UI state that cleanly separates source readiness from preview readiness everywhere,
- no production-shaped tests proving that a build leaves the backend request path.

## Architecture Decision

Builder jobs should be short-lived and isolated by default.

For the VPS/Docker path, the backend should start a one-shot builder container for each queued job, pass the project/version/kind through environment variables, wait for the container to exit or track it asynchronously, then remove it after logs/status have been captured. The builder image does not need to run constantly in V1.

For Fly-hosted runtime, the backend should create a one-shot builder machine using the configured builder image and guest resources, let it exit after one job, then destroy or garbage-collect it. A warm pool can be considered later only if startup latency becomes a product problem.

The backend remains the control plane:

- it records the job,
- marks artifact metadata as `pending` or `building`,
- starts the provider job,
- observes completion,
- exposes status to the frontend.

The builder runtime does the expensive and untrusted work:

- hydrate source,
- install dependencies,
- build,
- upload artifacts,
- write final build metadata.

## Goals

- Remove dependency install/build work from backend API request handlers.
- Keep unrelated tenants responsive while preview artifacts are building.
- Make source readiness independent from preview readiness.
- Use the same builder contract for imports, project duplication, generated projects, preview rebuilds, and publish builds where applicable.
- Keep builder jobs bounded by concurrency, timeout, CPU, memory, disk cleanup, and stale-job checks.
- Capture enough logs and metadata to explain failures without dumping raw terminal noise into project cards.
- Reuse or share dependency repair behavior with Studio so builder and Studio do not drift.

## Non-Goals

- Do not build a general-purpose user-facing import product as part of this plan.
- Do not require a successful preview artifact build before a project can open in Studio.
- Do not introduce a permanent worker fleet for V1 unless the short-lived provider path proves too slow.
- Do not move Studio live preview/dev-server ownership into the builder.

## Build Lifecycle

1. Backend receives a source-changing operation.
2. Backend writes the canonical `source/` artifact and records the current commit hash.
3. Backend writes preview build metadata with `status: "pending"` and the commit hash.
4. Backend enqueues a builder job for `{ organizationId, slug, version, kind, commitHash }`.
5. Builder provider starts an isolated one-shot runtime.
6. Builder downloads `source/`, installs/builds if needed, uploads `preview/` or `published/`, and writes final metadata.
7. Backend job observer records `ready`, `error`, `stale`, or `timed_out`.
8. Frontend polls project/artifact state and shows preview readiness separately from project/source readiness.

Stale-job rule: if a newer commit hash has already requested the same artifact kind, older jobs may finish but must not overwrite the newer build metadata or artifacts.

## Backend Services

Add a small backend orchestration layer:

- `ProjectBuildJobService`
  - creates jobs,
  - enforces per-instance concurrency,
  - deduplicates same project/version/kind/commit requests,
  - records status, attempts, timestamps, and error summaries.
- `BuilderJobProvider`
  - provider-neutral interface for starting and observing a job.
- `DockerBuilderJobProvider`
  - starts one-shot Docker containers on self-host/VPS installs.
- `FlyBuilderJobProvider`
  - starts one-shot Fly machines for hosted/runtime-managed environments.
- `LocalBuilderJobProvider`
  - optional development-only fallback that runs the builder CLI as a child process, still outside the request handler.

Suggested job statuses:

- `queued`
- `starting`
- `running`
- `ready`
- `error`
- `stale`
- `timed_out`
- `cancelled`

## Data Model

Add a Drizzle migration for a build-job table, for example `project_build_job`:

- `id`
- `organizationId`
- `projectSlug`
- `version`
- `kind`
- `commitHash`
- `status`
- `provider`
- `providerJobId`
- `attempt`
- `createdAt`
- `startedAt`
- `completedAt`
- `timeoutAt`
- `errorSummary`
- `logKey` or compact log excerpt

Artifact metadata remains the frontend-facing source of truth for preview readiness. The job table is for orchestration, debugging, retries, and cleanup.

## Provider Behavior

### Docker / VPS

- Backend requires Docker access through the configured socket or API base URL.
- Backend starts a one-shot container from `DOCKER_BUILDER_IMAGE` or `DOCKER_BUILDER_IMAGE_REPO`.
- Container receives object-storage env plus `VIVD_BUILDER_ORGANIZATION_ID`, `VIVD_PROJECT_SLUG`, `VIVD_PROJECT_VERSION`, `VIVD_BUILDER_KIND`, and optional `VIVD_BUILD_COMMIT_HASH`.
- Container uses configured CPU and memory limits.
- Container exits after one job.
- Backend captures logs, records status, and removes the container.

Default VPS behavior: no constantly running builder container. The backend starts builder containers only when build jobs exist.

### Fly

- Backend creates a one-shot machine from `FLY_BUILDER_IMAGE` or `FLY_BUILDER_IMAGE_REPO`.
- Machine gets builder guest resources from `FLY_BUILDER_*` config.
- Machine runs one job and exits.
- Backend observes completion and destroys or garbage-collects the machine.

### Local Development

- Local dev may use a child-process provider for convenience.
- It must still be asynchronous from the request handler and use the same job/status path.

## First Implementation Slices

1. Add the build-job service, schema, and fake provider tests.
2. Add artifact state/status APIs that clearly expose source readiness and preview readiness.
3. Add Docker one-shot builder provider and tests with provider calls mocked at the Docker API boundary.
4. Move project import, duplicate/copy, and generation preview builds from `buildSync` to queued builder jobs.
5. Add frontend status copy for `preview pending/building/failed/ready`.
6. Add Fly one-shot builder provider.
7. Extract shared dependency install/repair helpers used by builder and Studio.
8. Add production-shaped smoke coverage proving a long build does not block project listing for another tenant.

## Validation Plan

Backend:

- job service unit tests for dedupe, stale jobs, retry limits, timeout, and concurrency,
- provider tests for Docker/Fly request payloads,
- artifact state tests for source-ready/preview-pending/preview-error combinations,
- mutation tests proving source-changing operations enqueue instead of calling `buildSync`,
- `npm run typecheck -w @vivd/backend`.

Builder:

- `npm run typecheck -w @vivd/builder`,
- focused builder runtime tests for stale commit metadata,
- dependency repair tests once the shared install helper lands.

Frontend:

- project card/list tests for preview pending/building/error states,
- `npm run typecheck -w @vivd/frontend`.

Production-shaped:

- start a slow Astro build and confirm project listing remains responsive,
- confirm another tenant can open while the builder job runs,
- confirm failed preview build leaves source/Studio access intact,
- confirm Docker/VPS builder container exits and is removed after completion,
- confirm Fly builder machine is destroyed or eligible for cleanup.

## Risks And Mitigations

- Docker socket access expands backend operational power. Keep this path self-host/VPS scoped, document it in self-host config, and avoid exposing generic container controls through public APIs.
- Builder startup latency may make preview artifacts feel slower. Start with clear pending/building UI and revisit a warm pool only if measured latency is bad.
- Object-storage credentials inside builder jobs must be scoped to artifact operations where the provider supports that. At minimum, avoid logging secrets and keep job env explicit.
- Duplicate builds can waste resources. Deduplicate by project/version/kind/commit hash and mark older jobs stale.
- Long installs can exhaust disk. Use one-shot temp directories, container cleanup, and provider-level disk/resource limits.

## Open Questions

- Should publish builds and preview builds share one queue immediately, or should publish keep its current path until preview isolation is proven?
- Do we want full build logs in object storage, compact excerpts in the DB, or both?
- Should failed preview artifact builds have a manual retry action on the project card, version panel, or both?
- Should hosted Fly builder machines run in the same app as Studio machines or a dedicated builder app?
- Should Docker/VPS installs default to concurrency `1` even on multi-core hosts?
