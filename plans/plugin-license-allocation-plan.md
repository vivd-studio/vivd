# Plugin License Allocation Plan

Date: 2026-04-28  
Owner: platform / plugins  
Status: proposed

## Goal

Move plugin access from superadmin-managed per-project entitlement toward organization-owned plugin license pools.

An organization should be able to buy or receive a number of licenses for a plugin, then freely assign those licenses to projects inside the organization. If the organization stops using a plugin on one project, it should be able to unassign that license and reuse it on another project without asking a superadmin to reconfigure access.

This should cover plugins such as:

- Contact Form
- Newsletter
- Table Booking
- Analytics or future paid plugins where project-level usage should be metered or licensed

## Naming

Use `license` as the first product term unless user testing suggests a better word.

Reasoning:

- `License` communicates that the organization bought the right to use a plugin on a certain number of projects.
- `Token` conflicts with AI/model-token language and could confuse credit usage.
- `Seat` is usually user-based, while this model is project-assignment based.
- `Entitlement` should remain an internal implementation term, not the customer-facing label.

Recommended language:

- `Plugin licenses`
- `1 Newsletter license`
- `Assigned to 2 of 3 projects`
- `Buy another license`
- `Move license to another project`

## Product Model

### Organization-Owned Plugin License Pools

Each organization/tenant has a license pool per plugin.

Examples:

- Acme has `2` Contact Form licenses.
- Acme has `1` Newsletter license.
- Acme has `0` Table Booking licenses.

The organization can assign each license to one project at a time.

Example:

- Contact Form license 1 assigned to `main-site`
- Contact Form license 2 assigned to `campaign-site`
- If `campaign-site` no longer needs Contact Form, the org admin can unassign it and assign that license to `new-landing-page`

### Assignment Rules

- One plugin license enables that plugin for one project.
- A project can use a plugin only when an active license for that plugin is assigned to it.
- Organization admins can assign and unassign available licenses inside their organization.
- Superadmins can grant, revoke, suspend, comp, or adjust license counts.
- Buying more licenses should be easy from the organization/plugin surface.
- Unassigning a license should disable or suspend project-level plugin usage without deleting historical plugin data by default.
- Reassigning a license should provision or reactivate the plugin instance for the target project.

### What Happens To Existing Entitlements

The existing `plugin_entitlement` concept should become a lower-level compatibility/enforcement mechanism, not the product model users manage directly.

Preferred direction:

- Product-facing source of truth: organization plugin license pool plus project assignment.
- Runtime enforcement: project has an active assignment for that plugin and the organization license pool is valid.
- Compatibility: existing org/project entitlements can be migrated or adapted into license pools and assignments.
- Superadmin-only overrides remain available for exceptional cases, suspension, support, or migration repair.

## Purchase And Payment Relationship

Plugin licenses should connect to the broader credit/payment plan in [`plans/credits-auth-template-commerce-plan.md`](./credits-auth-template-commerce-plan.md).

Open decision:

- Should plugin licenses be bought directly with normal checkout/payment, with credits, or with a separate subscription/package model?

Likely first model:

- Superadmin can manually grant plugin licenses to agency-managed clients.
- Self-serve organizations can buy additional plugin licenses from the plugin catalog or organization billing area.
- License purchases create ledger/payment records just like credit purchases.
- Monthly/client plans can include a certain number of plugin licenses.
- Extra plugin licenses can be bought on top.

This supports the hybrid sales motion:

- agency-managed clients get licenses assigned as part of an invoice, retainer, or custom plan
- self-serve users can buy more licenses without waiting for support
- superadmin can still comp, revoke, or suspend licenses when needed

## UX Surfaces

### Organization Plugin Licenses

Add or redesign an organization-level plugin/license surface.

It should show:

- plugin name and status
- total licenses owned
- licenses assigned
- licenses available
- assigned projects
- usage/limits where relevant
- buy/add license action
- assign/unassign action

Example copy:

- `Newsletter`
- `1 of 2 licenses assigned`
- `Assign to project`
- `Buy another license`

### Project Plugin Page

Project plugin pages should reflect whether the organization has an available license.

States:

