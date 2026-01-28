# Multi-Tenant SaaS Refactoring Plan

## Executive Summary

This document provides a comprehensive, phased implementation plan for transforming Vivd Studio into a **dual-mode** platform:
1. **Self-Hosted Mode**: The current single-tenant deployment via docker-compose (for users who want to run their own instance)
2. **SaaS Mode**: A managed multi-tenant platform with central control plane, billing, and per-tenant isolation

**Key Principle**: The core studio application remains the same codebase. The SaaS layer is *additive* - it orchestrates and manages multiple instances of the same software.

---

## Architecture Overview

### Dual-Mode Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SELF-HOSTED MODE                                   │
│                    (docker-compose.self-hosted.yml)                          │
│                                                                              │
│   User runs their own instance - same as current production deployment       │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    VIVD STUDIO CONTAINER                             │   │
│   │                                                                      │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│   │   │   Frontend   │  │   Backend    │  │   Postgres   │              │   │
│   │   │   (React)    │  │   (tRPC)     │  │              │              │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘              │   │
│   │                                                                      │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│   │   │   OpenCode   │  │   Scraper    │  │    Caddy     │              │   │
│   │   │   Agent      │  │   Service    │  │   (publish)  │              │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘              │   │
│   │                                                                      │   │
│   │   - Auth: Local better-auth                                          │   │
│   │   - Limits: Environment variables (LICENSE_*)                        │   │
│   │   - Storage: Local Docker volumes                                    │   │
│   │   - Config: .env file                                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                              SAAS MODE                                       │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                 CONTROL PLANE (vivd.studio)                          │   │
│   │                 docker-compose.control-plane.yml                     │   │
│   │                                                                      │   │
│   │   ┌────────────────────────────────────────────────────────────┐    │   │
│   │   │  Control Plane Frontend (NEW)                               │    │   │
│   │   │  - Landing page / marketing                                 │    │   │
│   │   │  - Signup / login                                           │    │   │
│   │   │  - Organization dashboard                                   │    │   │
│   │   │  - Billing (Stripe)                                         │    │   │
│   │   │  - Team management                                          │    │   │
│   │   │  - Super-admin panel                                        │    │   │
│   │   └────────────────────────────────────────────────────────────┘    │   │
│   │                                                                      │   │
│   │   ┌────────────────────────────────────────────────────────────┐    │   │
│   │   │  Control Plane Backend (NEW)                                │    │   │
│   │   │  - Central authentication                                   │    │   │
│   │   │  - Organization management                                  │    │   │
│   │   │  - Fly.io machine orchestration                            │    │   │
│   │   │  - Global domain registry                                   │    │   │
│   │   │  - Usage aggregation & billing                              │    │   │
│   │   │  - Stripe webhooks                                          │    │   │
│   │   └────────────────────────────────────────────────────────────┘    │   │
│   │                                                                      │   │
│   │   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐       │   │
│   │   │   Postgres     │  │     Caddy      │  │  Cloudflare R2 │       │   │
│   │   │   (central)    │  │  (published    │  │   (backups &   │       │   │
│   │   │                │  │    sites)      │  │   published)   │       │   │
│   │   └────────────────┘  └────────────────┘  └────────────────┘       │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                        │                                     │
│                    Machine Routing / Orchestration                           │
│                                        │                                     │
│          ┌─────────────────────────────┼─────────────────────────────┐      │
│          │                             │                             │      │
│          ▼                             ▼                             ▼      │
│   ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   │  Tenant Machine │         │  Tenant Machine │         │  Tenant Machine │
│   │    (Org: A)     │         │    (Org: B)     │         │    (Org: C)     │
│   │   Fly.io        │         │   Fly.io        │         │   Fly.io        │
│   │                 │         │                 │         │                 │
│   │ ┌─────────────┐ │         │ ┌─────────────┐ │         │ ┌─────────────┐ │
│   │ │  Studio     │ │         │ │  Studio     │ │         │ │  Studio     │ │
│   │ │  Frontend   │ │         │ │  Frontend   │ │         │ │  Frontend   │ │
│   │ ├─────────────┤ │         │ ├─────────────┤ │         │ ├─────────────┤ │
│   │ │  Studio     │ │         │ │  Studio     │ │         │ │  Studio     │ │
│   │ │  Backend    │ │         │ │  Backend    │ │         │ │  Backend    │ │
│   │ ├─────────────┤ │         │ ├─────────────┤ │         │ ├─────────────┤ │
│   │ │  OpenCode   │ │         │ │  OpenCode   │ │         │ │  OpenCode   │ │
│   │ ├─────────────┤ │         │ ├─────────────┤ │         │ ├─────────────┤ │
│   │ │  /projects  │ │         │ │  /projects  │ │         │ │  /projects  │ │
│   │ │  (Volume)   │ │         │ │  (Volume)   │ │         │ │  (Volume)   │ │
│   │ └─────────────┘ │         │ └─────────────┘ │         │ └─────────────┘ │
│   │                 │         │                 │         │                 │
│   │  SAAS_MODE=true │         │  SAAS_MODE=true │         │  SAAS_MODE=true │
│   │  auto-suspend   │         │  auto-suspend   │         │  auto-suspend   │
│   └─────────────────┘         └─────────────────┘         └─────────────────┘
│                                                                              │
│   Each tenant runs the SAME Docker image as self-hosted!                    │
│   Just with SAAS_MODE=true and control plane integration                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Docker & Image Architecture

### Docker Compose Files

| File | Purpose | When to Use |
|------|---------|-------------|
| `docker-compose.yml` | Local development | `docker compose up` during dev |
| `docker-compose.override.yml` | Local dev overrides | Auto-loaded with above |
| `docker-compose.self-hosted.yml` | Self-hosted production | Users running their own instance |
| `docker-compose.control-plane.yml` | SaaS control plane | Our central vivd.studio deployment |

### Docker Images

| Image | Contents | Used By |
|-------|----------|---------|
| `vivd-studio` | Full studio app (frontend + backend + scraper) | Self-hosted AND tenant machines |
| `vivd-control-plane` | Control plane only (new frontend + backend) | SaaS control plane only |

