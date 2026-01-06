# Frontend Review & Cleanup Plan

This document captures the agreed refactor/cleanup work for the frontend to reduce component size, remove duplication, and standardize patterns before doing broader feature work.

## Goals

- Make “feature” components smaller by extracting subcomponents and hooks.
- Reduce duplicated UI patterns (version selector, project creation flows).
- Standardize UX primitives (shadcn dialogs instead of `alert`/`confirm`, consistent toasts).
- Keep changes incremental and easy to review.

## Guiding Principles (repo conventions)

- Prefer shadcn components.
- Use `react-hook-form` for forms.
- For tRPC hooks, destructure returns (e.g. `const { data, isLoading } = trpc.x.useQuery()`).
- Avoid behavior changes unless explicitly intended.

## Plan

### 1) Shared VersionSelector component

- [x] Create a shared `VersionSelector` to eliminate duplication between:
  - `frontend/src/components/preview/PreviewToolbar.tsx`
  - `frontend/src/components/ProjectCard.tsx`
- [x] Keep it flexible enough for both contexts (callbacks + optional “status marker” rendering).

### 2) Unify project creation flows (wizard + single-project)

- [ ] Extract shared URL + disclaimer form (schema + UI) used in:
  - `frontend/src/components/ProjectWizard.tsx`
  - `frontend/src/components/SingleProjectCreateView.tsx`
- [ ] Extract shared ZIP import flow (fetch + error handling + UI).
- [ ] Replace raw checkbox inputs with shadcn `Checkbox` where appropriate.

### 3) Replace `alert` / `confirm` with shadcn dialogs + toasts

- [x] Replace `alert(...)` and `confirm(...)` usage with:
  - shadcn `AlertDialog` for confirmation flows
  - `sonner` toasts for success/error feedback
- [x] Target files (initial pass):
  - `frontend/src/components/ProjectsList.tsx`
  - `frontend/src/components/asset-explorer/AssetExplorer.tsx`
  - `frontend/src/components/ProjectCard.tsx`
  - `frontend/src/components/VersionHistoryPanel.tsx`
  - `frontend/src/pages/Admin.tsx`

### 4) tRPC typing + hook usage consistency

- [ ] Export `RouterInputs`/`RouterOutputs` from `frontend/src/lib/trpc.ts` and use them instead of local ad-hoc interfaces where helpful.
- [ ] Standardize `enabled` usage for queries (avoid `projectSlug!` unless the query is gated).

### 5) Verification

- [ ] Run frontend typecheck and lint after each phase (or at minimum after phases 1–3).

## Open Questions / Decisions

- Where should “feature” components live? (`frontend/src/components/publish/*` vs keeping everything flat in `components/`).
- Should checklist “Fix” actions integrate with chat (send a message to agent), or remain a direct mutation only?
- Should polling intervals (projects list / preview) be conditional to reduce background load?

## Definition of Done

- `PublishDialog` is meaningfully smaller and delegates checklist rendering/logic.
- `VersionSelector` is shared and used in both toolbar + cards.
- Project creation/import logic is not duplicated between wizard modes.
- No `alert`/`confirm` remain in the app (unless intentionally kept for a reason).
- TypeScript passes and UI behavior remains unchanged (unless explicitly intended).
