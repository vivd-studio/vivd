# Credits, Google Auth, And Template Commerce Plan

Date: 2026-04-28  
Owner: platform / growth  
Status: proposed

## Goal

Make the hosted product easy to try, easy to pay for, and ready for the HTML-first template flow.

This plan covers:

- Google authentication
- a customer-facing credit system
- credit-pack purchase flow
- agency-managed, self-serve, and hybrid payment models
- free signup credits
- HTML template generation and purchase rules
- superadmin controls for manual billing/payment adjustments

## Product Direction

Vivd should be credit-based for hosted usage.

Credits should not continue to feel like cents. The current historical framing of `1 credit = 1 cent` is too low-level and tied too closely to raw provider cost. The next hosted model should treat one credit as a larger customer-facing unit, closer to one dollar, while still letting the backend convert credits to internal usage budgets.

Initial working assumption:

- `1 credit` is roughly a dollar-sized unit.
- Credit pricing includes a profit factor over expected provider/runtime cost.
- Start with a default margin factor around `1.5x`, but make the factor configurable so pricing can change without rewriting product logic.
- Credits are used for both generation and template/project conversion actions.
- Superadmins can manually grant, revoke, comp, charge, or mark payment state for a tenant/client.

## Google Authentication

Add Google sign-in as a first-class hosted onboarding path.

Requirements:

- Users can sign up and sign in with Google.
- Google auth should coexist with email/password and existing invite/reset flows.
- Organization membership and tenant creation rules stay explicit after Google sign-in.
- New-user credit grants apply once per real user, not once per auth method.
- Account linking should avoid duplicate users when the same email signs in through Google after using email/password.
- Superadmin and invite flows must remain safe: Google auth should not bypass membership, role, invite, or tenant access checks.

Open decisions:

- Whether Google auth is hosted-only at first or also configurable for `solo`.
- Whether to support account linking immediately or initially block ambiguous duplicate-account cases with a clear recovery flow.
- Whether the first launch requires Google One Tap or only normal OAuth sign-in buttons.

## Credit Model

### Customer-Facing Credits

Credits are what users see and buy.

Initial assumptions:

- New users receive `3 credits` at registration.
- One generated HTML template purchase may cost `1 credit`.
- Template generation itself may also cost `1 credit`; this is an open pricing/product decision.
- Credits should be visible in the app as a small balance, with plain language about what they can be used for.

### Internal Cost Conversion

The system should separate customer credits from raw model/provider costs.

Conceptual model:

- Track real provider/runtime cost internally.
- Convert usage to customer credits using a configurable price/margin factor.
- Keep the default factor around `1.5x` until real usage data suggests otherwise.
- Avoid exposing provider cost, model-specific cost, or token math to normal users.

Suggested config shape:

- `CREDIT_UNIT_PRICE_USD`, default near `1.00`
- `CREDIT_MARGIN_FACTOR`, default near `1.5`
- `SIGNUP_CREDIT_GRANT`, default `3`
- per-action credit prices for template generation, template purchase, and project conversion

## HTML Template Commerce Flow

This builds on the roadmap item for HTML-only new-project proposals.

### Flow

1. User signs up, ideally with Google, and receives starter credits.
2. User asks Vivd for a new site/template.
3. Vivd generates a standalone HTML-only design proposal using the standard model, currently Gemini Flash.
4. The user previews the HTML proposal before a full project exists.
5. The user can regenerate another HTML proposal if they do not like it.
6. When the user likes a proposal, they spend credits to buy/commit to that template.
7. Vivd creates a real project from the existing Astro starter template.
8. The generated HTML is passed as source/design context to the Studio agent.
9. The Studio agent turns the HTML into an Astro project and applies Vivd CMS primitives where appropriate.

### Pricing Questions

Open decision:

- Should generating an HTML proposal cost `1 credit`, or should only buying/committing to a template cost credits?

Possible first model:

- Signup grant: `3 credits`
- Generate HTML proposal: `1 credit`
- Buy/commit a selected HTML template: `1 credit`
- Remaining credits can be used for early editing/generation work

Alternative first model:

- Signup grant: `3 credits`
- Generate HTML proposals: free or limited by rate cap
- Buy/commit a selected template: `1 credit`
- Remaining credits support edits and follow-up generation

The first model is simpler for cost control. The second model may be better for conversion if users need to see a design before spending anything.

### Storage And Ownership

