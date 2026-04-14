# App Login Landing + Tenant Redirect Plan

Status: Proposed  
Last updated: 2026-02-22

## Goal

Provide a clear control-plane entry flow:

1. User clicks `Login` on `vivd.studio`.
2. User lands on `app.vivd.studio` (app landing + login).
3. After successful login, user is redirected to their active tenant host.
4. User lands inside Studio (`/vivd-studio`) with their tenant-scoped projects.

## Current State

- Control-plane and tenant host routing already exist (`hostKind`, pinned host org, wrong-tenant guard).
- Login exists at `/vivd-studio/login`.
- Successful login currently navigates to `/` on the same host, then `/vivd-studio`.
- Cross-host org switching is already implemented in sidebar (control-plane -> tenant host).
- `config.getAppConfig` already exposes `activeOrganizationTenantHost` and `controlPlaneHost`.

## Gaps to Close

- No dedicated app landing entry at `app.vivd.studio/` (root path is currently not app-owned).
- Post-login flow does not automatically hand off to tenant host.
- Auth guard flow does not preserve a validated `next` destination for deep-link returns.
- Cross-subdomain auth behavior must be explicitly validated for `app.<base>` <-> `{org}.<base>`.

## Proposed UX Flow

### 1) Public App Landing (Control Plane)

- Add a public route for control-plane root (`https://app.vivd.studio/`) with:
  - concise app entry messaging
  - primary CTA: `Log in`
  - optional secondary CTA: `Forgot password`
- `Log in` leads to `/vivd-studio/login` (with optional safe `next` parameter).

### 2) Login

- Keep the existing login form and auth API path.
- On success, route to a dedicated post-login resolver (not directly to dashboard).

### 3) Post-Login Tenant Resolver

- Resolve redirect target in this order:
  1. If current host is control-plane and `activeOrganizationTenantHost` exists: redirect to `https://<tenantHost>/vivd-studio`.
  2. Else: continue on current host to `/vivd-studio`.
- Preserve safe relative `next` path when present (reject absolute/external URLs).
- If tenant host is unavailable, fall back to control-plane `/vivd-studio` with a non-blocking toast.

### 4) Tenant Dashboard

- Existing guards and org-scoped queries remain source of truth.
- User should arrive in existing dashboard/project flows unchanged once on tenant host.

## Technical Plan

### Slice 0: Verify Session Handoff Behavior (Required First)

- Validate in local + staging:
  - login on control-plane host
  - redirect to tenant host
  - session remains authenticated after redirect
- If cross-subdomain cookies are not reliable in a target environment:
  - implement a one-time auth handoff token flow as fallback.

### Slice 1: Control-Plane Root Routing

- Update Caddy routing so control-plane host root can serve frontend app landing, without breaking:
  - tenant-host published sites
  - existing `/vivd-studio/*` behavior
- Keep routing host-aware; do not globally proxy `/` to frontend.

### Slice 2: Frontend Landing + Post-Login Redirect

- Add `AppLanding` page component.
- Add `PostLoginRedirect` resolver component/page.
- Update router for:
  - control-plane root landing route
  - login success -> post-login resolver route
- Add shared URL helpers for safe `next` parsing/serialization.

### Slice 3: Guard/Deep-Link Improvements

- Update `RequireAuth` to pass a safe `next` parameter when redirecting to login.
- Ensure login and post-login resolver preserve/consume `next` exactly once.
- Keep wrong-tenant fallback behavior unchanged.

### Slice 4: Config + Rollout

- Confirm/document required env values for SaaS:
  - `CONTROL_PLANE_HOST=app.vivd.studio`
  - `TENANT_BASE_DOMAIN=vivd.studio`
  - `TENANT_DOMAIN_ROUTING_ENABLED=true`
- Add feature flags (recommended):
  - `VITE_APP_CONTROL_PLANE_LANDING_ENABLED`
  - `VITE_POST_LOGIN_TENANT_REDIRECT_ENABLED`
- Roll out in stages: dev -> staging -> prod.

## Testing Plan

### Frontend

- Add tests for:
  - login success redirects to post-login resolver
  - resolver redirects to tenant host when available
  - safe handling of invalid/external `next` values
  - unchanged wrong-tenant guard UX

### Backend

- Reuse existing host-resolution and config tests; add targeted tests only where behavior changes.
- If fallback handoff token is needed, add dedicated token lifecycle tests.

### E2E Smoke (Phase 4 extension)

- Add scenario:
  - open control-plane landing
  - login
  - automatic redirect to tenant host
  - dashboard/project list visible for active tenant

## Acceptance Criteria

- `vivd.studio` Login CTA can point to `https://app.vivd.studio/` entry flow.
- User can log in at control-plane app landing.
- After login, user is automatically redirected to their active tenant host when available.
- User lands in tenant-scoped dashboard/projects without manual org-switch step.
- Wrong-tenant access still shows explicit recovery path to control-plane host.

## File Touchpoints (Expected)

- `Caddyfile`
- `Caddyfile.dev`
- `packages/frontend/src/app/router/routes.tsx`
- `packages/frontend/src/app/router/paths.ts`
- `packages/frontend/src/app/router/guards.tsx`
- `packages/frontend/src/pages/Login.tsx`
- `packages/frontend/src/pages/AppLanding.tsx` (new)
- `packages/frontend/src/pages/PostLoginRedirect.tsx` (new)
- `packages/frontend/src/app/router/guards.test.tsx`
- `packages/frontend/src/pages/Login.test.tsx` (new/updated)
- `.env.example` (if flags/config knobs are added)
