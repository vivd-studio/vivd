<div align="center">

# vivd

**Build websites by talking to AI**

An AI-powered website builder that turns conversations into live, hosted websites.

[Getting Started](#getting-started) · [Features](#features) · [Tech Stack](#tech-stack) · [Self-Hosting](#self-hosting) · [Product Docs](packages/docs/README.md)

</div>

---

![Full Application View](assets/screenshots/raumquadrat_desktop_assets-chat-open_darkmode.webp)

## What is vivd?

vivd is a website builder where AI is the interface. Instead of dragging and dropping or writing code, you simply describe what you want — and it happens. The AI agent analyzes your existing content, understands your brand, and builds pages using modern web technologies.

Perfect for photographers, agencies, freelancers, and small businesses who want professional websites without the learning curve.

Public product docs now live in `packages/docs`, while the repo-root `docs/` directory remains internal planning and architecture material.

## Features

### Chat-Driven Editing

Open the chat panel, describe your changes, and watch them happen in real-time. Select specific elements on the page for targeted edits, or let the AI make sweeping changes across your entire site.

### Asset Management

Drag and drop images, manage your files, and let the AI incorporate them into your designs. The built-in asset explorer keeps everything organized.

![Asset Management](assets/screenshots/raumquadrat_desktop_assets-thumbnails_lightmode.webp)

### Visual Editor

Click "Edit Text" to make direct changes on the page. Combined with AI assistance, you get the best of both worlds — quick manual tweaks and intelligent automated edits.

### One-Click Publishing

Go from draft to live in seconds. vivd handles hosting, so your site is available on the internet the moment you click publish.

### Multi-Project Workspace

Manage multiple websites from a single dashboard. Switch between projects instantly, each with its own version history.

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, Radix UI |
| **Backend** | Node.js, Express, tRPC, Drizzle ORM |
| **Database** | PostgreSQL |
| **AI** | OpenRouter (Gemini, GPT-4, Claude, and more) |
| **Scraping** | Puppeteer with stealth mode |
| **Auth** | Better Auth |
| **Deployment** | Docker Compose, Caddy |

## Project Structure

```
vivd/
├── packages/
│   ├── backend/     # Express API + AI agent integration
│   ├── docs/        # Public product docs site
│   ├── frontend/    # React web application
│   ├── scraper/     # Puppeteer web scraping service
│   ├── shared/      # Shared types and utilities
│   └── theme/       # CSS theme package
├── assets/          # Static assets and screenshots
└── docs/            # Architecture and planning docs
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL (or use the Docker setup)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/your-org/vivd.git
cd vivd

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start the database
docker compose up -d db

# Run database migrations
npm run db:migrate

# Start all services in development mode
npm run dev
```

The app will be available at `http://localhost:5173`

With the Docker stack running, the public docs site is available at `http://docs.localhost`.

## Local CI Run

You can run a CI-like local check from repo root:

```bash
npm run ci:local
```

Optional tiers:

```bash
# Skip lint and run tests only
npm run ci:local:tests

# Include DB + bucket integration tests
npm run ci:local:integration

# Include builds + DB + bucket integration tests
npm run ci:local:full

# Include Fly integration tests as well
npm run ci:local:fly

# Include Fly integration tests and allow the known failing rehydrate/revert test
npm run ci:local:fly:known
```

All variants load `.env` / `.env.local` before running. Integration tiers require the relevant env vars (DB, object storage, Fly/OpenCode) to be configured.

## Self-Hosting

vivd can be self-hosted using Docker Compose:

```bash
# Configure your environment
cp .env.example .env
# Edit .env with your settings (database, API keys, etc.)

# Start all services
docker compose up -d
```

The default self-hosted profile is now `solo`: one primary host, the public site on `/`, Studio on `/vivd-studio`, and public plugin routes on the same host under `/plugins/*`.

If you want the current SaaS-style host-based behavior instead, set:

```bash
VIVD_INSTALL_PROFILE=platform
```

In `platform`, you should also configure the host-based routing envs explicitly, such as `CONTROL_PLANE_HOST`, `TENANT_BASE_DOMAIN`, and any dedicated plugin host/base URL you want to use.

Services included:
- **Frontend** — React application
- **Backend** — API server with AI agent
- **Docs** — Public product documentation site
- **Scraper** — Web scraping service
- **Database** — PostgreSQL
- **Caddy** — Reverse proxy with automatic HTTPS

## Configuration

Key environment variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENROUTER_API_KEY` | API key for AI model access |
| `BETTER_AUTH_SECRET` | Secret for authentication |
| `VIVD_INSTALL_PROFILE` | Install profile: leave unset for default `solo`, or set `platform` for the SaaS-style multi-org host-based mode |
| `PUBLIC_URL` | Your public-facing URL |
| `SCRAPER_URL` | Optional external scraper override; Docker Compose defaults to the internal `http://scraper:3001` service |

See `.env.example` for the full list.

## GitHub Sync (Optional)

vivd can automatically sync project versions to GitHub:

- On **Save** and **Publish**: pushes to GitHub (creates repo if missing)
- On **Preview open**: pulls/rebases from GitHub

Enable with:
```bash
GITHUB_SYNC_ENABLED=true
GITHUB_ORG=your-org
GITHUB_TOKEN=your-token
```

## License

vivd follows a fair-code, source-available licensing model.

The binding legal terms are the Business Source License 1.1 (BUSL-1.1) with a
Vivd-specific Additional Use Grant. This is not an OSI-approved open-source
license.

- Free without a separate commercial license: self-hosted `solo` deployments
  for your own organization and other single-tenant self-use covered by the
  Additional Use Grant.
- Separate commercial license required: `platform`, multi-tenant,
  shared-control-plane, hosted SaaS, agency/client-delivery, white-label, OEM,
  embedded, and other productized commercial uses outside that grant.
- Generated website output created with vivd is not itself the Licensed Work.

See [LICENSE](LICENSE) for the binding terms and
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for the plain-language summary.

---

<div align="center">

**[vivd.studio](https://vivd.studio)**

</div>
