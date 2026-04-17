# Shared UI Primitives Plan

Date: 2026-04-17  
Owner: frontend / Studio UX  
Status: in progress

## Recommendation

Adopt a layered UI refactor instead of a blanket component extraction.

- Keep `@vivd/theme` as the shared token and CSS layer.
- Add a new shared component package, likely `@vivd/ui`, but move only primitives that are already visually and behaviorally aligned across frontend and Studio.
- Keep page composition, app chrome, and surface-specific interaction patterns owned by each app.
- Migrate behind app-local re-exports first so feature imports do not churn while the package settles.
- Use a small set of reference surfaces as regression gates before broad rollout.

The goal is to remove duplicated primitive code without flattening the better-looking product pages into one generic admin kit.

## Why This Needs A Plan

The repo already has a clear duplication seam:

- `packages/frontend/src/components/ui` contains 32 files.
- `packages/studio/client/src/components/ui` contains 29 files.
- 29 filenames overlap between the two folders.
- Shared files such as `button.tsx`, `card.tsx`, and `lib/utils.ts` are currently identical.

That makes a shared primitive layer attractive, but the stronger surfaces are not strong because of the primitives alone. They are strong because they apply those primitives through better shells and compositions.

Concrete examples from the current repo:

- `plugins/native/table-booking/src/frontend/TableBookingProjectPage.tsx` reads well because of the page shell, information density, and layout choices, not because it uses a special `Button` or `Card`.
- `packages/frontend/src/pages/SuperAdmin.tsx` is weaker in places because the overall structure is doing too much, not because the current button or input primitives are wrong.
- `packages/studio/client/src/components/preview/toolbar/StudioToolbar.tsx` and the Studio chat surface use compact, workflow-driven composition that should stay Studio-owned even if the underlying buttons, inputs, and dialogs become shared.

The risk is not "shared primitives are bad." The risk is accidentally treating shells and page composition as if they were primitive problems.

## Goals

- Remove low-level UI duplication between frontend and Studio where the implementation is already effectively the same.
- Preserve or improve the best-looking existing surfaces during migration.
- Give weaker admin surfaces better composition tools instead of forcing more one-off utility class piles.
- Keep the control plane and Studio visually related through tokens and base primitives without making them visually identical.
- Make future primitive changes happen once instead of twice.

## Non-Goals

- Do not merge frontend and Studio into one visual system above the primitive layer.
- Do not replace good existing page compositions just because a new shared primitive exists.
- Do not force Studio toolbar, chat, preview chrome, or control-plane shell layout into the same components.
- Do not treat this as a full design-system rewrite.
- Do not require wide feature-file import churn in the first migration step.

## Layer Model

### 1. Shared foundation

Owned centrally.

Contents:

- `@vivd/theme` tokens and CSS variables
- `cn()` and other tiny styling utilities
- low-level primitives with neutral semantics such as `Button`, `Input`, `Label`, `Textarea`, `Badge`, `Card`, `Dialog`, `Tabs`, and similar wrappers when they are already aligned

Rules:

- Shared primitives must stay visually neutral and token-driven.
- Shared primitives should expose only the variants that are actually cross-app concepts.
- If a style need is specific to one surface, do not promote it into the shared primitive API just to avoid local code.

### 2. App-specific composition

Owned per app.

Frontend examples:

- `SettingsPageShell`
- future admin/workspace page sections
- table/list/filter layouts
- plugin setup sections and control-plane form groups

Studio examples:

- toolbar button groups
- preview side panels
- permission and question docks
- chat composer regions

Rules:

- Composition components may wrap shared primitives, but they remain local to the app.
- Composition is where the design language of each app should stay distinct.

### 3. App chrome

Explicitly not shared.

Frontend examples:

- `packages/frontend/src/components/shell/Layout.tsx`
- `packages/frontend/src/components/shell/AppSidebar.tsx`

Studio examples:

- `packages/studio/client/src/components/preview/toolbar/StudioToolbar.tsx`
- `packages/studio/client/src/components/chat/ChatPanel.tsx`

Rules:

- Shared primitives may appear inside these shells.
- The shells themselves should stay app-owned unless both apps independently converge on the same interaction model, which is not the current situation.

## Reference Surfaces

These are the surfaces to use as quality anchors during the rollout.

### Preserve closely

- Table Booking project page: `plugins/native/table-booking/src/frontend/TableBookingProjectPage.tsx`
- Project Plugins overview: `packages/frontend/src/pages/ProjectPlugins.tsx`
- Frontend app shell and sidebar: `packages/frontend/src/components/shell/Layout.tsx`, `packages/frontend/src/components/shell/AppSidebar.tsx`
- Studio toolbar and chat framing: `packages/studio/client/src/components/preview/toolbar/StudioToolbar.tsx`, `packages/studio/client/src/components/chat/ChatPanel.tsx`
- Studio permission dock: `packages/studio/client/src/features/opencodeChat/permissions/PermissionDock.tsx`

