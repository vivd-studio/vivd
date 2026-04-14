# Vivd Licensing FAQ

This file is a plain-English summary of Vivd's license model. It is not legal
advice.

If anything in this file conflicts with the binding legal terms, the legal
terms in [LICENSE](LICENSE) control.

## License Model

Vivd is source-available under Business Source License 1.1 (`BUSL-1.1`) with a
Vivd-specific `Additional Use Grant`.

That means:

- You can read the source code.
- You can copy, modify, and create derivative works from the source code.
- You can redistribute source code under the terms of the license.
- Production use is allowed in the specific cases described by the `Additional
  Use Grant`.

## What You Can Do Without A Separate Commercial License

You can use Vivd in production without a separate commercial license when the
deployment is isolated and dedicated to one company or one corporate group
under common control.

Allowed examples:

- A company self-hosts Vivd for its own internal work and public-facing sites.
- You take the code, modify it for yourself, and run your own modified version
  in your company's single-tenant deployment.
- A contractor or service provider customizes or maintains a single-tenant
  deployment on that entity's behalf.
- You use the normal Vivd app surface inside that isolated deployment,
  including frontend, backend, admin, users, organizations, projects, domains,
  and plugin management.
- You build plugins, extensions, and integrations for Vivd and use them within
  otherwise permitted deployments.

Also:

- Generated website output created with Vivd is not itself part of the
  Licensed Work.

## What Is Not Allowed Without A Separate Commercial License

The reserved cases are the platform-style business models built around one
shared Vivd control plane for multiple unrelated customers.

Not allowed examples:

- Running one shared hosted Vivd service for many unrelated customers.
- Operating Vivd as a multi-tenant SaaS.
- Providing Vivd to multiple unrelated customers from a shared deployment or a
  shared administrative, routing, billing, or runtime control layer.
- White-label, OEM, embedded, or other productized commercial distribution
  where the value derives substantially from Vivd functionality for multiple
  unrelated customers.

## Quick Comparison

Short version:

- Single-tenant self-hosting for yourself: allowed.
- Taking the code and modifying it for yourself: allowed.
- Using a contractor or service provider for your dedicated deployment:
  allowed.
- Shared hosted control plane for multiple unrelated customers: not allowed
  without a separate commercial license.
