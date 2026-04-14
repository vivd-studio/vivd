# Self-Hosting Profile Split Plan

Status: In Progress  
Last updated: 2026-03-20

Progress note: phases 1 through 4 are now landed in the product codebase (install-profile foundation, instance-first backend policy resolution, `solo` same-host routing, and `solo`/`platform` admin UI split). Phase 5 is now partially landed in a broader sense: new installs already default to `solo`, and the public docs workspace now hosts a solo-only self-host installer bundle plus a public self-hosting guide. The remaining open follow-up is the documented migration/upgrade path from `solo` to `platform`.

## Goal

Make Vivd easy to install and maintain for solo self-hosters without weakening the current SaaS-oriented architecture.

The core idea is to stop treating self-hosted and SaaS as one giant configurable mode. Instead, keep one shared product core and support two opinionated install profiles:

- `solo`: one-domain, low-admin, self-hosted quickstart
- `platform`: multi-org, host-based SaaS setup with full instance governance

## Why This Matters

Today the codebase already contains the building blocks for:

- multi-org host/domain governance
- plugin entitlements
- org-level limits
- publish-domain routing
- super-admin instance operations

That works well for the managed SaaS setup, but it is too conceptually heavy for a solo developer who mostly wants:

1. a VPS
2. one domain
3. Studio at `/vivd-studio`
4. the live site on `/`

If we push the SaaS model directly onto self-hosters, setup and maintenance both become harder than necessary. If we fork the architecture too far, maintainability gets worse for us. The right solution is a profile split with shared services and sharply bounded differences.

## Target Product Shape

### Profile 1: `solo`

Optimized for self-hosted quickstart.

- Primary host serves both the public site and Studio.
- Public site lives at `/`.
- Studio lives at `/vivd-studio`.
- Public plugin endpoints live on the same host by default (`/plugins/*`).
- `SINGLE_PROJECT_MODE` stays optional and off by default.
- Most super-admin/platform concepts are hidden or collapsed into instance settings.
- No tenant-host model is required.
- No per-project plugin entitlement matrix is required.

### Profile 2: `platform`

Optimized for multi-org SaaS and advanced self-hosters.

- Control plane lives on a dedicated host such as `app.<base>`.
- Public plugin runtime can live on `api.<base>`.
- Publish domains remain governed by the domain registry.
- Managed tenant hosts like `{org}.<base>` remain supported.
- Full org-level limits, entitlement overrides, domain governance, and runtime controls stay available.

## Core Principles

1. One shared runtime core
- Backend, Studio, publish pipeline, plugin implementations, and usage recording remain shared.
- Do not create separate self-hosted and SaaS implementations of the same business logic.

2. Opinionated profiles over endless configurability
- New installs pick `solo` or `platform`.
- Each profile enables a bounded set of features and UI surfaces.
- Avoid supporting every possible combination of routing, entitlement, and admin behavior.

3. Super admin controls capability, not daily feature usage
- Super admin decides whether a feature is available.
- Organization or project admins configure and use that feature day to day.

4. Inheritance over duplication
- Resolve effective policy from shared layers instead of hardcoding separate rules per mode.

## Policy Split

### Instance policy

Owned by instance admin / super admin.

Examples:

- install profile (`solo` or `platform`)
- plugin availability on this installation
- default usage limits
- whether org-level overrides are enabled
- whether project-level plugin entitlements are enabled
- whether custom domains / tenant hosts are enabled
- whether plugin runtime is same-host or dedicated-host

### Organization policy

Used only when enabled by the active profile.

Examples:

- org-level plugin allow/deny overrides
- org-level limit overrides
- org domain governance

### Project configuration

Normal day-to-day project behavior.

Examples:

- contact recipient emails
- analytics settings
- plugin content/config
- publish/unpublish actions

### Practical rule

- Super admin decides whether a plugin is available at all.
- Org admin optionally narrows or expands access if that profile supports it.
- Project admin configures the plugin once available.

Project-level plugin entitlement should be an advanced exception, not the default model.

## Plugin Model

### `solo`

