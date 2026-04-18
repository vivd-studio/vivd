# Organization Member Invite Plan

Date: 2026-04-17  
Owner: control-plane/auth  
Status: planned

## Recommendation

Replace the current manual org-member account creation flow with invite-only onboarding.

- Keep broad public signup disabled after bootstrap.
- Reuse and extend the existing `organization_invitation` model instead of adding a parallel invite system.
- Support the same invite flow from both the org-admin member screen and the super-admin organization member screen.
- Let invitees either create their own account or sign in to an existing one, then attach membership only after they accept.
- Keep admin-triggered password reset as a recovery path, not as the normal onboarding path.

This solves the current operator pain without reopening public self-serve signup for the whole product.

## Current State

Today the product still uses direct account creation in the membership flows:

- `packages/backend/src/trpcRouters/organization.ts`
  `createUser` creates users directly with `auth.api.createUser` or immediately attaches an existing account.
- `packages/backend/src/trpcRouters/superadmin.organizations.ts`
  `createOrganizationUser` does the same from the super-admin org surface.
- `packages/frontend/src/components/settings/TeamSettings.tsx`
  asks admins for another person's password when the account does not exist yet.
- `packages/frontend/src/components/admin/organizations/components/MembersPanel.tsx`
  repeats that pattern in the super-admin org view.
- `packages/backend/src/auth.ts`
  intentionally disables normal `signUp` after the first bootstrap account, so invite onboarding cannot depend on reopening the generic signup page.

The repo already has an `organization_invitation` table, but it is effectively parked:

- no acceptance token
- no project assignment for `client_editor`
- no public accept flow
- no pending-invite UI
- no resend/cancel behavior

## Goals

- Invite a person by email from an organization member-management surface.
- Send a transactional email with a secure accept link.
- Allow a new user to create their own password from the invite flow.
- Allow an existing user to sign in and accept the invite.
- Preserve role assignment, including `client_editor` project binding.
- Show pending invites with resend/cancel actions.
- Redirect the invitee into the correct org after acceptance, using the org tenant host when available.
- Keep the implementation platform-first and control-plane owned.

## Non-Goals

- Do not add open public signup for non-invited users.
- Do not add magic-link auth, SSO, or SCIM in this slice.
- Do not add bulk CSV invites or multi-seat procurement flows.
- Do not redesign the global user admin surface beyond what invite onboarding needs.
- Do not expand `client_editor` beyond the current one-project assignment model.

## Product Flow

### 1. Send invite

From `Organization -> Members` and the super-admin organization member panel:

- Admin enters email, role, and optional display name.
- `client_editor` still requires an assigned project.
- Backend creates or refreshes one active pending invite for that org/email pair.
- Backend emails a secure invite link.
- UI shows the pending invite immediately, even if delivery later needs a retry.

### 2. Pending invite management

Member-management UI gets a dedicated pending-invites section:

- pending
- expired
- canceled

Actions:

- resend
- cancel

Accepted invites disappear from the pending section and the new member appears in the real member list.

### 3. Accept invite as a new user

- Invite link opens a public invite page.
- Email is fixed by the invite; the user only enters name and password.
- Backend validates the invite, creates the user with `auth.api.createUser`, creates org membership, adds project membership when required, marks the invite accepted, and marks the email verified because the invite email itself is the proof of mailbox control.
- Frontend signs the new user in and redirects into the invited org.

### 4. Accept invite as an existing user

- If the invite email already belongs to an account, the invite page asks them to sign in.
- Login must preserve a `next` return target so the user lands back on the invite page.
- If the signed-in account email matches the invite email, the page enables acceptance.
- If the signed-in account email does not match, show a hard stop with sign-out / switch-account guidance.
- Accepting the invite attaches membership, updates `activeOrganizationId`, and redirects into the invited org.

### 5. Error and edge states

- expired invite
- canceled invite
- org suspended before acceptance
- `client_editor` project deleted before acceptance
- user already became a member by another path
- email delivery failed when creating or resending the invite

Preferred behavior:

- treat expiry as derived from `expiresAt`, not a background job
- treat already-member acceptance as idempotent success when the email matches
- keep delivery failures actionable with resend instead of dropping the invite row

## Data Model

Extend `organization_invitation` instead of adding a second table.

Recommended fields to add:

- `tokenHash`
- `projectSlug` nullable
- `inviteeName` nullable
- `acceptedByUserId` nullable
- `acceptedAt` nullable
- `canceledAt` nullable
- `lastSentAt` nullable
- `updatedAt`

Notes:

- Store only a hash of the invite secret in the database.
- Keep using normalized lowercase email.
- Treat `status = pending` plus `expiresAt < now` as expired in reads.
- Cancel or supersede older pending invites for the same `organizationId + email` when sending a new one.
- Legacy invitation rows without a token should be treated as invalid/expired by new code.

## Backend Plan

### Invitation service

Add a dedicated backend service, for example `OrganizationInvitationService`, so token handling and membership creation do not live inline in the routers.

Responsibilities:

- create / refresh invite
- hash and verify tokens
- build canonical accept URLs
- accept invite transactionally
- send and resend email
- cancel invite
- expose small read models for org-admin and public invite screens

### Router changes

Organization router:

