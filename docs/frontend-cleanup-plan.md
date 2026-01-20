# Frontend Refactor & Scale Plan

This document captures the refactor/cleanup roadmap for the React/Vite frontend so it stays maintainable as features (studio, admin, assets, chat, publishing) grow. The goal is to **tidy the codebase without behavior changes**, and to make future feature work cheaper.

## Goals

- Keep route-level files small and compositional (pages shouldn’t contain “systems”).
- Reduce duplication (project creation/import flows, project sorting, loading states, polling config).
- Make domains explicit (projects vs studio vs admin vs auth) with clear module boundaries.
- Standardize data-access patterns (tRPC, react-query defaults, role/feature gates).
- Keep changes incremental, reviewable, and safe.

## Scope

- Frontend app: `frontend/src/**`
- Excludes: backend router/module changes (except aligning types imported via `@backend/*` if needed).

## Guiding Principles (repo conventions)

- Prefer shadcn components (keep `frontend/src/components/ui/*` as a design-system boundary).
- Use `react-hook-form` + zod for forms.
- For tRPC hooks, destructure results (e.g. `const { data, isLoading } = trpc.x.useQuery()`).
- Avoid behavior changes unless explicitly intended.
- Prefer “extract + reuse” over “copy + tweak”.

## Current State (Findings)

### Large/Overloaded Modules

- `frontend/src/pages/Admin.tsx` is ~1500 LOC and mixes UI + schemas + networking + dialogs + maintenance actions.
- `frontend/src/App.tsx` holds routing + session checks + role gates + single-project-mode redirects.

### Duplication

- ZIP import + URL normalization/disclaimer logic is duplicated:
  - `frontend/src/components/ProjectWizard.tsx`
  - `frontend/src/components/SingleProjectCreateView.tsx`
- “Recent projects / last modified” sorting exists in multiple places:
  - `frontend/src/components/AppSidebar.tsx`
  - `frontend/src/components/ProjectsList.tsx`

### Architecture Smells

- “Optional” context via try/catch:
  - `frontend/src/components/chat/ChatContext.tsx` tries `usePreview()` from `frontend/src/components/preview/PreviewContext.tsx`
  - This increases coupling and makes dependencies unclear.
- Polling (`refetchInterval`) is scattered and inconsistent (projects/sidebar/preview/chat) → hard to tune and easy to overload the backend.

## Target Architecture (What We Grow Toward)

Keep shadcn UI primitives where they are, and move domain code into feature modules:

```text
frontend/src/
  app/
    providers/              # QueryClient + trpc + theme, app config, etc.
    router/                 # route definitions, guards, paths
    config/                 # constants (e.g. VIVD_STUDIO_BASE), env parsing
  components/
    ui/                     # shadcn-only primitives (no business logic)
  features/
    projects/               # list/card/wizard/import, sorting/status utilities
    studio/                 # preview/chat/assets/publish + shared studio types
    admin/                  # user mgmt, assignments, maintenance, usage
    auth/                   # login/signup flows, session helpers
    settings/               # account settings feature
  hooks/                    # truly cross-feature hooks only
  lib/                      # truly cross-feature helpers only (small + stable)
  pages/                    # thin route-level composition only
```

Notes:

- Feature folders can start by re-exporting existing components and then gradually absorbing them (no big-bang move).
- `frontend/src/pages/*` should become thin wrappers assembling feature components + guards.

## Conventions To Lock In

- **Naming**: `PascalCase.tsx` for components (outside `components/ui`), `useX.ts` for hooks, feature-local `types.ts`/`api.ts`/`utils.ts`.
- **Types**: prefer `RouterOutputs`/`RouterInputs` from `frontend/src/lib/trpc.ts` over ad-hoc interfaces for API payloads.
- **Data access**:
  - Prefer `trpc.*.useQuery/useMutation`.
  - If `fetch` is necessary (e.g. ZIP import), wrap it once in a shared helper and reuse.
- **Role/feature gates**: centralize route guards; avoid repeating redirect logic in multiple components.
- **Loading/error UX**: standardize a small set of primitives (centered loading, error panel, empty states).
- **Polling**: centralize polling intervals and make them conditional where possible (e.g. only poll while “processing”).

## Plan (Incremental Phases)

### Phase 0 — Guardrails (baseline)

- [ ] Define “no behavior change” acceptance criteria for refactors (manual checklist per PR).
- [x] Add (or standardize) one place to set react-query defaults (staleTime/refetchOnWindowFocus/retry) so tuning isn’t scattered.
- [x] Add lightweight verification steps for frontend-only changes (typecheck + lint; avoid running long/paid flows).

### Phase 1 — Remove duplication (high ROI, low risk)

- [x] Shared `VersionSelector` to eliminate duplication between:
  - `frontend/src/components/preview/PreviewToolbar.tsx`
  - `frontend/src/components/ProjectCard.tsx`
