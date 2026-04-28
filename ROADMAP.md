# Vivd Roadmap

> Durable product and engineering direction. Keep short-term handoff notes in `PROJECT_STATE.md` and historical detail in `PROJECT_STATE_ARCHIVE.md`.

## Product Direction

- Hosted `platform` mode is the managed SaaS lane and should be the default decision path when work does not explicitly target self-hosting.
- `solo` is the public self-host lane for one-host installs. Keep it coherent, documented, and scoped; do not imply full hosted-platform parity unless the code and docs support it.
- Separate generic tenant-core code from hosted platform code more clearly. The tenant core should own the one-organization experience: organization settings, default settings, and projects. Platform code should layer hosted SaaS behavior, multi-tenant operations, superadmin controls, and billing on top instead of leaking those concerns into the core flows.
- Backend/control-plane, Studio runtime, and plugin package boundaries are established enough for product work. Current architecture work should simplify, harden, or clarify those boundaries rather than reopening them wholesale.
- Preview and publish still run through the existing Studio/local build path while preview architecture and Studio lifecycle hardening continue.
- Scratch-to-Studio handoff is much better, but still needs repeatable attach/build validation across local, CI, and hosted flows.
- New-project creation should regain an HTML-only design-proposal stage before a full project exists. The standard model, currently Gemini Flash, should generate a plain HTML version first so the user can preview or regenerate the design before deciding whether to buy/commit to the template and turn it into a real Vivd project.
- Hosted onboarding and commerce should use Google authentication plus a credit-based model. Credits should be customer-facing dollar-scale units rather than cent-scale provider-cost units, with a configurable margin factor, manual superadmin controls, and a hybrid payment strategy that supports agency-invoiced clients, monthly credit pools, and self-serve top-ups. See `plans/credits-auth-template-commerce-plan.md`.
- Plugin access should move toward organization-owned plugin license pools: tenants buy or receive a quantity of licenses for plugins such as Contact Form, Newsletter, or Table Booking, then assign and reassign those licenses across their own projects without superadmin intervention. See `plans/plugin-license-allocation-plan.md`.
- Public project-copy workflows should be first-class duplicate/copy-version actions instead of arbitrary ZIP re-imports. Keep arbitrary ZIP import internal/superadmin-only, isolate preview builds from the control-plane request path, and converge backend/builder/Studio dependency repair behavior. See `plans/project-import-duplicate-build-safety-plan.md` and `plans/async-preview-builder-plan.md`.
- Published customer sites should move onto an external hosting/provider layer, preferably Cloudflare and otherwise AWS or a comparable provider, so customer websites continue serving even if the Vivd platform/control plane has an outage and so the hosted product can scale toward a real SaaS launch.
- Prepare an intentional Reddit launch as the first public launch motion, including product positioning, onboarding, support readiness, demo material, pricing/payment story, and operational safeguards.
- Studio chat should become more polished and end-user friendly: tighter agent reply spacing, clearer user-message contrast, compact grouped tool activity, and concise Studio agent instructions that plan proactively and speak to non-technical users. See `plans/studio-chat-agent-ux-plan.md`.
- Studio image drag/drop should become explicit and Astro/CMS-safe: previews should tell users whether a drop will update a CMS field, copy into entry media, reference shared media, patch Astro source, or be blocked. See `plans/studio-media-drop-ux-plan.md`.

## Active Priorities

1. Finish the platform-first cleanup in `plans/platform-first-stabilization-plan.md`.
2. Pull hosted platform concerns farther away from the generic tenant core so one-tenant organization/project behavior stays explicit and platform features compose on top.
3. Land the preview/runtime split in `plans/studio-preview-architecture-plan.md`.
4. Close the highest-value OpenCode-aligned Studio chat/runtime gaps.
5. Harden Studio lifecycle across Fly and Docker, especially auth, rehydrate/revert, quiesce, and env/image drift.
6. Define the external published-site hosting path so production customer websites are decoupled from Vivd platform availability.
7. Prepare the Reddit launch path and the operational/product readiness needed before posting publicly.
8. Execute `plans/credits-auth-template-commerce-plan.md` for Google auth, credit packs, signup credits, template charges, and superadmin billing controls.
9. Execute `plans/plugin-license-allocation-plan.md` so organizations can buy, assign, unassign, and reassign plugin licenses across projects without routine superadmin work.
10. Execute `plans/studio-chat-agent-ux-plan.md` so Studio chat and agent behavior fit non-technical website owners.
11. Finish the remaining follow-ups in `plans/studio-media-drop-ux-plan.md`, especially context-aware `This Entry` media scope and browser QA for the preview drop overlay.
12. Keep plugin extraction moving behind generic host contracts without leaking host policy into plugin contracts.
13. Execute `plans/project-import-duplicate-build-safety-plan.md` so users can duplicate projects and copy versions without unsafe ZIP workflows.
14. Execute `plans/async-preview-builder-plan.md` so preview artifact builds run in isolated builder jobs instead of the backend request path.