```
┌─────────────────────────────────────────────────────────────────┐
│                         IMAGE STRATEGY                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ghcr.io/vivd-studio/vivd-studio:latest                         │
│  ├── Frontend (React - Studio Editor)                           │
│  ├── Backend (Express + tRPC)                                   │
│  ├── Scraper Service                                            │
│  └── OpenCode Integration                                       │
│                                                                  │
│  Mode Detection:                                                 │
│  ├── SAAS_MODE=false (default) → Self-hosted behavior           │
│  └── SAAS_MODE=true → Tenant behavior (control plane integration)│
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ghcr.io/vivd-studio/vivd-control-plane:latest (NEW)            │
│  ├── Control Plane Frontend (NEW - React)                       │
│  │   ├── Landing/Marketing pages                                │
│  │   ├── Auth (signup, login, verify)                           │
│  │   ├── Organization dashboard                                 │
│  │   ├── Billing management                                     │
│  │   ├── Team management                                        │
│  │   └── Super-admin panel                                      │
│  └── Control Plane Backend (NEW - Express + tRPC)               │
│      ├── Auth service                                           │
│      ├── Organization service                                   │
│      ├── Fly.io machine service                                 │
│      ├── Stripe billing service                                 │
│      ├── Domain registry service                                │
│      └── Usage aggregation service                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Frontend Architecture

### Current State
- Single React app serving the studio editor
- Talks directly to the backend

### Target State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PACKAGE STRUCTURE:                                                          │
│                                                                              │
│  packages/                                                                   │
│  ├── frontend/                    (EXISTING - Studio Editor)                │
│  │   ├── src/                                                               │
│  │   │   ├── components/          Project editor, preview, AI chat         │
│  │   │   ├── pages/               Editor pages                              │
│  │   │   ├── stores/              State management                          │
│  │   │   └── lib/                                                           │
│  │   │       ├── api.ts           → Modified: dual-mode API client         │
│  │   │       └── auth.ts          → Modified: control plane auth in SaaS   │
│  │   └── package.json                                                       │
│  │                                                                          │
│  ├── control-plane-frontend/      (NEW - Dashboard & Marketing)            │
│  │   ├── src/                                                               │
│  │   │   ├── components/                                                    │
│  │   │   │   ├── landing/         Marketing pages                          │
│  │   │   │   ├── auth/            Signup, login, verify email              │
│  │   │   │   ├── dashboard/       Org overview, quick actions              │
│  │   │   │   ├── billing/         Plans, subscription, invoices            │
│  │   │   │   ├── team/            Members, invitations, roles              │
│  │   │   │   ├── settings/        Org settings, GitHub, API keys           │
│  │   │   │   └── admin/           Super-admin panel                        │
│  │   │   ├── pages/                                                         │
│  │   │   │   ├── index.tsx        Landing page                              │
│  │   │   │   ├── pricing.tsx      Pricing page                              │
│  │   │   │   ├── login.tsx        Login                                     │
│  │   │   │   ├── signup.tsx       Signup                                    │
│  │   │   │   ├── dashboard/       Dashboard routes                          │
│  │   │   │   └── admin/           Admin routes                              │
│  │   │   └── lib/                                                           │
│  │   │       └── api.ts           Control plane API client                 │
│  │   └── package.json                                                       │
│  │                                                                          │
│  └── shared/                      (Shared types, utils)                    │
│      └── src/                                                               │
│          ├── types/                                                         │
│          └── utils/                                                         │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  USER FLOW (SAAS):                                                           │
│                                                                              │
│  1. User visits vivd.studio                                                  │
│     └── Control Plane Frontend (landing page)                               │
│                                                                              │
│  2. User signs up / logs in                                                  │
│     └── Control Plane Frontend (auth pages)                                 │
│                                                                              │
│  3. User sees dashboard                                                      │
│     └── Control Plane Frontend (org dashboard)                              │
│     └── Shows: org info, usage, projects list, team, billing                │
│                                                                              │
│  4. User clicks "Open Studio" or a project                                   │
│     └── Redirect to tenant machine URL                                      │
│     └── OR: Proxy through control plane (TBD)                               │
│                                                                              │
│  5. User is now in Studio                                                    │
│     └── Studio Frontend (on tenant machine)                                 │
│     └── Same UI as self-hosted, but with:                                   │
│         - "Back to Dashboard" button                                        │
│         - Org context in header                                             │
│         - Auth validated against control plane                              │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  URL STRUCTURE:                                                              │
│                                                                              │
│  vivd.studio/                     Landing page                              │
│  vivd.studio/pricing              Pricing                                   │
│  vivd.studio/login                Login                                     │
│  vivd.studio/signup               Signup                                    │
│  vivd.studio/dashboard            Org dashboard                             │
│  vivd.studio/dashboard/billing    Billing                                   │
│  vivd.studio/dashboard/team       Team management                           │
│  vivd.studio/dashboard/settings   Org settings                              │
│  vivd.studio/admin                Super-admin (internal)                    │
│                                                                              │
│  app.vivd.studio/                 Tenant proxy/redirect                     │
│  {org-slug}.vivd.studio/          Direct tenant access (optional)           │
│                                                                              │
│  OR via routing:                                                             │
│  vivd.studio/studio/{org-slug}    Studio (proxied to tenant machine)        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Mode Detection & Behavior

### Environment Variable

```bash
# Self-hosted mode (default)
SAAS_MODE=false

# SaaS tenant mode
SAAS_MODE=true
CONTROL_PLANE_URL=https://vivd.studio
CONTROL_PLANE_SECRET=xxx  # For machine-to-control-plane auth
TENANT_ID=org_xxx
```

### Behavioral Differences

| Aspect | Self-Hosted (SAAS_MODE=false) | SaaS Tenant (SAAS_MODE=true) |
|--------|-------------------------------|------------------------------|
| **Authentication** | Local better-auth, local DB | Validate tokens against control plane |
| **User Management** | Local users table | Users managed by control plane |
| **Limits** | `LICENSE_*` env vars | Fetched from control plane |
| **Domain Publishing** | Local Caddy config | Register with control plane |
| **GitHub Config** | `GITHUB_*` env vars | Org settings from control plane |
| **Usage Tracking** | Local only | Report to control plane |
| **Billing** | N/A | Managed by control plane |
| **Machine Lifecycle** | Always running | Auto-suspend after inactivity |
| **Project Storage** | Local Docker volume | Fly.io volume + R2 backup |

### Code Implementation

```typescript
// packages/shared/src/config/mode.ts
export const SAAS_MODE = process.env.SAAS_MODE === "true";
export const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL;
export const TENANT_ID = process.env.TENANT_ID;

// packages/backend/src/middleware/auth.ts
export async function authenticateRequest(req: Request) {
  const token = extractToken(req);

  if (SAAS_MODE) {
    // Validate against control plane
    const response = await fetch(`${CONTROL_PLANE_URL}/api/internal/validate-token`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CONTROL_PLANE_SECRET}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) throw new UnauthorizedError();

    const { user, organization } = await response.json();
    return { user, organization };
  } else {
    // Local better-auth (current behavior)
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) throw new UnauthorizedError();
    return { user: session.user, organization: null };
  }
}