Generated HTML proposals should be stored as pre-project artifacts, not as full projects.

They need:

- owner/user/tenant association
- prompt and model metadata
- HTML artifact
- preview URL or render path
- generation cost/credit ledger entry
- purchase/commit state
- conversion state once turned into a real project

## Payment Strategy

The payment strategy has to support two real sales motions at once:

- agency-managed client work where invoices, retainers, and client relationships may happen outside the platform
- self-serve SaaS usage where users can buy credits and extra services directly inside Vivd

The core product should not assume that every customer pays the same way. The credit ledger should be the common source of truth, while the payment source can vary.

### Operating Model Options

#### Option A: Agency-Managed Invoicing

The superadmin handles payment outside Vivd and assigns credits or monthly pools manually.

Use cases:

- existing customers who already receive separate invoices
- bespoke client projects
- agency retainers
- clients who should not need to use checkout themselves

Pros:

- maximum flexibility for early customer relationships
- easy to support negotiated pricing and service bundles
- no need to force every client through platform billing immediately

Cons:

- more manual accounting work
- weaker self-serve conversion loop
- higher risk that platform credit state and real payment state drift unless manual adjustments are audited carefully

#### Option B: Pure Self-Serve SaaS

All credit purchases happen through the platform checkout provider.

Use cases:

- new self-serve users from Reddit or other public launches
- small customers who want to try, buy, and continue without sales contact
- simple top-up purchases for template generation and follow-up editing

Pros:

- clean product loop
- less manual work
- easier to reason about payment confirmation, receipts, and credit grants

Cons:

- less flexible for agency/client relationships
- harder to support negotiated monthly packages or off-platform invoices
- may be too rigid during the early launch phase

#### Option C: Hybrid Monthly Pool Plus Self-Serve Top-Ups

Each tenant can have a monthly credit pool assigned by the superadmin, while users can also buy extra credits directly when they run out or want more work done.

Use cases:

- clients on a monthly agency plan
- SaaS users who get an included monthly allowance
- customers who occasionally need extra templates, edits, or services

Pros:

- combines agency flexibility with self-serve growth
- lets the superadmin assign credits for custom plans, retainers, promotions, and support cases
- gives customers an easy path to buy more without waiting for manual intervention

Cons:

- needs clear UI so users understand included credits versus purchased credits
- needs careful ledger semantics for recurring monthly grants, top-ups, expiry, and refunds
- needs superadmin controls that are powerful but auditable

Preferred first direction:

- Design for the hybrid model, but ship it in slices.
- Start with manual superadmin grants and a ledger that can represent monthly pools.
- Add self-serve credit-pack purchases once checkout/webhooks are ready.
- Keep agency-invoiced customers supported by allowing superadmin-assigned monthly pools and manual adjustments.

### Monthly Credit Pools

Monthly pools are credits assigned to a tenant by plan, invoice, retainer, or manual agreement.

Questions to decide:

- Are monthly pool credits reset each month or do unused credits roll over?
- Can a tenant have both included monthly credits and purchased top-up credits?
- Which credits are spent first: monthly pool credits or purchased credits?
- Can superadmins create one-off monthly overrides for a specific tenant?
- Should monthly pool assignment be connected to a payment provider subscription, an off-platform invoice, or either?

Likely first model:

- Support a tenant-level monthly credit grant controlled by superadmin.
- Track purchased credits separately from monthly grants in the ledger.
- Spend monthly/included credits first unless product reasons suggest preserving them.
- Let superadmin grant, debit, comp, or expire credits with an audit reason.

### Payment Provider Strategy

The system should avoid hard-coding the idea that every credit grant came from the checkout provider.

Payment sources to model:

- platform checkout
- provider subscription or recurring invoice
- external/manual invoice
- agency retainer
- manual comp/grant
- refund/void

Open provider decision:

- Should agency/manual invoices use the same payment provider as self-serve checkout, or can they stay outside Vivd while the platform records manual credit grants?

Recommended architecture:

- Use the credit ledger as the canonical Vivd-side accounting record.
- Store an optional external payment reference for checkout/subscription/invoice-provider events.
- Allow manual/off-platform entries without an external payment reference, but require a superadmin actor and reason.
- Keep provider-specific details behind a payment adapter so the platform can support checkout now and more structured invoices/subscriptions later.

This lets Vivd combine agency decisions with self-serve SaaS behavior without forcing all customers into one payment path too early.

