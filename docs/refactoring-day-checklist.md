# Refactoring Day Checklist

Purpose: improve developer efficiency, readability, and maintainability with low-risk, incremental refactors.

## 1) Split Oversized Frontend Components

- [x] Split `packages/frontend/src/components/admin/organizations/OrganizationsTab.tsx` into:
  - [x] `useOrganizationsAdmin` hook (queries/mutations/form state)
  - [x] `UsageLimitsPanel`
  - [x] `MembersPanel`
  - [x] `OrganizationSettingsPanel`
- [x] Split `packages/frontend/src/components/shell/AppSidebar.tsx` into:
  - [x] navigation data hook
  - [x] `ProjectsNavSection`
  - [x] `AdminNavSection`
  - [x] `UserNavFooter`
- [ ] Add/adjust targeted tests for extracted utility logic.

## 2) Thin Routers, Move Business Logic to Services

- [ ] Extract organization/member/user mutation logic from `packages/backend/src/routers/superadmin.ts` into `packages/backend/src/services/superadmin/*`.
- [ ] Keep router layer limited to input validation + auth + service call + response mapping.
- [x] Remove legacy/unused procedure `setOrganizationMemberRole` if no client references remain.

## 3) Add Transactions for Multi-Step Mutations

- [x] Wrap `updateOrganizationMemberRole` flow in a DB transaction.
- [x] Wrap `createOrganizationUser` flow in a DB transaction.
- [ ] Add failure-path tests to verify rollback behavior.

## 4) Deduplicate Backend/Studio Shared Runtime Logic

- [x] Remove backend-side duplicate patching runtime (`HtmlPatchService`, `AstroPatchService`, `I18nJsonPatchService`, `i18nInlinePatches`) so studio runtime is the single patching owner.
- [ ] Extract duplicated OpenCode stream/event logic into shared runtime package/module.
- [ ] Keep environment-specific wiring in backend/studio, but share pure logic and types.

## 5) Align Scripts and Docs With Migration Rules

- [x] Remove/rename root and backend `db:push` scripts to prevent accidental use.
- [x] Keep Drizzle migration workflow explicit (`db:generate` + `db:migrate` only).
- [x] Fix README commands that do not exist (for example missing root `dev` script).

## 6) Standardize Quality Gates Across Packages

- [ ] Add ESLint configs/scripts for backend, studio, and scraper.
- [ ] Add workspace-level `typecheck` scripts for backend, frontend, studio, scraper.
- [ ] Add CI job for minimal checks: lint + typecheck + targeted test smoke.

## 7) Reduce Unsafe Types (`any`) in Runtime Paths

- [ ] Replace `as any` usage in backend auth/session context code.
- [x] Replace `as any` usage in superadmin auth API response parsing.
- [ ] Replace `as any` usage in studio/backend OpenCode event parsing.
- [ ] Add narrow parser/type guards where external payloads enter the system.

## 8) Centralize Limits Defaults and Schemas

- [ ] Move limit defaults/schema to `@vivd/shared`.
- [ ] Update backend `LimitsService` and superadmin router to consume shared values.
- [ ] Update frontend admin forms to consume shared values.

## 9) Reduce Expensive Polling in Sidebar

- [x] Replace always-on 5s polling in `AppSidebar` with smarter invalidation.
- [ ] Use query invalidation on mutations + refetch-on-focus.
- [ ] Keep optional short polling only where it is strictly required.

## 10) Raise Regression Protection in High-Risk Areas

- [ ] Add tests for superadmin role + project assignment transitions.
- [ ] Add tests for tRPC org resolution/context selection behavior.
- [ ] Add tests for bucket artifact upload/meta state transitions.

## Suggested Order (Fastest ROI)

- [ ] Step A: 1 + 2 (structure and readability)
- [ ] Step B: 3 + 7 (correctness and safety)
- [ ] Step C: 5 + 6 (team workflow consistency)
- [ ] Step D: 4 + 8 + 9 + 10 (longer-term maintenance and scale)
