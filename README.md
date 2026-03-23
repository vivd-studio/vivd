<div align="center">

# vivd

**Build websites by talking to AI**

An AI-powered website builder that turns a brief, a reference site, or a conversation into a live website. Fair-code and self-hostable, with [OpenCode](https://github.com/anomalyco/opencode) running in isolated project environments and publishing built into the workflow.

[Public Docs](https://docs.vivd.studio) · [Features](https://docs.vivd.studio/features/) · [Development](#development) · [Self-Hosting](#self-hosting)

</div>

---

![Vivd branded landing page shown beside the Studio chat workspace and embedded project preview](assets/new-screenshots/vivd-studio-vivd-dark.png)

## What vivd is

vivd is a website builder where AI is the interface. Instead of bouncing between a CMS, design tools, hosting dashboards, and hand-written edits, you create a project, describe what you want, and refine it in one place.

You can start from scratch or import an existing website, then keep shaping it in Studio with chat, direct edits, assets, preview, plugins, and publishing flows that all belong to the same project instead of a chain of separate tools.

Under the hood, Vivd runs [OpenCode](https://github.com/anomalyco/opencode) inside isolated Studio environments, so the agent works inside real project files rather than a toy canvas. That technical split matters because it lets Vivd cover the whole path: generate a draft, refine it in a real workspace, and solve publishing as part of the same system instead of handing you off to another stack at the end.

Vivd is also meant to be something you can actually run yourself: fair-code, self-hostable, and built so the same product can work as a hosted platform or as your own one-host deployment.

Public product docs live in `packages/docs`. Internal planning and architecture notes live in `docs/`.

## Core Product Features

- start from scratch from a brief, design references, and brand assets
- import an existing website or ZIP into a first draft
- refine the project in Studio with AI chat, direct edits, preview, files, and assets
- create and edit images with AI, then keep plugins and analytics inside the same project flow
- publish to the live domain and self-host the stack when needed

## What the agent can actually do

The agent in Vivd is not limited to rewriting copy. It can work across the real project, use built-in platform capabilities, and take a site much closer to done on its own.

- create and restructure pages, components, styles, and content in the workspace
- generate images and add them directly into the site
- add first-party Vivd plugins such as Contact Form and Analytics
- fetch the plugin information it needs from Vivd itself and wire those plugins into the page autonomously
- keep working all the way through preview and publishing instead of stopping at mockups

That is a core part of the product: Vivd ships platform capabilities the agent can actually use, not just a chat box around an LLM. More first-party plugins are planned over time.

## What The Repo Contains

- `packages/frontend` and `packages/backend` power the main app and control plane.
- `packages/studio` is the isolated Studio runtime where editing and agent work happen.
- `packages/docs` is the public docs site.
- `docs/` holds internal notes, planning, and architecture material.

## Development

### Prerequisites

- Node.js 20+
- Docker Engine + Docker Compose v2
- `OPENROUTER_API_KEY`

### Recommended Local Workflow

```bash
git clone https://github.com/felixpahlke/vivd.git
cd vivd
npm install
cp .env.example .env
# set at least OPENROUTER_API_KEY in .env
docker compose up -d
```

For the default Compose-based local setup, the backend container runs Drizzle migrations on startup. You usually do not need a separate host-side `npm run db:migrate` just to boot the stack.

For day-to-day local work, the main endpoints are:

- `http://localhost/` for the published-site host and default fallback page
- `http://localhost/vivd-studio` for the control plane and Studio entry
- `http://docs.localhost/` for the public docs workspace
- `http://api.localhost/plugins/*` for the public plugin API host in local dev

`.env.example` is Compose-oriented. If you run packages directly on the host instead of inside Compose, replace service hostnames such as `postgres`, `backend`, and `scraper` with host-reachable values.

### Useful Workspace Commands

| Purpose | Command |
| --- | --- |
| Backend dev server | `npm run dev -w @vivd/backend` |
| Frontend dev server | `npm run dev -w @vivd/frontend` |
| Studio runtime dev server | `npm run dev -w @vivd/studio` |
| Docs site | `npm run dev -w @vivd/docs` |
| Scraper service | `npm run dev -w @vivd/scraper` |
| Generate Drizzle migrations | `npm run db:generate` |
| Apply Drizzle migrations | `npm run db:migrate` |
| Local CI-style check | `npm run ci:local` |

Vivd uses npm workspaces with one root `package-lock.json`. Install dependencies at the repo root and prefer workspace-scoped commands such as `npm run build -w @vivd/backend`.

For tests, prefer targeted runs in the areas you changed before reaching for the broader `ci:local` variants.

## Self-Hosting

Vivd currently ships a first-party `solo` self-host path:

- one primary public host
- Studio mounted at `/vivd-studio`
- same-host public plugin routes under `/plugins/*`
- Docker-based Studio machines by default
- local S3-compatible project storage by default

The current public install path is:

```bash
curl -fsSL https://docs.vivd.studio/install.sh | bash
```

If you need the SaaS-style multi-org host-based behavior instead, use the `platform` install profile explicitly.

For operator-facing details, use the public docs for [Self-Hosting](https://docs.vivd.studio/self-hosting/), [How Vivd Works](https://docs.vivd.studio/how-vivd-works/), [Instance Settings](https://docs.vivd.studio/instance-settings/), and [Domains & Publish Targets](https://docs.vivd.studio/domains-and-publish-targets/).

## License

vivd follows a fair-code, source-available licensing model.

The binding legal terms are the Business Source License 1.1 (BUSL-1.1) with a Vivd-specific Additional Use Grant. This is not an OSI-approved open-source license.

- Free without a separate commercial license: self-hosted `solo` deployments for your own organization and other single-tenant self-use covered by the Additional Use Grant.
- Separate commercial license required: `platform`, multi-tenant, shared-control-plane, hosted SaaS, agency/client-delivery, white-label, OEM, embedded, and other productized commercial uses outside that grant.
- Generated website output created with vivd is not itself the Licensed Work.

See [LICENSE](LICENSE) for the binding terms and [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for the plain-language summary.

---

<div align="center">

**[vivd.studio](https://vivd.studio)**

</div>