## Near-Term Backlog

- [ ] Finish the remaining `plans/shared-ui-primitives-plan.md` follow-ups by keeping frontend and Studio `components/ui/` limited to app-owned composites and routing future shared primitive additions straight through `@vivd/ui`.
- [ ] Break the next control-plane ops tranche into implementation-ready slices: reversible project archiving, superadmin project transfer, and post-login tenant redirect.
- [ ] Map the current platform/core coupling and define the first implementation slice for a tenant-core surface: one organization, organization/default settings, and projects, with hosted platform services layered above it.
- [ ] Design the first payment/billing integration so hosted tenants can pay for project/template conversion while a superadmin can still manually set, override, credit, or mark payment state for a tenant/client.
- [ ] Add Google authentication for hosted onboarding, with safe account-linking/invite behavior and one-time signup credit grants.
- [ ] Implement `plans/credits-auth-template-commerce-plan.md`: move credits toward dollar-scale units, add a configurable margin factor, grant new users 3 starter credits, support agency-managed monthly pools plus self-serve credit-pack top-ups, and use credits for HTML template generation/purchase/conversion decisions.
- [ ] Implement `plans/plugin-license-allocation-plan.md`: replace routine superadmin-managed project plugin entitlement with organization-owned plugin license pools and project assignment/reassignment controls.
- [ ] Prepare the Reddit launch: sharpen the launch post, target communities, onboarding path, demo projects, docs/support coverage, pricing/payment explanation, and rollback/support response plan.
- [ ] Plan the published-site hosting provider split, with Cloudflare preferred and AWS/comparable providers as fallback, so published customer sites are served outside the core Vivd platform/control-plane runtime.
- [ ] Implement `plans/studio-chat-agent-ux-plan.md`: reduce agent response padding, improve user-message contrast, group tool calls into compact activity rows, rewrite Studio agent instructions for non-technical users, and audit CMS guidance against the implementation.
- [ ] Finish `plans/studio-media-drop-ux-plan.md`: add context-aware `This Entry` media scope and browser QA on top of the implemented planner, hover explanations, CMS copy/reference choices, and Astro media scopes.
- [ ] Implement `plans/project-import-duplicate-build-safety-plan.md`: restrict arbitrary ZIP import to superadmins, add duplicate-project/copy-version workflows, and share dependency repair behavior across builder and Studio.
- [ ] Implement `plans/async-preview-builder-plan.md`: add backend build jobs, one-shot Docker/Fly builder providers, preview readiness state, and production-shaped proof that long builds do not block unrelated tenants.
- [ ] Reintroduce the HTML-only new-project proposal flow: generate standalone HTML with the standard model, show it to the user, allow regeneration, and only create the real project after the user chooses to commit.
- [ ] Define the paid conversion path from approved HTML proposal to real project: start from the existing Astro starter template, provide the generated HTML as source context, and prompt the Studio agent to turn it into an Astro project using Vivd CMS primitives.
- [ ] Fix intermittent stale Studio preview after inline text patching: CMS-owned, i18n-owned, and page-owned preview text edits should become visible immediately after save/patch without requiring a manual refresh. Investigate ownership/write-path handling plus devserver/HMR or iframe refresh behavior.
- [ ] Prove the scratch-to-Studio attach/build handoff end to end with repeatable smoke coverage.
- [ ] Define the next lightweight GitHub integration slice so linked personal accounts and user-chosen repository URLs share one repo-binding model.
- [ ] Decide the next follow-up after the current preview architecture work lands for preview artifact exposure and Studio URL policy.
- [ ] Land the next Table Booking slice from `plans/table-booking-plugin-plan.md`: a fullscreen live operator view with a local high-contrast mode so restaurants can run service from an always-open workstation surface.

## Roadmap Hygiene

- Keep this file future-facing: active priorities, near-term backlog, and durable product direction only.
- Keep `PROJECT_STATE.md` as a compact current handoff with only the latest two progress entries.
- Move closed-out detail, validation history, and compaction summaries into `PROJECT_STATE_ARCHIVE.md`.

Last updated: 2026-04-28