- replace `createUser` in the org-admin UI path with invite mutations
- add `listPendingInvites`
- add `inviteMember`
- add `resendInvite`
- add `cancelInvite`

Super-admin organization router:

- mirror the same invite operations for a selected organization
- keep direct global user creation, if still needed, as an operator-only escape hatch outside the normal org-member flow

Public invite surface:

- add public procedures for `getInviteDetails`
- add `acceptInviteWithSignup`
- add `acceptInviteForSignedInUser`

### Auth behavior

Do not reopen generic public signup.

Instead:

- validate invite first
- create users through the backend invite service with `auth.api.createUser`
- mark invited emails verified on acceptance
- use the normal sign-in path after account creation

This keeps the current bootstrap-only signup rule in `packages/backend/src/auth.ts` intact.

### Email

Add a new transactional template in `packages/backend/src/services/email/templates.ts`.

Template should include:

- org name
- inviter name or email
- role
- assigned project title for `client_editor`
- expiry
- accept CTA

Use a distinct metadata category such as `auth_org_invite`.

### Canonical URL and redirect behavior

- When tenant hosts are enabled, send the invite link to the invited org's tenant host.
- Otherwise use the resolved public control-plane origin.
- Acceptance responses should return the correct tenant host so the frontend can hard-redirect if the user opened the link on a non-canonical host.

### Abuse protection

Treat invite send and accept as auth-adjacent operations:

- rate-limit invite send per user and per org
- rate-limit public accept attempts per IP/token
- log invite create/resend/cancel/accept events with org and inviter context

## Frontend Plan

### Org-admin members screen

Update `packages/frontend/src/components/settings/TeamSettings.tsx`:

- rename the current add-member form into a true invite form
- remove the requirement for admins to enter someone else's password
- add pending invite rows with resend/cancel
- keep password reset available, but move it into a secondary recovery action

### Super-admin organization members screen

Update `packages/frontend/src/components/admin/organizations/components/MembersPanel.tsx` to use the same invite-first behavior.

The super-admin org member panel should not keep a second onboarding model.

### Public invite page

Add a new route and page, for example:

- `packages/frontend/src/pages/InviteAccept.tsx`
- `packages/frontend/src/app/router/paths.ts`
- `packages/frontend/src/app/router/routes.tsx`

States to support:

- loading
- pending invite for new user
- pending invite for signed-out existing user
- pending invite for signed-in matching user
- signed-in mismatched account
- accepted
- expired / canceled / invalid

### Login redirect preservation

Update `packages/frontend/src/pages/Login.tsx` so invite acceptance can round-trip through login:

- accept a `next` query param
- default to dashboard when absent
- return to the invite URL after successful login when present

## Documentation

Update `packages/docs/src/content/docs/teams-and-access.mdx`:

- explain invite-first onboarding
- explain existing-user accept flow
- explain pending invite management
- keep password reset documented as a recovery tool instead of the normal way to onboard a teammate

If needed, add a short companion page for “Accepting an invite” later, but the teams/access page is the minimum update.

## Expected Touch Points

Backend:

- `packages/backend/src/db/schema.ts`
- `packages/backend/drizzle/*`
- `packages/backend/src/auth.ts`
- `packages/backend/src/trpcRouters/organization.ts`
- `packages/backend/src/trpcRouters/superadmin.organizations.ts`
- `packages/backend/src/services/email/templates.ts`
- new invite service files under `packages/backend/src/services`

Frontend:

- `packages/frontend/src/components/settings/TeamSettings.tsx`
- `packages/frontend/src/components/admin/organizations/components/MembersPanel.tsx`
- `packages/frontend/src/pages/Login.tsx`
- new invite page under `packages/frontend/src/pages`
- router path/route wiring

Docs:

- `packages/docs/src/content/docs/teams-and-access.mdx`

## Delivery Phases

### Phase 1: Backend and email contract

- migration + schema extension
- invite service
- org-admin and super-admin invite mutations
- public invite query + accept mutations
- transactional email template

### Phase 2: Frontend org-admin flow

- TeamSettings invite form
- pending invite section
- recovery-only password reset positioning
- public invite page
- login `next` handling

### Phase 3: Super-admin org member flow and docs

- super-admin member panel invite-first update
- teams/access docs refresh
- cleanup of stale “create user” copy

## Validation Plan

Start with targeted tests and package typechecks.

Backend:

- `npm run test:run -w @vivd/backend -- test/organization_router.test.ts test/superadmin_router.test.ts test/email_templates.test.ts`
- add focused invite-service tests for token validation, resend/cancel, and accept edge cases
- `npm run typecheck -w @vivd/backend`

Frontend:

- `npm run test:run -w @vivd/frontend -- src/components/admin/organizations/OrganizationsTab.test.tsx src/app/router/guards.test.tsx`
- add focused tests for the org member invite UI and the new public invite page
- `npm run typecheck -w @vivd/frontend`
- `npm run build -w @vivd/frontend`

Docs:

- `npm run build -w @vivd/docs` when the docs wording changes

## Rollout Notes

- Ship the backend/public accept path before removing the old manual add-user UI.
- Keep an operator escape hatch until invite delivery has been proven in real hosted environments.
- Prefer replacing the org-member onboarding flow in both org-admin and super-admin surfaces in the same release so the product does not teach two models.