// packages/backend/src/services/LimitsService.ts
export async function getLimits(orgId?: string) {
  if (SAAS_MODE && orgId) {
    // Fetch from control plane (cached)
    return await controlPlaneClient.getLimits(orgId);
  } else {
    // Use env vars (current behavior)
    return {
      dailyCredits: parseInt(process.env.LICENSE_DAILY_CREDIT_LIMIT || "1000"),
      weeklyCredits: parseInt(process.env.LICENSE_WEEKLY_CREDIT_LIMIT || "2500"),
      monthlyCredits: parseInt(process.env.LICENSE_MONTHLY_CREDIT_LIMIT || "5000"),
      imageGenLimit: parseInt(process.env.LICENSE_IMAGE_GEN_PER_MONTH || "25"),
    };
  }
}
```

---

## Project Transfer (Agency → Client)

### Use Case
You (agency) pre-generate websites in your tenant, then transfer to clients when they sign up.

### Phase 1: ZIP Export/Import (Simple, Immediate)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PROJECT TRANSFER (PHASE 1)                               │
│                         ZIP Export/Import                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  YOUR TENANT                              CLIENT'S TENANT                   │
│  (Agency)                                 (New signup)                      │
│                                                                              │
│  ┌─────────────────┐                     ┌─────────────────┐                │
│  │  Project: acme  │                     │                 │                │
│  │  ┌───────────┐  │   1. Download       │                 │                │
│  │  │  v1/      │  │      as ZIP         │                 │                │
│  │  │  v2/      │  │ ──────────────►     │                 │                │
│  │  │  manifest │  │                     │                 │                │
│  │  └───────────┘  │                     │                 │                │
│  └─────────────────┘                     │                 │                │
│                                          │                 │                │
│                         2. Client signs  │                 │                │
│                            up, gets      │                 │                │
│                            their tenant  │                 │                │
│                                          │                 │                │
│                         3. Upload ZIP    │  Project: acme  │                │
│                       ──────────────►    │  ┌───────────┐  │                │
│                                          │  │  v1/      │  │                │
│                                          │  │  manifest │  │                │
│                                          │  └───────────┘  │                │
│                                          └─────────────────┘                │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  REQUIRED WORK:                                                              │
│                                                                              │
│  1. Enhance ZIP Export (existing downloadAssets)                            │
│     - Include manifest.json                                                  │
│     - Include all versions (or selected versions)                           │
│     - Include .vivd/ metadata                                               │
│     - Option to include/exclude .git                                        │
│                                                                              │
│  2. Add ZIP Import (new feature)                                            │
│     - "Import Project" button in dashboard                                  │
│     - Upload ZIP file                                                       │
│     - Extract and create project structure                                  │
│     - Initialize git repos for versions                                     │
│     - Generate new project ID                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 2: Direct Transfer (Future)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PROJECT TRANSFER (PHASE 2)                               │
│                    Control Plane Orchestrated                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  AGENCY TENANT              CONTROL PLANE           CLIENT TENANT           │
│                                                                              │
│  ┌─────────────┐           ┌─────────────┐         ┌─────────────┐         │
│  │  Project:   │           │             │         │             │         │
│  │  acme       │           │             │         │             │         │
│  └──────┬──────┘           └──────┬──────┘         └──────┬──────┘         │
│         │                         │                       │                 │
│         │ 1. Request transfer     │                       │                 │
│         │ ───────────────────────►│                       │                 │
│         │    (targetOrgId, slug)  │                       │                 │
│         │                         │                       │                 │
│         │ 2. Export to R2         │                       │                 │
│         │◄────────────────────────│                       │                 │
│         │                         │                       │                 │
│         │ 3. Upload to R2         │                       │                 │
│         │ ───────────────────────►│                       │                 │
│         │    r2://transfers/xxx   │                       │                 │
│         │                         │                       │                 │
│         │                         │ 4. Import from R2     │                 │
│         │                         │ ─────────────────────►│                 │
│         │                         │                       │                 │
│         │                         │ 5. Download & extract │                 │
│         │                         │◄──────────────────────│                 │
│         │                         │                       │                 │
│         │                         │ 6. Confirm complete   │                 │
│         │                         │◄──────────────────────│                 │
│         │                         │                       │                 │
│         │ 7. Optionally delete    │                       │                 │
│         │    from source          │                       │                 │
│         │◄────────────────────────│                       │                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 3: Template Marketplace (Future)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TEMPLATE MARKETPLACE                                 │
│                           (Future Feature)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Agency publishes templates to marketplace:                                  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        TEMPLATE GALLERY                              │   │
│  │                                                                      │   │
│  │   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐        │   │
│  │   │          │   │          │   │          │   │          │        │   │
│  │   │  SaaS    │   │  Agency  │   │  E-comm  │   │Portfolio │        │   │
│  │   │ Landing  │   │  Site    │   │  Store   │   │  Site    │        │   │
│  │   │          │   │          │   │          │   │          │        │   │
│  │   └──────────┘   └──────────┘   └──────────┘   └──────────┘        │   │
│  │   By: Agency X   By: Agency X   By: Agency Y   By: You             │   │
│  │                                                                      │   │
│  │   [Use Template] [Use Template] [Use Template] [Use Template]       │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  When client clicks "Use Template":                                          │
│  1. Template cloned to their tenant                                          │
│  2. They can customize it                                                    │
│  3. Original stays with agency                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### New Tables (Control Plane)

```sql
-- Organizations (tenants)
CREATE TABLE organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,              -- For URLs: org-slug.vivd.studio
  owner_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'suspended', 'cancelled'

  -- Billing (Stripe)
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  subscription_tier TEXT DEFAULT 'free',  -- 'free', 'starter', 'pro', 'enterprise'
  subscription_status TEXT DEFAULT 'active',
  trial_ends_at TIMESTAMP,

  -- Fly.io Machine
  fly_machine_id TEXT,
  fly_machine_url TEXT,
  fly_volume_id TEXT,
  machine_status TEXT DEFAULT 'stopped',  -- 'running', 'stopped', 'starting', 'error'
  machine_region TEXT DEFAULT 'fra',

  -- Limits (overrides tier defaults if set)
  daily_credit_limit INTEGER,
  weekly_credit_limit INTEGER,
  monthly_credit_limit INTEGER,
  image_gen_limit INTEGER,
  max_projects INTEGER,
  max_team_members INTEGER,

  -- Settings (GitHub config, API keys, etc.)
  settings JSONB DEFAULT '{}',

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- Organization membership
CREATE TABLE organization_member (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',    -- 'owner', 'admin', 'member', 'viewer'
  invited_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  joined_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(organization_id, user_id)
);