### Self-Serve Credit Purchase

First-pass target:

- Let users buy fixed credit packs through a hosted checkout provider.
- Prefer a low-friction, well-supported provider such as Stripe Checkout unless another provider is clearly simpler for the launch.
- Keep the app-side billing surface focused on credit balance, purchase button, recent credit activity, and receipts/invoices where available.
- Avoid building a full custom billing portal before the product has pricing signal.

Credit pack examples to evaluate:

- `5 credits`
- `10 credits`
- `25 credits`

Requirements:

- Purchases create immutable ledger entries.
- Credits are credited only after confirmed payment/webhook success.
- Failed/canceled payments do not grant credits.
- Superadmin can manually grant or remove credits and add a reason.
- Superadmin can mark or override tenant payment state for manual client arrangements.
- Manual adjustments are visible in an audit/history view.

## Ledger And Controls

Use a ledger, not only a mutable balance.

Ledger entry types:

- signup grant
- monthly pool grant
- monthly pool expiry or reset
- purchased credits
- template generation charge
- template purchase/commit charge
- project conversion charge, if separate
- Studio/editing usage charge
- manual superadmin grant
- manual superadmin debit
- refund/void/comp

Each entry should record:

- tenant/org
- user, if applicable
- amount
- reason/type
- payment source, such as checkout, subscription, manual invoice, agency retainer, or comp
- related artifact/project/payment ID
- optional external payment/provider reference
- superadmin actor for manual adjustments
- timestamp

## Rollout Slices

### Slice 1: Planning And Data Model

- Decide customer-facing credit unit and initial action prices.
- Add ledger schema and internal credit balance computation.
- Add superadmin manual adjustment surface.
- Add payment source and optional external-provider references to ledger entries.
- Define monthly pool semantics for tenant-level included credits.
- Keep provider checkout disabled behind config until ready.

### Slice 2: Google Auth

- Add Google sign-in/sign-up.
- Protect invite/org membership semantics.
- Add account-linking or duplicate-account guardrails.
- Ensure signup credits are granted exactly once.

### Slice 3: Credit Purchase MVP

- Add checkout provider integration for fixed credit packs.
- Add webhook confirmation and ledger crediting.
- Add simple balance/activity UI.
- Add superadmin payment override/manual credit controls.

### Slice 3b: Hybrid Account Controls

- Add tenant-level monthly credit pool controls.
- Let superadmin assign included credits for agency/client plans.
- Show users the difference between included/monthly credits and purchased top-up credits.
- Support manual invoice/retainer ledger entries with required reasons and audit history.

### Slice 4: HTML Proposal Charging

- Store HTML proposals as pre-project artifacts.
- Charge or reserve credits for generation, depending on the chosen pricing model.
- Charge credits for buying/committing to a selected template.
- Show clear balance and cost copy before the user spends credits.

### Slice 5: Conversion To Real Project

- Convert purchased HTML proposals into real Astro projects.
- Start from the existing Astro starter template.
- Provide the generated HTML as context to the Studio agent.
- Ask the agent to recreate the design in Astro and apply Vivd CMS primitives where they genuinely fit.

## Open Decisions

- Should HTML proposal generation cost a credit immediately, or should only buying the selected template cost a credit?
- Should template purchase and Astro conversion be one charge or separate charges?
- Which checkout provider is simplest for launch while still supporting webhooks, receipts, and future subscriptions?
- Should agency invoices use the same payment provider as self-serve checkout, or stay outside Vivd with manual ledger entries?
- Should the first launch ship agency-managed credits, self-serve checkout, or the hybrid model?
- Should monthly tenant credits roll over or reset?
- Should included monthly credits or purchased top-up credits be spent first?
- Should signup credits expire?
- Should superadmin manual payment state be tenant-wide, project-specific, or both?
- Should Google auth be platform-only initially?

## Validation

When implemented, validation should include:

- auth tests for Google sign-in, invite membership, duplicate emails, and one-time signup credits
- backend ledger tests for purchases, debits, manual adjustments, refunds, and balance calculation
- monthly pool tests for grants, resets/expiry, top-up spending order, and superadmin overrides
- webhook tests for paid, failed, duplicate, and replayed payment events
- frontend tests for credit balance, purchase flow, and pre-spend confirmation
- HTML proposal tests for generation charge/purchase/conversion state transitions
- superadmin tests for manual credit/payment overrides and audit history