- [x] Unify project creation flows (wizard + single-project):
  - [x] Extract shared URL + disclaimer form (schema + UI) used in:
    - `frontend/src/components/ProjectWizard.tsx`
    - `frontend/src/components/SingleProjectCreateView.tsx`
  - [x] Extract shared ZIP import flow (fetch + error handling + UI).
  - [x] Replace raw checkbox inputs with shadcn `Checkbox` where appropriate.
- [x] Extract shared “last modified” project sorting utility and reuse in:
  - `frontend/src/components/AppSidebar.tsx`
  - `frontend/src/components/ProjectsList.tsx`
- [x] Standardize “loading” blocks (replace repeated `Loading...` markup with a shared component).

### Phase 2 — App shell: routing + guards

- [x] Extract routing from `frontend/src/App.tsx` into `frontend/src/app/router/*`.
- [x] Add route constants (e.g. `VIVD_STUDIO_BASE="/vivd-studio"`) to avoid repeated path string literals.
- [x] Centralize:
  - session-required guard
  - admin-only guard
  - client-editor “assigned project” guard
  - single-project-mode guard/redirect rules

### Phase 3 — Admin feature decomposition (biggest maintainability win)

- [x] Split `frontend/src/pages/Admin.tsx` into feature modules under `frontend/src/components/admin/*`:
  - `users/` (list, create, edit, delete + assignments)
  - `maintenance/` (migrations/templates/etc.)
  - `usage/` (usage metrics / limits UI)
- [x] Move zod schemas + form components into those submodules.
- [x] Admin.tsx reduced from ~1500 LOC to ~70 LOC (thin wrapper).
- Note: User management still uses react-query with `authClient.admin.*` (better-auth), which is appropriate since auth ops are separate from tRPC.

### Phase 4 — Studio feature boundaries (preview/chat/assets/publish)

- [x] Remove "optional preview context" try/catch coupling:
  - Added `useOptionalPreview()` in `frontend/src/components/preview/PreviewContext.tsx`.
  - Updated `ChatContext.tsx` to use `useOptionalPreview()` instead of try/catch.
- [x] Consolidate studio-related polling policies in one place:
  - Created `frontend/src/app/config/polling.ts` with centralized polling constants.
  - Updated `ChatContext`, `PreviewContext`, `PreviewToolbar`, `EmbeddedStudioToolbar`, `VersionHistoryPanel` to use these constants.
- [x] Ensure `PreviewProvider` is not responsible for unrelated cross-feature concerns:
  - Reviewed: PreviewProvider manages preview + studio layout (chat/assets panels, cross-component messaging).
  - This scope is appropriate since it coordinates the entire studio experience.
  - No auth, project management, or other unrelated concerns are present.
  - Optional future improvement: rename to `StudioProvider` for clarity.

### Phase 5 — Type + API hygiene

- [ ] Use `RouterOutputs`/`RouterInputs` broadly instead of local API interfaces (e.g. `Project`, `User`).
- [ ] Standardize query `enabled` usage (avoid `projectSlug!`; gate at the call site).
- [ ] Optional: define a small `apiErrors.ts` mapping (human-friendly messages for common TRPC errors).

### Phase 6 — Performance + DX improvements (only after structure is stable)

- [ ] Review and tune polling intervals (conditional polling while processing/streaming).
- [ ] Consider a shared “query keys / invalidation helpers” layer (via `trpc.useUtils()` wrappers) to reduce repeated invalidations.
- [ ] Optional: introduce route-level code splitting for heavy screens (Admin/Studio) if bundle becomes an issue.

## Verification (Per Phase)

- [ ] Typecheck: `npm run build --prefix frontend` (or `tsc -b --prefix frontend`).
- [ ] Lint: `npm run lint --prefix frontend`.
- [ ] Minimal manual smoke:
  - login → dashboard
  - open a project → embedded studio + fullscreen
  - single-project-mode redirect rules
  - admin page loads and basic actions still work

## Open Questions / Decisions

- Should `components/preview`, `components/chat`, `components/asset-explorer`, `components/publish` move under `features/studio/*` (recommended), or stay under `components/`?
- Should “fix checklist” actions integrate with chat (send an agent message) or remain direct mutations?
- Do we want global defaults for polling (and override only in a few hotspots), or keep explicit per-query intervals?

## Definition of Done

- Admin is split into coherent feature modules (no monolithic `Admin.tsx`).
- Route guards are centralized (no repeated redirect logic across pages).
- Project creation/import logic exists exactly once and is reused by wizard variants.
- Polling is centralized/tunable and not scattered across many components.
- No `alert`/`confirm` remain in the app (unless intentionally kept for a reason).
- TypeScript passes and UI behavior remains unchanged (unless explicitly intended).