-- Organization invitations
CREATE TABLE organization_invitation (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Global domain registry
CREATE TABLE domain (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,            -- Globally unique
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  project_slug TEXT,
  project_version INTEGER,

  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'dns_error'
  dns_verified_at TIMESTAMP,
  commit_hash TEXT,
  published_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- Subscription tiers (configuration)
CREATE TABLE subscription_tier (
  id TEXT PRIMARY KEY,                    -- 'free', 'starter', 'pro', 'enterprise'
  name TEXT NOT NULL,
  price_monthly INTEGER NOT NULL,         -- Cents
  price_yearly INTEGER,
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly TEXT,

  daily_credit_limit INTEGER NOT NULL,
  weekly_credit_limit INTEGER NOT NULL,
  monthly_credit_limit INTEGER NOT NULL,
  image_gen_limit INTEGER NOT NULL,
  max_projects INTEGER NOT NULL,
  max_team_members INTEGER NOT NULL,

  features JSONB DEFAULT '[]',

  created_at TIMESTAMP DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organization(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Updates to existing tables
ALTER TABLE "user" ADD COLUMN default_organization_id TEXT REFERENCES organization(id);
ALTER TABLE usage_record ADD COLUMN organization_id TEXT REFERENCES organization(id);
ALTER TABLE usage_period ADD COLUMN organization_id TEXT REFERENCES organization(id);
```

---

## Package Structure

```
vivd/
├── packages/
│   ├── shared/                          # Shared types, utils, schemas
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── organization.ts
│   │   │   │   ├── user.ts
│   │   │   │   ├── project.ts
│   │   │   │   └── index.ts
│   │   │   ├── schemas/                 # Zod schemas
│   │   │   ├── config/
│   │   │   │   ├── mode.ts              # SAAS_MODE detection
│   │   │   │   └── tiers.ts             # Subscription tier config
│   │   │   └── utils/
│   │   └── package.json
│   │
│   ├── backend/                         # Studio backend (existing, modified)
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── auth.ts                  # Modified for dual-mode
│   │   │   ├── routers/                 # Existing routers
│   │   │   ├── services/                # Modified for dual-mode
│   │   │   └── lib/
│   │   │       └── control-plane-client.ts  # NEW: talks to control plane
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── frontend/                        # Studio frontend (existing, minor changes)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── stores/
│   │   │   └── lib/
│   │   │       └── api.ts               # Modified for dual-mode
│   │   └── package.json
│   │
│   ├── control-plane-backend/           # NEW: Control plane backend
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── auth.ts                  # Central auth
│   │   │   ├── routers/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── organization.ts
│   │   │   │   ├── billing.ts
│   │   │   │   ├── machines.ts
│   │   │   │   ├── domains.ts
│   │   │   │   └── admin.ts
│   │   │   └── services/
│   │   │       ├── FlyMachineService.ts
│   │   │       ├── StripeService.ts
│   │   │       ├── DomainService.ts
│   │   │       └── EmailService.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── control-plane-frontend/          # NEW: Control plane frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── landing/
│   │   │   │   ├── auth/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── billing/
│   │   │   │   ├── team/
│   │   │   │   └── admin/
│   │   │   ├── pages/
│   │   │   └── lib/
│   │   └── package.json
│   │
│   └── scraper/                         # Scraper service (existing, unchanged)
│       └── ...
│
├── docker-compose.yml                   # Local development
├── docker-compose.override.yml          # Local dev overrides
├── docker-compose.self-hosted.yml       # Self-hosted production
├── docker-compose.control-plane.yml     # SaaS control plane
│
└── fly.toml                             # Fly.io config for tenant machines
```

---

## Implementation Phases

### Phase 1: Foundation & Dual-Mode Support
**Goal:** Enable the current codebase to run in both self-hosted and SaaS mode without breaking existing functionality.

- [ ] Create `packages/shared` with types and mode detection
- [ ] Add `SAAS_MODE` environment variable support
- [ ] Modify auth to support control plane token validation
- [ ] Modify limits service to fetch from control plane when in SaaS mode
- [ ] Create `docker-compose.self-hosted.yml`
- [ ] Test self-hosted mode works identically to current

### Phase 2: Database Schema & Organizations
**Goal:** Add organization model and multi-tenancy to the database.

- [ ] Create new tables (organization, organization_member, etc.)
- [ ] Add foreign keys to existing tables
- [ ] Create migration scripts
- [ ] Update Drizzle schema
- [ ] Seed subscription tiers

### Phase 3: Control Plane Backend
**Goal:** Build the central orchestration server.

- [ ] Create `packages/control-plane-backend`
- [ ] Implement central authentication
- [ ] Implement organization CRUD
- [ ] Implement Fly.io machine service
- [ ] Implement domain registry
- [ ] Implement internal APIs for tenant communication
- [ ] Create `docker-compose.control-plane.yml`

### Phase 4: Control Plane Frontend
**Goal:** Build the dashboard and marketing site.

- [ ] Create `packages/control-plane-frontend`
- [ ] Build landing/marketing pages
- [ ] Build auth flows (signup, login, verify)
- [ ] Build organization dashboard
- [ ] Build team management
- [ ] Build settings pages

### Phase 5: Fly.io Integration
**Goal:** Implement machine lifecycle management.

- [ ] Set up Fly.io app and volumes
- [ ] Implement machine provisioning
- [ ] Implement auto-suspend/resume
- [ ] Implement R2 backup/restore
- [ ] Test cold start latency
- [ ] Create tenant Docker image

### Phase 6: Billing (Stripe)
**Goal:** Add subscription management.

- [ ] Set up Stripe products and prices
- [ ] Implement StripeService
- [ ] Build billing UI
- [ ] Implement webhook handling
- [ ] Test subscription lifecycle

### Phase 7: Project Transfer
**Goal:** Enable moving projects between tenants.

- [ ] Enhance ZIP export (include manifest, versions)
- [ ] Implement ZIP import
- [ ] Build import UI
- [ ] Test full transfer flow

### Phase 8: Migration & Rollout
**Goal:** Safely migrate existing deployment.

- [ ] Write data migration scripts
- [ ] Plan rollback procedures
- [ ] Set up monitoring
- [ ] Staged rollout
- [ ] Customer communication

---

## Open Questions

1. **Studio Access URL Pattern:**
   - Option A: `vivd.studio/studio/{org-slug}` (proxied through control plane)
   - Option B: `{org-slug}.vivd.studio` (direct subdomain per tenant)
   - Option C: `app.vivd.studio` with org switcher
   - **Recommendation:** Start with Option A (simpler), add Option B later

2. **Where does Scraper run?**
   - Option A: Centralized (one instance for all)
   - Option B: Per-tenant (on each machine)
   - **Recommendation:** Centralized - it's stateless and rate-limitable

3. **Published sites serving:**
   - Option A: From R2 via control plane Caddy
   - Option B: From tenant machine directly
   - **Recommendation:** R2 via control plane - machines can sleep, sites stay up

4. **Self-hosted feature parity:**
   - Should self-hosted have ALL features?
   - Or keep some SaaS-exclusive (templates marketplace)?
   - **Recommendation:** Core features in both, marketplace SaaS-only

---

## Detailed Service Implementations

### Fly.io Machine Service

```typescript
// packages/control-plane-backend/src/services/FlyMachineService.ts

export class FlyMachineService {
  private flyToken: string;
  private appName = "vivd-tenants";

  async provisionMachine(organization: Organization): Promise<Machine> {
    // 1. Create persistent volume
    const volume = await this.createVolume(organization.id);

    // 2. Create machine
    const machine = await fetch(
      `https://api.machines.dev/v1/apps/${this.appName}/machines`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.flyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          config: {
            image: "registry.fly.io/vivd-studio:latest",
            guest: {
              cpu_kind: "shared",
              cpus: 1,
              memory_mb: 512,
            },

            env: {
              SAAS_MODE: "true",
              TENANT_ID: organization.id,
              CONTROL_PLANE_URL: process.env.CONTROL_PLANE_URL,
              CONTROL_PLANE_SECRET: this.generateMachineSecret(organization.id),
              R2_ENDPOINT: process.env.R2_ENDPOINT,
              R2_ACCESS_KEY: process.env.R2_ACCESS_KEY,
              R2_SECRET_KEY: process.env.R2_SECRET_KEY,
              R2_BUCKET: process.env.R2_BUCKET,
            },

            services: [
              {
                ports: [
                  { port: 443, handlers: ["tls", "http"] },
                  { port: 80, handlers: ["http"] },
                ],
                internal_port: 3000,
                protocol: "tcp",

                // Auto-suspend configuration
                autostop: "suspend",
                autostart: true,
                min_machines_running: 0,
              },
            ],

            mounts: [
              {
                volume: volume.id,
                path: "/projects",
              },
            ],

            // Health check
            checks: {
              httpget: {
                type: "http",
                port: 3000,
                path: "/health",
                interval: "30s",
                timeout: "5s",
              },
            },
          },

          region: organization.machineRegion || "fra",

          metadata: {
            organization_id: organization.id,
            organization_slug: organization.slug,
          },
        }),
      }
    );

    const machineData = await machine.json();

    // 3. Update organization with machine info
    await db.update(organizationTable)
      .set({
        flyMachineId: machineData.id,
        flyMachineUrl: `https://${machineData.id}.fly.dev`,
        flyVolumeId: volume.id,
        machineStatus: "running",
      })
      .where(eq(organizationTable.id, organization.id));

    // 4. Wait for machine to be ready
    await this.waitForMachine(machineData.id, "started");

    return machineData;
  }

  async createVolume(organizationId: string): Promise<Volume> {
    const response = await fetch(
      `https://api.machines.dev/v1/apps/${this.appName}/volumes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.flyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `vol-${organizationId.slice(0, 8)}`,
          size_gb: 10,
          region: "fra",
        }),
      }
    );
    return response.json();
  }

  async getMachineStatus(machineId: string): Promise<MachineStatus> {
    const response = await fetch(
      `https://api.machines.dev/v1/apps/${this.appName}/machines/${machineId}`,
      {
        headers: { Authorization: `Bearer ${this.flyToken}` },
      }
    );
    const data = await response.json();
    return data.state;
  }

  async wakeMachine(machineId: string): Promise<void> {
    await fetch(
      `https://api.machines.dev/v1/apps/${this.appName}/machines/${machineId}/start`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.flyToken}` },
      }
    );
    await this.waitForMachine(machineId, "started");
  }

  async destroyMachine(organizationId: string): Promise<void> {
    const org = await db.query.organization.findFirst({
      where: eq(organizationTable.id, organizationId),
    });

    if (!org?.flyMachineId) return;

    // Destroy machine
    await fetch(
      `https://api.machines.dev/v1/apps/${this.appName}/machines/${org.flyMachineId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.flyToken}` },
      }
    );

    // Keep volume for data recovery (delete manually if needed)

    await db.update(organizationTable)
      .set({
        flyMachineId: null,
        flyMachineUrl: null,
        machineStatus: "destroyed",
      })
      .where(eq(organizationTable.id, organizationId));
  }

  private async waitForMachine(
    machineId: string,
    targetState: string,
    timeoutMs = 60000
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.getMachineStatus(machineId);
      if (status === targetState) return;
      await sleep(1000);
    }
    throw new Error(`Machine ${machineId} did not reach state ${targetState}`);
  }

  private generateMachineSecret(orgId: string): string {
    return createHmac("sha256", process.env.MASTER_SECRET!)
      .update(orgId)
      .digest("hex");
  }
}
```

### R2 Sync Service (on Tenant Machine)

```typescript
// packages/backend/src/services/SyncService.ts