- plugin assigned and active for this project
- organization owns available licenses and can assign one here
- all licenses are already assigned elsewhere
- organization has no licenses yet and can buy/request one
- plugin suspended or unavailable by superadmin/platform policy

### Superadmin Controls

Superadmin needs an override/control surface for:

- adding/removing license count
- marking licenses as paid through manual invoice, checkout, comp, trial, or plan
- suspending a plugin license pool
- viewing project assignments
- moving assignments during support
- audit/history of who changed license counts and assignments

## Data Model Direction

Proposed new concepts:

### `plugin_license_pool`

Tenant-level license count for a plugin.

Fields to consider:

- `organization_id`
- `plugin_id`
- `total_quantity`
- `state`: active, suspended, cancelled
- `source`: checkout, subscription, manual_invoice, agency_retainer, comp, migration
- `monthly_event_limit` or plugin-specific limits where needed
- `notes`
- `created_at`, `updated_at`

### `plugin_license_assignment`

Project-level assignment of one unit from a pool.

Fields to consider:

- `organization_id`
- `project_slug`
- `plugin_id`
- `state`: active, suspended, unassigned
- `assigned_by_user_id`
- `assigned_at`
- `unassigned_at`
- `notes`

Initial implementation does not need to model individual serial-number licenses unless that helps auditability. A pool quantity plus assignment rows may be enough:

- total licenses = `plugin_license_pool.total_quantity`
- assigned licenses = count of active assignment rows
- available licenses = total minus active assignments

## Runtime Enforcement

Runtime plugin availability should resolve through:

1. plugin exists and is available in the installed registry
2. organization license pool for plugin is active and has quantity
3. project has an active assignment for that plugin
4. superadmin/platform policy has not suspended the plugin or organization pool
5. plugin-specific runtime limits are not exceeded

The frontend and CLI should display product-facing license state. Backend routes and public plugin endpoints must enforce it server-side.

## Rollout Slices

### Slice 1: Plan And Compatibility Mapping

- Map current `plugin_entitlement` and project plugin instance behavior.
- Decide migration strategy from org/project entitlements to license pools and assignments.
- Pick product terminology for the UI, defaulting to `licenses`.

### Slice 2: Data Model And Resolver

- Add license pool and assignment schema.
- Add resolver that answers: can this project use this plugin?
- Keep compatibility with existing entitlement rows during migration.

### Slice 3: Organization Assignment UI

- Add org-level plugin license view.
- Let org admins assign available licenses to projects.
- Let org admins unassign and reassign licenses without superadmin help.

### Slice 4: Project Plugin UX

- Update project plugin pages to show assign/buy/request states based on the organization license pool.
- Keep existing plugin-owned project pages thin and generic where possible.

### Slice 5: Purchase And Superadmin Controls

- Let organizations buy more plugin licenses from the plugin surface or billing area.
- Let superadmin grant/revoke/comp/suspend license counts and view assignment history.
- Connect license purchase and manual assignment to the broader credit/payment ledger where appropriate.

### Slice 6: Migration And Cleanup

- Migrate existing enabled project entitlements into license pools plus assignments.
- Keep old entitlement compatibility only as long as needed.
- Remove or hide project-level entitlement matrix UI once the license model owns normal plugin access.

## Open Decisions

- Should customers buy plugin licenses with credits, direct checkout/payment, subscriptions, or all of these?
- Should every plugin use the same license model, or should some plugins remain unlimited once organization-enabled?
- Should license counts reset monthly, renew with subscription, or remain active until cancelled?
- Should unassigning a plugin immediately disable public endpoints, or enter a grace/suspended state first?
- Should historical plugin data remain accessible after unassignment?
- Should plugin usage limits be attached to the license pool, the assignment, or plugin-specific settings?
- Should project owners/admins be able to assign licenses, or only organization admins?

## Validation

When implemented, validation should include:

- backend resolver tests for available, assigned, exhausted, suspended, and migrated states
- project plugin page tests for buy/request/assign/unassign states
- organization plugin license UI tests
- superadmin license adjustment tests with audit history
- public plugin endpoint tests confirming unassigned projects cannot use licensed plugin runtime
- migration tests from existing entitlement rows to license pools and assignments
