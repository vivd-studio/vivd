# Scratch Wizard Large Uploads Plan (2026-01)

## Problem

Creating a new website “from scratch” fails in prod when the user selects many images at once.

Observed backend error:

- `PayloadTooLargeError: request entity too large`

## Root Cause (current implementation)

- The Scratch Wizard base64-encodes every selected image and sends them inside the tRPC JSON payload:
  - `frontend/src/pages/scratch-wizard/ScratchWizardContext.tsx` (`fileToBase64(...)` → `trpc.project.generateFromScratch.useMutation`)
- The backend JSON body parser is capped at `50mb`:
  - `backend/src/server.ts` (`app.use(express.json({ limit: "50mb" }))`)
- Result: large batches exceed the JSON limit before the tRPC handler runs.
- UX issue: base64 conversion happens **before** the mutation starts, so the UI can look “stuck” during conversion/upload.

## Goals

- Allow uploading many images (dozens/hundreds) when creating a project.
- Show a clear upload loading state + progress (separate from “generation” progress).
- Make the flow robust:
  - batch uploads
  - retries
  - sensible limits (files/bytes)
  - helpful error messages (incl. 413/limits)
  - cleanup on failure

## Non-goals (for first iteration)

- True resumable/chunked uploads across network reconnects.
- CDN-backed direct-to-object-storage uploads.

## Current Relevant Code

- Frontend scratch wizard:
  - `frontend/src/pages/scratch-wizard/ScratchWizardContext.tsx`
  - `frontend/src/pages/scratch-wizard/ScratchForm.tsx`
  - `frontend/src/pages/scratch-wizard/types.ts` (`fileToBase64`)
- Backend scratch generation:
  - `backend/src/routers/project/generation.ts` (`generateFromScratch` expects `{ assets: [{filename, base64}] }`)
  - `backend/src/generator/flows/scratchFlow.ts` (decodes base64 → writes files)
- Backend uploads (multipart):
  - `backend/src/server.ts` (`/vivd-studio/api/upload/:slug/:version`, max 20 files/request, memory storage)

## Proposed Approach (recommended): 3-step flow (Draft → Upload → Generate)

### Why

- Avoids “large JSON” entirely (no base64-in-tRPC).
- Enables progress reporting via XHR upload progress events.
- Enables batching/retries and better failure handling.
- Keeps generation start (paid) separate from file transfer.

### Step 1 — Create a Draft Project (tRPC, JSON, small)

Add a new tRPC procedure:

- `project.createScratchDraft` (`adminProcedure`)
  - Input: the same metadata you already collect (title/description/businessType/style/refUrls).
  - Behavior:
    - checks usage limits + single-project mode limits early (prevents disk spam)
    - creates a `GenerationContext` with status `uploading_assets` (new status)
    - returns `{ slug, version }` immediately

Notes:

- No images in this call.
- Persist the metadata to the manifest/project.json like today (via `createGenerationContext` inputs).

### Step 2 — Upload Files (REST multipart, with progress, batched)

Frontend uploads images to the created `{slug, version}` using multipart/form-data.

Two implementation options:

**Option A (reuse existing endpoint, fastest):**

- Use `POST /vivd-studio/api/upload/:slug/:version?path=images` for “Brand assets”
- Use `POST /vivd-studio/api/upload/:slug/:version?path=references` for “Design references”
- Batch files into chunks of 20 (server currently uses `upload.array("files", 20)`).

**Option B (new dedicated endpoint, more control):**

- Add `POST /vivd-studio/api/scratch-assets/:slug/:version` that accepts:
  - `files[]` + a field `kind=images|references`
  - different limits/storage (recommended: disk storage)
  - returns `{ uploaded: string[] }` per batch

Backend robustness improvements (recommended regardless of A/B):

- Add structured error handling for:
  - Multer limits (`LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`, etc.) → 413/400 with a clear JSON payload
  - “request too large” (413) for any remaining cases
- Consider switching uploads from `multer.memoryStorage()` to disk storage (or busboy streaming) to avoid RAM spikes when many images are uploaded in parallel.

### Step 3 — Start Generation (tRPC, JSON, small)

Add a new tRPC procedure:

- `project.startScratchGeneration` (`adminProcedure`)
  - Input: `{ slug, version, ...metadata }` (or reuse metadata saved in Step 1)
  - Behavior:
    - re-check usage limits (this is the paid step)
    - updates status from `uploading_assets` → `pending`
    - kicks off `runScratchFlow(ctx, input)` (fire-and-forget like current flow)
    - returns `{ status: "processing", slug, version }`

Backend code changes needed:

- `backend/src/routers/project/generation.ts`
  - add the two new procedures, or refactor `generateFromScratch` to support “existing ctx” (slug/version) safely.
- `backend/src/generator/flows/scratchFlow.ts`
  - remove the need for base64 assets (or keep it optional for backward compatibility):
    - if assets are already present in `outputDir/images` and `outputDir/references`, skip writing them from input
    - keep writing `scratch_brief.txt` and `references/urls.txt`

## Frontend UX Plan (loading/progress)

### UI states

In Scratch Wizard submit:

1) `Creating project…` (waiting for Step 1)
2) `Uploading assets…` (Step 2)
   - progress: `uploadedBytes / totalBytes`
   - show `filesUploaded / filesTotal`
   - show retry button if a batch fails
3) `Starting generation…` (Step 3)
4) Existing polling UI: `Generating…` (current `project.status` polling)

Implementation notes:

- Use XHR (or axios) for upload requests to get upload progress events.
- Aggregate progress across batches:
  - compute total bytes from `File.size`
  - for each batch request, add “completed bytes” when the request finishes
  - use per-request `onprogress` for the in-flight batch for smoother progress
- Disable the form while any of these phases run.
- Allow cancel:
  - abort current XHR requests
  - optionally call a backend “delete draft” mutation (or mark as failed) to avoid orphaned folders.

### Client-side validation

Before upload, validate and show an actionable error:

- max total files (e.g. 200)
- max total bytes (e.g. 500MB)
- per-file max (keep backend limit aligned)

## Limits & Error Semantics

Backend should return consistent JSON errors so the UI can display them:

- `413` for payload/file-size related failures, with a helpful message:
  - “Too many files (max 20 per upload request)”
  - “File too large (max 50MB per file)”
  - “Upload too large (max 500MB total)”
- `400` for validation (invalid slug/version/path)
- `401/403` for auth/role issues

## Acceptance Criteria

- Uploading a large batch (e.g. 100+ images) no longer triggers `PayloadTooLargeError`.
- The UI shows an upload progress state while files are being transferred.
- Upload failures are recoverable (retry the failed batch) without losing already uploaded files.
- Generation only starts after uploads complete.
- Backend limits are enforced and surfaced to the user with clear messages.

## Rollout / Backward Compatibility

Recommended rollout order:

1) Backend: add draft + start procedures + error handling (keep existing `generateFromScratch` working for now).
2) Frontend: switch scratch wizard to the new 3-step flow.
3) After stabilization: consider removing/locking down base64 asset support (or keep it for small uploads only).

Optional stopgap (not the real fix):

- Temporarily raise `express.json` limit in `backend/src/server.ts` to reduce immediate failures, but still proceed with the multipart plan to avoid memory/UX issues.

## Open Questions (decide before implementation)

- Target limits:
  - max total files and max total bytes for scratch uploads
  - per-file size limit (currently 50MB)
- Upload storage:
  - keep webp conversion during upload (CPU-heavy) vs store originals and convert later
- Cleanup strategy:
  - delete draft on user cancel
  - automatic cleanup of drafts stuck in `uploading_assets` for > N hours