export class SyncService {
  private r2Client: S3Client;
  private tenantId: string;
  private syncInterval: NodeJS.Timer | null = null;

  constructor() {
    this.tenantId = process.env.TENANT_ID!;
    this.r2Client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY!,
        secretAccessKey: process.env.R2_SECRET_KEY!,
      },
    });
  }

  async initialize(): Promise<void> {
    // Check if local volume has data
    const hasLocalData = await this.hasLocalData();

    if (!hasLocalData) {
      // First boot or volume recreated - restore from R2
      await this.restoreFromR2();
    }

    // Start periodic sync
    this.startPeriodicSync();

    // Sync on shutdown
    this.registerShutdownHook();
  }

  private async hasLocalData(): Promise<boolean> {
    try {
      await fs.access("/projects/.initialized");
      return true;
    } catch {
      return false;
    }
  }

  async restoreFromR2(): Promise<void> {
    console.log(`Restoring projects from R2 for tenant ${this.tenantId}`);

    const objects = await this.r2Client.send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET,
        Prefix: `tenants/${this.tenantId}/projects/`,
      })
    );

    for (const obj of objects.Contents || []) {
      const localPath = obj.Key!.replace(
        `tenants/${this.tenantId}/`,
        "/"
      );

      const data = await this.r2Client.send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: obj.Key,
        })
      );

      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, await data.Body!.transformToByteArray());
    }

    await fs.writeFile("/projects/.initialized", new Date().toISOString());
    console.log("Restore complete");
  }

  async syncToR2(): Promise<void> {
    console.log(`Syncing projects to R2 for tenant ${this.tenantId}`);

    const files = await glob("/projects/**/*", {
      nodir: true,
      ignore: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
      ],
    });

    for (const file of files) {
      const r2Key = `tenants/${this.tenantId}${file}`;
      const content = await fs.readFile(file);

      await this.r2Client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: r2Key,
          Body: content,
        })
      );
    }

    console.log(`Synced ${files.length} files to R2`);
  }

  private startPeriodicSync(): void {
    // Sync every 5 minutes
    this.syncInterval = setInterval(
      () => this.syncToR2().catch(console.error),
      5 * 60 * 1000
    );
  }

  private registerShutdownHook(): void {
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}, syncing before shutdown...`);
      await this.syncToR2();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}
```

### Stripe Billing Service