### Improve during the rollout

- Super Admin page and organization-management flow: `packages/frontend/src/pages/SuperAdmin.tsx` plus the lazy-loaded admin tabs it hosts

The rule is simple: do not standardize around the weakest current page.

## Phase 0 Snapshot

Reference audit on 2026-04-17:

- `packages/frontend/src/components/ui` has 32 files.
- `packages/studio/client/src/components/ui` has 29 files.
- 29 filenames overlap.
- Before extraction, all overlapping files were byte-identical except `sonner.tsx`.
- Frontend-only primitives are currently `popover.tsx` and `sidebar.tsx`.

### Inventory status

Completed in the first extraction slice:

- `cn` via `@vivd/ui/utils`
- `button`
- `card`
- `input`
- `label`

Completed in the second extraction slice:

- `badge`
- `checkbox`
- `dialog`
- `dropdown-menu`
- `separator`
- `tooltip`

Completed in the third extraction slice:

- `collapsible`
- `textarea`
- `avatar`
- `progress`
- `skeleton`

Completed in the fourth extraction slice:

- `breadcrumb`
- `context-menu`
- `form`
- `password-input`
- `scroll-area`
- `select`
- `sheet`
- `tabs`
- `toggle`
- `toggle-group`

Completed in the fifth extraction slice:

- `alert-dialog`
- `interactive-surface`

Keep local for now:

- `sonner`
  the implementations already diverge because frontend uses `next-themes` while Studio uses the local theme provider
- `popover`
  frontend-only; no second consumer yet
- `sidebar`
  frontend-only and too tightly coupled to control-plane shell behavior to treat as a primitive candidate right now

At this point, the duplicated neutral primitive layer has been extracted; the remaining local files are intentional app-owned or divergent components rather than pending exact-match duplicates.

### Reference validation commands

Use these checks after each shared-primitive slice:

- `npm run typecheck -w @vivd/ui`
- `npm run typecheck -w @vivd/frontend`
- `npm run typecheck -w @vivd/studio`
- `npm run test:run -w @vivd/frontend -- src/pages/ProjectPlugins.test.tsx src/plugins/table-booking/TableBookingProjectPage.test.tsx src/components/shell/AppSidebar.test.tsx`
- `npm run test:run -w @vivd/studio -- client/src/components/preview/toolbar/StudioToolbar.test.tsx client/src/components/chat/ChatPanel.test.tsx client/src/features/opencodeChat/permissions/PermissionDock.test.tsx`

Note:

- the Table Booking page test needed its TRPC harness updated for `plugins.requestAccess.useMutation` so the reference suite reflects current page behavior instead of a stale mock.
- once primitives live in `packages/ui`, every consuming app must include `packages/ui/src/**/*` in its Tailwind content scan; otherwise shared dark-mode utility classes can disappear from built CSS even though the local re-export wrappers still compile.
- destructive confirm actions should prefer `AlertDialogAction variant="destructive"` over copied utility-class blobs so the dark semantic treatment stays primitive-owned.

## Migration Strategy

### Phase 0: Inventory and baseline

Before moving files:

- classify each duplicated UI file as `extract now`, `extract later`, or `keep local`
- capture before-state screenshots for the reference surfaces in the views that matter
- identify which surface tests already exist and where a screenshot or DOM-level assertion is still missing

Deliverables:

- a short primitive inventory table added to this plan or a follow-up note
- baseline screenshots or a repeatable capture command
- explicit go/no-go surface list for the first migration slice

Acceptance bar:

- no code movement yet
- the team can say exactly which screens must remain visually stable

### Phase 1: Create the shared primitive package with zero-delta wrappers

Start with the files that are currently identical or trivially identical.

Initial likely candidates:

- `button`
- `card`
- `badge`
- `checkbox`
- `dialog`
- `dropdown-menu`
- `input`
- `label`
- `textarea`
- `separator`
- `tooltip`

Completed so far:

- `button`
- `card`
- `badge`
- `checkbox`
- `avatar`
- `breadcrumb`
- `collapsible`
- `context-menu`
- `dialog`
- `dropdown-menu`
- `form`
- `input`
- `label`
- `password-input`
- `progress`
- `scroll-area`
- `select`
- `separator`
- `sheet`
- `skeleton`
- `tabs`
- `textarea`
- `toggle`
- `toggle-group`
- `tooltip`
- `alert-dialog`
- `interactive-surface`

Implementation rules:

- keep the current app import paths initially by re-exporting from `@/components/ui/*`
- do not change public props or variant names in the same PR as the extraction
- do not mix visual redesign into the extraction PR
- add focused package-level tests only for primitives that actually have behavior worth protecting

Acceptance bar:

- feature code keeps compiling through local re-exports
- reference surfaces show no intentional visual change
- the package proves it can host shared primitives without triggering broad churn

### Phase 2: Establish composition layers in the control plane

After the shared primitive package is stable, improve the control plane through composition instead of one-off utility usage.

First pass landed on 2026-04-17:

- Super Admin organizations flow now uses a clearer workspace summary and a more structured settings surface instead of leaning on mini metric cards and ad-hoc field blocks.
- The first focused regression test for this surface lives in `packages/frontend/src/components/admin/organizations/OrganizationsTab.test.tsx`.

Candidate control-plane composition pieces:

- `PageHeader`
- `SettingsShell`
- `SectionCard`
- `InlineMetaList`
- `FormSection`
- `DataToolbar`
- `EmptyStateBlock`

Implementation rules:

- build these out of shared primitives and existing theme tokens
- validate them first on already decent surfaces such as Project Plugins and Table Booking-adjacent control-plane flows
- only then apply them to weaker admin surfaces like Super Admin

Acceptance bar:

- the new compositions make stronger pages simpler without changing their tone
- Super Admin improves because the structure gets clearer, not because the whole app becomes "more componentized"

### Phase 3: Establish composition layers in Studio

Studio should get its own local composition helpers rather than reusing control-plane compositions.

Candidate Studio-only composition pieces:

- compact toolbar action groups
- side-panel section headers
- dock footers and action rows
- compact empty/loading states

Implementation rules:

- use the shared primitives underneath where appropriate
- keep density, spacing, and workflow bias tuned for Studio
- do not replace the toolbar or chat shell wholesale in the same PR as introducing shared primitives

Acceptance bar:

- Studio still feels like Studio
- primitive extraction reduces duplication without sanding off the compact interaction model

### Phase 4: Expand shared coverage cautiously

Only after the first slices are stable:

- audit the remaining duplicated primitives again
- move additional files when they are still genuinely aligned
- keep divergent pieces local even if they happen to share a filename today

Candidates to defer until later:

- `sidebar`
- `breadcrumb`
- `interactive-surface`
- any sheet/popover/toggle implementation with surface-specific behavior or styling assumptions

Acceptance bar:

- "shared" means same concept and same behavior, not merely same filename

## Implementation Rules

### Shared first only when exact enough

A primitive should move only when both apps want the same default behavior.

If a control needs app-specific spacing, tone, or behavior beyond a normal variant boundary, keep it local or wrap it in an app-specific composition.

### Re-export before rewrite

The safest first move is:

1. create `packages/ui`
2. move exact primitives there
3. keep `packages/frontend/src/components/ui/*` and `packages/studio/client/src/components/ui/*` as thin re-exports
4. migrate imports later only if there is a good reason

This keeps rollback easy and avoids giant feature-file diffs.

### No "one more variant" sprawl

Do not turn page-specific styling needs into endless primitive variants.

If a page wants a special header block, compact toolbar row, dense stats strip, or admin section layout, that is a composition component, not a new `Button` or `Card` variant.

### Preserve token ownership

`@vivd/theme` should remain the source of shared colors, radii, spacing tokens, and semantic CSS variables. `@vivd/ui` should consume those tokens, not invent a second token layer.

## Verification

Each migration PR should stay small and include:

- focused typecheck for the touched package(s)
- targeted Vitest coverage for changed behavior, if any
- manual checks on the reference surfaces the PR could affect

Recommended manual checks:

- Table Booking page in normal control-plane layout
- Project Plugins page
- Super Admin organizations flow
- frontend shell sidebar and sticky header behavior
- Studio toolbar on desktop and narrow widths
- Studio chat panel and permission dock

Recommended rollout size:

- at most 2 to 4 primitives per extraction PR
- at most 1 composition introduction per PR
- stop and reassess if a migration requires widespread `className` overrides to recover the old look

## Proposed First Execution Slice

The first implementation slice should be deliberately boring:

1. create `packages/ui`
2. move `cn`, `button`, `card`, `input`, and `label`
3. add local re-exports in frontend and Studio
4. run focused checks on the reference surfaces
5. stop there and inspect the result before moving additional primitives

If that slice causes visual drift, the package boundary is wrong or the primitive is not actually shared enough yet.

## Success Criteria

This effort is successful when:

- primitive code changes stop being duplicated across frontend and Studio
- strong existing pages still look like themselves
- weak admin surfaces improve through better composition
- Studio retains its compact workflow-oriented feel
- new UI work has a clearer place to live: shared primitive, app composition, or app shell