- If a plugin is available on the instance, it is available to the project.
- Plugin usage is controlled primarily by project configuration.
- Super admin should not need to manage per-project entitlement rows.
- UI should present plugin availability as simple instance toggles where possible.

### `platform`

- Keep the current entitlement machinery.
- Preferred resolution order:
  1. instance default
  2. organization override
  3. project override only when explicitly enabled

### Backend direction

Keep `PluginEntitlementService` as the core resolver, but extend it so effective access is instance-first instead of assuming the org/project database rows are the full source of truth.

## Limits Model

### `solo`

- Default limits come from instance settings or env defaults.
- Org-level limit editing is hidden by default.
- Limit behavior remains enforced through the existing usage/limits pipeline.

### `platform`

- Keep current env defaults plus org-level overrides.
- Preserve quota/credit UI and warning behavior.

### Backend direction

Keep `LimitsService` as the effective resolver and add instance-managed defaults on top of the current env fallback. Avoid introducing a second limit system for self-hosting.

## Routing and Networking Model

### `solo`

Default self-hosted topology:

- `https://example.com/` -> published site
- `https://example.com/vivd-studio` -> Studio/control plane
- `https://example.com/plugins/*` -> public plugin runtime

Optional bootstrap without a domain:

- IP-only installs use the same path-based shape
- TLS and nice host-based UX are unavailable until a domain is configured

This profile should not require:

- `app.<base>`
- `api.<base>`
- wildcard DNS
- tenant-host routing

### `platform`

Default SaaS topology:

- `https://app.<base>/` or `https://app.<base>/vivd-studio` -> control plane
- `https://api.<base>/plugins/*` -> public plugin runtime
- `https://{org}.<base>/...` -> optional managed tenant hosts
- custom publish domains continue through the domain registry

### Caddy / ingress direction

- Support `caddy_edge` as the default self-hosted ingress mode.
- Keep `external_proxy` compatibility for Dokploy/Traefik.
- Do not maintain two different routing products. Caddy should remain Vivd's routing source of truth in both modes.

## Admin Surface Split

### `solo`

Expose only the settings a self-hoster actually needs:

- General / active profile + routing summary
- Plugins
- Limits
- Email
- Runtime / machine operations

Hide or collapse:

- easy `solo` -> `platform` switching from the standard self-host UI
- install-profile switching from the standard admin UI
- org directory
- domain governance UI
- plugin entitlement matrix
- per-org project access administration
- advanced multi-org operations

Consider renaming `Super Admin` to `Instance Settings` in this profile.

### `platform`

Keep the full super-admin surface:

- organizations
- users
- plugins
- email
- domains
- runtime / machines
- org-level usage and limits

## Data and Config Additions

### Instance settings

Reuse the existing system settings mechanism to store install-profile and capability defaults.

Add settings for:

- `install_profile`
- `instance_capability_policy`
- `instance_plugin_defaults`
- `instance_limit_defaults`

Suggested capability shape:

```json
{
  "multiOrg": false,
  "tenantHosts": false,
  "customDomains": false,
  "orgLimitOverrides": false,
  "orgPluginEntitlements": false,
  "projectPluginEntitlements": false,
  "dedicatedPluginHost": false
}
```

### Environment bootstrap

Use env vars only for initial bootstrap/defaults, then prefer stored instance settings for runtime behavior. This keeps self-hosting editable from the product UI instead of forcing manual env changes for every capability tweak.

## Backend Implementation Plan

### 1. Add install-profile service

Create a small service that resolves:

- active install profile
- effective capability flags
- instance defaults for plugins and limits

This becomes the single backend source of truth for profile-aware behavior.

### 2. Refactor plugin access resolution

Update plugin access flow to resolve from:

1. instance policy
2. organization override if enabled
3. project override if enabled

Project configuration remains separate from access resolution.

### 3. Refactor limits resolution

Extend the current limits stack so `LimitsService` merges:

1. env bootstrap defaults
2. instance default overrides
3. org overrides where enabled

### 4. Split routing policy from domain registry policy

Separate these concerns in the publish/domain layer:

- whether this install uses path-based or host-based control-plane/plugin routing
- whether custom publish domains are enabled
- whether tenant hosts are enabled

Do not let one broad toggle disable unrelated routing and domain behaviors.

### 5. Break up super-admin router by responsibility

Keep a single top-level nav item if desired, but split the backend surface into smaller routers/services:

- instance
- organizations
- plugins
- limits
- domains
- runtime
- email

This should reduce long-term maintenance pressure on `superadmin.ts`.

## Frontend Implementation Plan

### 1. Expose profile/capability config to the app shell

Extend app config response with:

- install profile
- capability flags
- plugin runtime topology

### 2. Gate UI by profile

For `solo`:

- hide irrelevant super-admin sections
- simplify navigation wording
- default to single-project behavior
- make plugin settings feel instance/project oriented, not organization/platform oriented

For `platform`:

- preserve the current multi-org UI structure

### 3. Keep project plugin configuration outside super admin

Project plugin screens remain the place for:

- recipient emails
- field configuration
- analytics settings
- generated snippets/info

Super admin remains the place for capability and policy, not content.

## Installer / Self-Hosted UX Plan

### `solo` quickstart

Ask only for:

- domain or IP
- whether to enable HTTPS
- basic secrets and API keys
- whether to run single-project mode

Default to:

- `install_profile=solo`
- same-host plugin runtime
- no custom domains
- no tenant hosts

### `platform` install

Ask for the current SaaS-oriented networking/domain inputs separately.

This keeps the quickstart path small without removing advanced capability from the product.

## Rollout Plan

### Phase 1: Profile foundation

- Add install-profile and capability settings.
- Expose them via app config.
- Resolve a single runtime default profile and allow explicit env/system-setting override.

### Phase 2: Backend policy unification

- Make plugin and limits resolution instance-first.
- Preserve existing org/project data models for `platform`.

### Phase 3: `solo` routing/profile

- Implement same-host path-based plugin/control-plane routing.
- Gate domain/tenant-host features behind profile capabilities.

### Phase 4: UI split

- Slim the admin UI for `solo`.
- Keep the full super-admin UI for `platform`.

### Phase 5: Installer and docs

- Default new self-hosted installs to `solo`.
- Host a solo-only self-host installer bundle and public setup guide.
- Document advanced migration/upgrade path from `solo` to `platform`.

## Testing Plan

### Backend

- capability/profile resolution tests
- plugin entitlement resolution across instance/org/project layers
- limits resolution across env/instance/org layers
- routing/domain policy tests for `solo` vs `platform`

### Frontend

- app-shell/nav gating tests for `solo` vs `platform`
- plugin/settings visibility tests
- single-project self-hosted flow tests

### Integration

- `solo` install smoke: one host, `/`, `/vivd-studio`, `/plugins/*`
- `platform` smoke: current SaaS host/domain behavior remains intact
- migration smoke: existing installs can stay `platform` when pinned explicitly or already stored, while fresh/unset installs resolve to `solo`

## Acceptance Criteria

- A new self-hosted user can get started with one domain and minimal setup.
- Self-hosted users do not need to understand org entitlements, tenant hosts, or multi-org governance for normal usage.
- Super admin still controls plugin availability, limits, and instance capabilities.
- Project/plugin configuration remains outside super admin.
- Existing SaaS behavior remains supported without branching the product into two codebases.

## Expected File Touchpoints

- `Caddyfile`
- `.env.example`
- `packages/backend/src/services/system/SystemSettingsService.ts`
- new install-profile / capability-policy service under `packages/backend/src/services/system/` or `packages/backend/src/services/config/`
- `packages/backend/src/services/plugins/PluginEntitlementService.ts`
- `packages/backend/src/services/usage/LimitsService.ts`
- `packages/backend/src/services/publish/DomainService.ts`
- `packages/backend/src/services/publish/PublishService.ts`
- `packages/backend/src/trpcRouters/config.ts`
- `packages/backend/src/trpcRouters/superadmin.ts`
- frontend app-config and admin shell / navigation surfaces