```typescript
// packages/control-plane-backend/src/services/StripeService.ts

import Stripe from "stripe";

export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2023-10-16",
    });
  }

  async createCustomer(org: Organization, user: User): Promise<string> {
    const customer = await this.stripe.customers.create({
      email: user.email,
      name: org.name,
      metadata: {
        organization_id: org.id,
        organization_slug: org.slug,
      },
    });

    await db.update(organizationTable)
      .set({ stripeCustomerId: customer.id })
      .where(eq(organizationTable.id, org.id));

    return customer.id;
  }

  async createCheckoutSession(
    orgId: string,
    tierId: string,
    billingPeriod: "monthly" | "yearly"
  ): Promise<string> {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, orgId),
      with: { owner: true },
    });

    if (!org) throw new Error("Organization not found");

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      customerId = await this.createCustomer(org, org.owner!);
    }

    const tier = SUBSCRIPTION_TIERS[tierId];
    const priceId = billingPeriod === "yearly"
      ? tier.stripePriceIdYearly
      : tier.stripePriceIdMonthly;

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/dashboard/billing?success=true`,
      cancel_url: `${process.env.APP_URL}/dashboard/billing?canceled=true`,
      metadata: {
        organization_id: orgId,
        tier_id: tierId,
      },
      subscription_data: {
        metadata: {
          organization_id: orgId,
          tier_id: tierId,
        },
      },
    });

    return session.url!;
  }

  async createPortalSession(orgId: string): Promise<string> {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, orgId),
    });

    if (!org?.stripeCustomerId) {
      throw new Error("No Stripe customer found");
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${process.env.APP_URL}/dashboard/billing`,
    });

    return session.url;
  }

  async handleWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await this.handleCheckoutComplete(session);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionUpdate(subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionCanceled(subscription);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await this.handlePaymentFailed(invoice);
        break;
      }
    }
  }

  private async handleCheckoutComplete(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    const orgId = session.metadata?.organization_id;
    const tierId = session.metadata?.tier_id;

    if (!orgId || !tierId) return;

    await db.update(organizationTable)
      .set({
        subscriptionTier: tierId,
        subscriptionStatus: "active",
        stripeSubscriptionId: session.subscription as string,
        trialEndsAt: null,
      })
      .where(eq(organizationTable.id, orgId));

    await auditLog.create({
      organizationId: orgId,
      action: "subscription.created",
      metadata: { tierId, subscriptionId: session.subscription },
    });
  }

  private async handleSubscriptionCanceled(
    subscription: Stripe.Subscription
  ): Promise<void> {
    const orgId = subscription.metadata?.organization_id;
    if (!orgId) return;

    await db.update(organizationTable)
      .set({
        subscriptionTier: "free",
        subscriptionStatus: "canceled",
        stripeSubscriptionId: null,
        updatedAt: new Date(),
      })
      .where(eq(organizationTable.id, orgId));
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string;

    const org = await db.query.organization.findFirst({
      where: eq(organization.stripeCustomerId, customerId),
    });

    if (!org) return;

    await emailService.sendPaymentFailedEmail(org);

    await auditLog.create({
      organizationId: org.id,
      action: "payment.failed",
      metadata: { invoiceId: invoice.id },
    });
  }
}
```

### Domain Service

```typescript
// packages/control-plane-backend/src/services/DomainService.ts

export class DomainService {
  async registerDomain(
    orgId: string,
    domain: string,
    projectSlug: string,
    version: number
  ): Promise<Domain> {
    // 1. Normalize domain
    const normalized = this.normalizeDomain(domain);

    // 2. Validate format
    if (!this.isValidDomain(normalized)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid domain format",
      });
    }

    // 3. Check reserved domains
    if (this.isReservedDomain(normalized)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This domain is reserved",
      });
    }

    // 4. Check availability (globally unique across all tenants)
    const existing = await db.query.domain.findFirst({
      where: eq(domainTable.domain, normalized),
    });

    if (existing && existing.organizationId !== orgId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Domain is already registered by another organization",
      });
    }

    // 5. Register or update
    const domainRecord = await db
      .insert(domainTable)
      .values({
        id: generateId(),
        domain: normalized,
        organizationId: orgId,
        projectSlug,
        projectVersion: version,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: domainTable.domain,
        set: {
          projectSlug,
          projectVersion: version,
          status: "pending",
          updatedAt: new Date(),
        },
      })
      .returning();

    // 6. Start DNS verification (async)
    this.verifyDns(domainRecord[0].id).catch(console.error);

    return domainRecord[0];
  }

  async verifyDns(domainId: string): Promise<boolean> {
    const domain = await db.query.domain.findFirst({
      where: eq(domainTable.id, domainId),
    });

    if (!domain) return false;

    try {
      const records = await dns.resolve(domain.domain, "A");
      const cnameRecords = await dns.resolve(domain.domain, "CNAME").catch(() => []);

      const validIp = records.includes(process.env.VIVD_IP!);
      const validCname = cnameRecords.includes("sites.vivd.studio");

      if (validIp || validCname) {
        await db.update(domainTable)
          .set({
            status: "active",
            dnsVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(domainTable.id, domainId));

        await this.updateCaddyConfig(domain);
        return true;
      }
    } catch (error) {
      await db.update(domainTable)
        .set({
          status: "dns_error",
          updatedAt: new Date(),
        })
        .where(eq(domainTable.id, domainId));
    }

    return false;
  }

  async updateCaddyConfig(domain: Domain): Promise<void> {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, domain.organizationId),
    });

    if (!org) return;

    // Caddy config pointing to R2 or local published files
    const caddyConfig = `
${domain.domain} {
  root * /srv/published/${org.id}/${domain.projectSlug}/v${domain.projectVersion}/dist
  file_server

  header {
    X-Organization-Id "${org.id}"
    X-Project-Slug "${domain.projectSlug}"
  }

  handle_errors {
    rewrite * /404.html
    file_server
  }
}
`;

    const configPath = path.join(
      process.env.CADDY_SITES_DIR!,
      `${domain.domain}.conf`
    );
    await fs.writeFile(configPath, caddyConfig);

    // Reload Caddy
    await fetch(`${process.env.CADDY_ADMIN_URL}/load`, {
      method: "POST",
    });

    await db.update(domainTable)
      .set({ caddyConfigSyncedAt: new Date() })
      .where(eq(domainTable.id, domain.id));
  }

  private normalizeDomain(domain: string): string {
    return domain
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .replace(/:.*$/, "");
  }

  private isValidDomain(domain: string): boolean {
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;
    return domainRegex.test(domain);
  }

  private isReservedDomain(domain: string): boolean {
    const reserved = [
      "vivd.studio",
      "vivd.io",
      "vivdstudio.com",
      "localhost",
      "example.com",
    ];
    return reserved.some((r) => domain === r || domain.endsWith(`.${r}`));
  }
}
```

---

## Control Plane ↔ Tenant Communication

### Communication Protocol

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CONTROL PLANE ↔ TENANT COMMUNICATION                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  TENANT → CONTROL PLANE:                                                    │
│                                                                              │
│  1. Token Validation (on every request)                                      │
│     POST /api/internal/validate-token                                       │
│     Authorization: Bearer {MACHINE_SECRET}                                   │
│     Body: { token: "user_session_token" }                                   │
│     Response: { valid: true, user: {...}, organization: {...} }             │
│                                                                              │
│  2. Usage Reporting (batched, async)                                         │
│     POST /api/internal/usage                                                │
│     Authorization: Bearer {MACHINE_SECRET}                                   │
│     Body: {                                                                  │
│       organizationId: "org_xxx",                                            │
│       records: [                                                             │
│         { eventType: "ai_cost", cost: 0.05, tokens: {...} },                │
│         { eventType: "image_gen", cost: 0.01 }                              │
│       ]                                                                      │
│     }                                                                        │
│                                                                              │
│  3. Domain Publish Notification                                              │
│     POST /api/internal/domains/publish                                       │
│     Authorization: Bearer {MACHINE_SECRET}                                   │
│     Body: {                                                                  │
│       organizationId: "org_xxx",                                            │
│       domain: "example.com",                                                │
│       projectSlug: "my-site",                                               │
│       version: 1,                                                           │
│       commitHash: "abc123"                                                  │
│     }                                                                        │
│                                                                              │
│  4. Heartbeat (every 30s while active)                                       │
│     POST /api/internal/heartbeat                                            │
│     Authorization: Bearer {MACHINE_SECRET}                                   │
│     Body: {                                                                  │
│       machineId: "machine_xxx",                                             │
│       status: "active",                                                     │
│       activeProjects: 2,                                                    │
│       lastActivity: "2026-01-28T12:00:00Z"                                  │
│     }                                                                        │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CONTROL PLANE → TENANT:                                                    │
│                                                                              │
│  1. Configuration Push (when settings change)                                │
│     POST /api/internal/config                                               │
│     Authorization: Bearer {CONTROL_PLANE_SECRET}                             │
│     Body: {                                                                  │
│       organizationId: "org_xxx",                                            │
│       settings: {                                                           │
│         github: { org: "...", token: "..." },                               │
│         limits: { daily: 1000, weekly: 2500 }                               │
│       }                                                                      │
│     }                                                                        │
│                                                                              │
│  2. Shutdown Signal                                                          │
│     POST /api/internal/shutdown                                             │
│     Authorization: Bearer {CONTROL_PLANE_SECRET}                             │
│     Body: {                                                                  │
│       reason: "billing" | "maintenance" | "violation",                      │
│       gracePeriodSeconds: 30                                                │
│     }                                                                        │
│                                                                              │
│  3. Get Limits                                                               │
│     GET /api/internal/limits/{orgId}                                        │
│     Response: { daily: 1000, weekly: 2500, monthly: 5000, ... }             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Auth Token Flow

```
┌─────────┐       ┌───────────────┐       ┌─────────────┐
│ Browser │       │ Control Plane │       │   Tenant    │
│         │       │               │       │   Machine   │
└────┬────┘       └───────┬───────┘       └──────┬──────┘
     │                    │                      │
     │ 1. Login           │                      │
     │───────────────────>│                      │
     │                    │                      │
     │ 2. Session token   │                      │
     │<───────────────────│                      │
     │   + Machine URL    │                      │
     │                    │                      │
     │ 3. API Request to machine                 │
     │   (with session token in header)          │
     │──────────────────────────────────────────>│
     │                    │                      │
     │                    │ 4. Validate token    │
     │                    │<─────────────────────│
     │                    │                      │
     │                    │ 5. User + org data   │
     │                    │─────────────────────>│
     │                    │                      │
     │ 6. API Response    │                      │
     │<──────────────────────────────────────────│
     │                    │                      │
```

---

## Subscription Tiers Configuration

```typescript
// packages/shared/src/config/subscription-tiers.ts

export const SUBSCRIPTION_TIERS = {
  free: {
    id: "free",
    name: "Free",
    price: { monthly: 0, yearly: 0 },
    limits: {
      dailyCredits: 100,        // $1/day
      weeklyCredits: 500,       // $5/week
      monthlyCredits: 1000,     // $10/month
      imageGenerations: 5,
      maxProjects: 3,
      maxTeamMembers: 1,
      maxStorageGb: 1,
    },
    features: ["basic_generation", "preview", "1_domain"],
  },

  starter: {
    id: "starter",
    name: "Starter",
    price: { monthly: 2900, yearly: 29000 }, // $29/mo
    stripePriceIdMonthly: "price_starter_monthly",
    stripePriceIdYearly: "price_starter_yearly",
    limits: {
      dailyCredits: 500,
      weeklyCredits: 2000,
      monthlyCredits: 5000,
      imageGenerations: 25,
      maxProjects: 10,
      maxTeamMembers: 3,
      maxStorageGb: 5,
    },
    features: ["basic_generation", "preview", "5_domains", "github_sync"],
  },

  pro: {
    id: "pro",
    name: "Pro",
    price: { monthly: 7900, yearly: 79000 }, // $79/mo
    stripePriceIdMonthly: "price_pro_monthly",
    stripePriceIdYearly: "price_pro_yearly",
    limits: {
      dailyCredits: 2000,
      weeklyCredits: 8000,
      monthlyCredits: 20000,
      imageGenerations: 100,
      maxProjects: 50,
      maxTeamMembers: 10,
      maxStorageGb: 20,
    },
    features: [
      "basic_generation",
      "advanced_generation",
      "preview",
      "unlimited_domains",
      "github_sync",
      "custom_api_keys",
      "priority_support",
    ],
  },

  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    price: { monthly: null, yearly: null }, // Custom
    limits: {
      dailyCredits: null,       // Unlimited
      weeklyCredits: null,
      monthlyCredits: null,
      imageGenerations: null,
      maxProjects: null,
      maxTeamMembers: null,
      maxStorageGb: null,
    },
    features: [
      "all_features",
      "dedicated_support",
      "sla",
      "custom_integrations",
      "sso",
    ],
  },
};
```

---

## Organization Roles & Permissions

```typescript
// packages/shared/src/config/permissions.ts

export const OrganizationRoles = {
  OWNER: "owner",      // Full control, billing, can delete org
  ADMIN: "admin",      // Manage members, projects, settings
  MEMBER: "member",    // Create/edit projects
  VIEWER: "viewer",    // Read-only access
} as const;

export const PermissionMatrix = {
  // Organization-level actions
  "org.settings.view": ["owner", "admin"],
  "org.settings.edit": ["owner", "admin"],
  "org.members.view": ["owner", "admin", "member"],
  "org.members.invite": ["owner", "admin"],
  "org.members.remove": ["owner", "admin"],
  "org.billing.view": ["owner"],
  "org.billing.manage": ["owner"],
  "org.delete": ["owner"],

  // Project-level actions
  "project.create": ["owner", "admin", "member"],
  "project.view": ["owner", "admin", "member", "viewer"],
  "project.edit": ["owner", "admin", "member"],
  "project.delete": ["owner", "admin"],
  "project.publish": ["owner", "admin", "member"],
  "project.settings": ["owner", "admin"],

  // AI/Agent actions
  "agent.run": ["owner", "admin", "member"],
  "agent.history": ["owner", "admin", "member", "viewer"],
};

export function hasPermission(
  userRole: string,
  action: keyof typeof PermissionMatrix
): boolean {
  return PermissionMatrix[action]?.includes(userRole) ?? false;
}
```

---

## User Registration Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REGISTRATION FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. User lands on vivd.studio                                                │
│     └── Landing page with "Get Started Free" CTA                            │
│                                                                              │
│  2. Clicks "Get Started Free"                                                │
│     └── Redirect to /signup                                                 │
│                                                                              │
│  3. Sign up form                                                             │
│     ┌─────────────────────────────────┐                                     │
│     │ Create your account             │                                     │
│     │                                 │                                     │
│     │ Name:     [________________]    │                                     │
│     │ Email:    [________________]    │                                     │
│     │ Password: [________________]    │                                     │
│     │                                 │                                     │
│     │ [Create Account]                │                                     │
│     └─────────────────────────────────┘                                     │
│                                                                              │
│  4. Email verification sent                                                  │
│     └── "Check your email to verify your account"                           │
│                                                                              │
│  5. User clicks verification link                                            │
│     └── Email verified, redirect to organization creation                   │
│                                                                              │
│  6. Organization creation                                                    │
│     ┌─────────────────────────────────┐                                     │
│     │ Create your workspace           │                                     │
│     │                                 │                                     │
│     │ Workspace name:                 │                                     │
│     │ [My Company________________]    │                                     │
│     │                                 │                                     │
│     │ Workspace URL:                  │                                     │
│     │ [my-company].vivd.studio        │                                     │
│     │                                 │                                     │
│     │ [Create Workspace]              │                                     │
│     └─────────────────────────────────┘                                     │
│                                                                              │
│  7. Machine provisioning (background)                                        │
│     ┌─────────────────────────────────┐                                     │
│     │ Setting up your workspace...    │                                     │
│     │                                 │                                     │
│     │    [████████░░░░░░░░] 60%       │                                     │
│     │                                 │                                     │
│     │ Creating secure environment     │                                     │
│     └─────────────────────────────────┘                                     │
│     - Create Fly.io volume                                                  │
│     - Start Fly.io machine                                                  │
│     - Wait for health check                                                 │
│                                                                              │
│  8. Onboarding wizard                                                        │
│     ┌─────────────────────────────────┐                                     │
│     │ Welcome to Vivd Studio!         │                                     │
│     │                                 │                                     │
│     │ How would you like to start?    │                                     │
│     │                                 │                                     │
│     │ [🔗 Clone existing website]     │                                     │
│     │ [✨ Start from scratch]         │                                     │
│     │ [📁 Import project]             │                                     │
│     └─────────────────────────────────┘                                     │
│                                                                              │
│  9. First project creation                                                   │
│     └── User creates or imports their first project                         │
│                                                                              │
│  10. Dashboard                                                               │
│      └── Full access to studio                                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Default Permissions for New Users

| Event | What Happens |
|-------|--------------|
| **Signup** | User created, email unverified, no org |
| **Email verified** | Can create 1 organization |
| **Org created** | User becomes owner, machine provisioned |
| **Free tier** | 3 projects, $10/month AI, 5 images, 1 member |
| **Trial (14 days)** | Pro tier limits (if enabled) |
| **Trial expired** | Falls back to free tier |
| **Paid subscription** | Tier-based limits |

---

## Settings Migration (Env Vars → Database)

### Current Env Vars → New Location

| Current Env Var | New Location | Scope |
|-----------------|--------------|-------|
| `GITHUB_ORG` | `organization.settings.github.org` | Per-org |
| `GITHUB_TOKEN` | `organization.settings.github.token` | Per-org, encrypted |
| `GITHUB_REPO_PREFIX` | `organization.settings.github.repoPrefix` | Per-org |
| `GITHUB_REPO_VISIBILITY` | `organization.settings.github.repoVisibility` | Per-org |
| `OPENROUTER_API_KEY` | Platform default + `organization.settings.ai.apiKey` | Per-org (Pro+) |
| `OPENCODE_MODEL` | `organization.settings.ai.preferredModel` | Per-org |
| `LICENSE_DAILY_CREDIT_LIMIT` | `organization.daily_credit_limit` | Per-org |
| `LICENSE_WEEKLY_CREDIT_LIMIT` | `organization.weekly_credit_limit` | Per-org |
| `LICENSE_MONTHLY_CREDIT_LIMIT` | `organization.monthly_credit_limit` | Per-org |
| `LICENSE_IMAGE_GEN_PER_MONTH` | `organization.image_gen_limit` | Per-org |
| `SINGLE_PROJECT_MODE` | `organization.max_projects = 1` | Per-org |
| `DOMAIN` | Control plane config | Platform-wide |
| `DATABASE_URL` | Control plane config | Platform-wide |
| `CADDY_*` | Control plane config | Platform-wide |

### Organization Settings Schema

```typescript
// packages/shared/src/types/settings.ts

export interface OrganizationSettings {
  // GitHub Integration
  github?: {
    enabled: boolean;
    org: string;
    token: string;           // Encrypted
    repoVisibility: "private" | "public";
    repoPrefix?: string;
  };

  // AI Configuration (Pro+ feature)
  ai?: {
    openrouterApiKey?: string; // Own API key, encrypted
    preferredModel?: string;
  };

  // Branding
  branding?: {
    primaryColor?: string;
    logoUrl?: string;
  };

  // Notifications
  notifications?: {
    emailOnPublish: boolean;
    emailOnLimitWarning: boolean;
    slackWebhook?: string;
  };
}
```

---

## Publishing Flow (Updated for Multi-Tenant)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PUBLISHING FLOW (SaaS)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. User clicks "Publish" in Studio                                          │
│     ↓                                                                        │
│  2. TENANT MACHINE builds project                                            │
│     - Run `astro build` (or static copy)                                    │
│     - Generate thumbnail                                                    │
│     - Git commit                                                            │
│     ↓                                                                        │
│  3. TENANT MACHINE uploads build to R2                                       │
│     r2://vivd-published/{orgId}/{projectSlug}/v{version}/                   │
│     ↓                                                                        │
│  4. TENANT MACHINE notifies CONTROL PLANE                                    │
│     POST /api/internal/domains/publish                                       │
│     { orgId, projectSlug, version, domain, commitHash }                     │
│     ↓                                                                        │
│  5. CONTROL PLANE registers domain                                           │
│     - Check global uniqueness                                               │
│     - Create/update domain record                                           │
│     - Start DNS verification (async)                                        │
│     ↓                                                                        │
│  6. CONTROL PLANE updates Caddy                                              │
│     - Write site config                                                     │
│     - Reload Caddy                                                          │
│     - Point to R2 content                                                   │
│     ↓                                                                        │
│  7. Site is live at https://custom-domain.com                                │
│     - Auto HTTPS via Caddy                                                  │
│     - Served from R2 (machines can sleep!)                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cost Calculations

### Fly.io Machines

| Resource | Price | Notes |
|----------|-------|-------|
| shared-cpu-1x (512MB) | ~$0.0000030/s | ~$7.80/month if 24/7 |
| With auto-suspend | ~$1-3/month | 2-4 hours/day usage |
| Fly Volume (10GB) | $1.50/month | Per tenant |

### Cloudflare R2

| Resource | Price |
|----------|-------|
| Storage | $0.015/GB/month |
| Class A Operations | $4.50/million |
| Class B Operations | $0.36/million |
| Egress | **Free** |

### Example: 100 Tenants

| Item | Cost/Month |
|------|------------|
| Control Plane Server | ~$50 |
| 100 Tenant Machines (3h/day avg) | ~$200-300 |
| 100 Fly Volumes (10GB each) | $150 |
| R2 Storage (1TB total) | $15 |
| R2 Operations | ~$10 |
| **Total** | **~$425-525** |

**Per Tenant Cost:** ~$4-5/month infrastructure

### Break-even Analysis

| Tier | Price | Infrastructure Cost | Margin |
|------|-------|---------------------|--------|
| Free | $0 | $4-5 | -$4-5 (subsidized) |
| Starter ($29) | $29 | $5 | $24 (83%) |
| Pro ($79) | $79 | $8 | $71 (90%) |

---

## Extended Open Questions

### Architecture

1. **Studio Access URL Pattern:**
   - Option A: `vivd.studio/studio/{org-slug}` (proxied)
   - Option B: `{org-slug}.vivd.studio` (subdomain)
   - Option C: `app.vivd.studio` with org switcher
   - **Recommendation:** Start with A, add B later

2. **Scraper Location:**
   - Option A: Centralized (shared)
   - Option B: Per-tenant
   - **Recommendation:** Centralized - stateless, rate-limitable

3. **Published Sites Hosting:**
   - Option A: R2 via control plane Caddy
   - Option B: From tenant machine
   - **Recommendation:** R2 - machines can sleep, sites stay up

4. **Self-hosted Feature Parity:**
   - Core features in both
   - Marketplace SaaS-only
   - SSO Enterprise-only

### Business

5. **Free Tier Limits:**
   - How generous? Affects conversion vs. costs
   - Current proposal: 3 projects, $10/month AI, 5 images

6. **Trial Period:**
   - Duration: 14 days Pro features?
   - Credit card required upfront?
   - **Recommendation:** 14 days, no CC required

7. **Enterprise Tier:**
   - On-premise option?
   - Custom SLA?
   - Dedicated support channel?

### Technical

8. **Cold Start Mitigation:**
   - Accept 300ms cold start?
   - Pre-warm on login?
   - Keep 1 machine always running per region?
   - **Recommendation:** Pre-warm on login, accept cold starts otherwise

9. **Multi-Region Support:**
   - Single region initially (fra)?
   - Allow org to choose region?
   - **Recommendation:** Single region initially, add later

10. **Backup Frequency:**
    - How often to sync to R2?
    - How many backup versions?
    - **Recommendation:** Every 5 minutes + on shutdown, 7 daily backups

---

## Migration Strategy

### Phases

```
Phase A: Parallel Infrastructure (Week 1-2)
├── Deploy control plane alongside existing
├── Set up Fly.io app
├── Configure R2 buckets
├── Run both systems in parallel
└── No user-facing changes

Phase B: Database Migration (Week 3)
├── Run schema migration
├── Create "legacy" organization for existing data
├── Migrate existing users as org members
├── Migrate publishedSite → domain table
├── Update usage records with org_id
└── Verify data integrity

Phase C: Feature Flags (Week 4)
├── Add feature flags for new functionality
├── Enable multi-tenant for internal testing
├── Shadow traffic to new infrastructure
├── Monitor for issues
└── Gradual rollout to beta users

Phase D: Cutover (Week 5)
├── Announce maintenance window
├── Migrate remaining data
├── Switch DNS
├── Monitor closely
└── Keep old system as fallback

Phase E: Cleanup (Week 6+)
├── Remove legacy code paths
├── Decommission old infrastructure
├── Remove feature flags
└── Full multi-tenant operation
```

### Rollback Plan

```typescript
async function rollbackMultiTenant() {
  // 1. Revert DNS to old infrastructure

  // 2. Disable multi-tenant via feature flag
  await setFeatureFlag("multi_tenant_enabled", false);

  // 3. Stop Fly.io machines (keep volumes)
  const orgs = await db.query.organization.findMany();
  for (const org of orgs) {
    if (org.flyMachineId) {
      await flyMachineService.stopMachine(org.flyMachineId);
    }
  }

  // 4. Restore old config
  // 5. Re-enable old code paths

  console.log("Rollback complete - running in legacy mode");
}
```

---

## Critical Path

```
Phase 1 (Foundation)
    ↓
Phase 2 (Database/Orgs)
    ↓
Phase 3 (Control Plane Backend) ──────┐
    ↓                                 │
Phase 4 (Control Plane Frontend)      │
    ↓                                 │
Phase 5 (Fly.io) ◄────────────────────┘
    ↓
Phase 6 (Billing) + Phase 7 (Transfer) [parallel]
    ↓
Phase 8 (Migration & Rollout)
```

---

## Next Steps

1. **Review and approve this plan** with stakeholders
2. **Decide on open questions** (especially URL pattern, trial, free tier limits)
3. **Set up development environment** for multi-tenant testing
4. **Begin Phase 1** - Foundation & dual-mode support
5. **Create detailed tickets** for each phase

---

## Summary

This refactor enables Vivd Studio to operate in two modes:

1. **Self-Hosted**: Users run their own instance with docker-compose, same as today. They manage their own servers, domains, and configuration.

2. **SaaS**: We run a central control plane that manages user signups, billing, and provisions isolated tenant machines on Fly.io. Each tenant gets the same software, but managed for them.

The key insight is that the **core product stays the same** - we're adding an orchestration layer around it, not rewriting it.

---

*Document Version: 1.1*
*Last Updated: 2026-01-28*
*Author: Claude (AI Assistant)*
