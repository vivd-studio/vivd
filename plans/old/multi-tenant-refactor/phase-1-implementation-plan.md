# Phase 1: Multi-Tenant SaaS Foundation

## Overview

Phase 1 establishes dual-mode operation for Vivd Studio:
- **Self-hosted mode** (default): Current behavior unchanged - local Better Auth, env-based limits
- **SaaS mode**: Token validation and limits fetched from control plane

Key principle: SaaS behavior is *additive* - the core product remains unchanged.

---

## Directory Structure

```
vivd/
├── packages/
│   └── shared/                    # NEW: Shared types & mode detection
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── config/
│           │   ├── index.ts
│           │   └── mode.ts        # SAAS_MODE detection
│           └── types/
│               ├── index.ts
│               ├── auth.ts        # Shared auth types
│               └── limits.ts      # Shared limits types
│
├── plans/
│   └── multi-tenant-refactor/     # Implementation artifacts
│       ├── multi-tenant-saas-refactor-plan.md  (main plan)
│       └── phase-1-implementation-plan.md      (this file)
│
├── backend/
│   └── src/
│       └── lib/
│           ├── authProvider.ts           # NEW: Auth provider abstraction
│           ├── localAuthProvider.ts      # NEW: Better Auth wrapper
│           └── controlPlaneClient.ts     # NEW: Control plane API client (stub)
│
└── docker-compose.self-hosted.yml        # NEW: Self-hosted production config
```

---

## Implementation Tasks

### 1. Create `packages/shared`

**Files to create:**

| File | Purpose |
|------|---------|
| `packages/shared/package.json` | Package config with tsup build |
| `packages/shared/tsconfig.json` | TypeScript config |
| `packages/shared/src/index.ts` | Main exports |
| `packages/shared/src/config/mode.ts` | `isSaasMode()`, `getControlPlaneUrl()`, etc. |
| `packages/shared/src/types/auth.ts` | `AuthSession`, `AuthUser`, `IAuthProvider` |
| `packages/shared/src/types/limits.ts` | `LimitsConfig`, `OrganizationLimits` |

**Mode detection API:**
```typescript
// packages/shared/src/config/mode.ts
export function isSaasMode(): boolean;
export function isSelfHostedMode(): boolean;
export function getControlPlaneUrl(): string | undefined;
export function getTenantId(): string | undefined;
export function getControlPlaneSecret(): string | undefined;
export function validateSaasConfig(): void;  // Throws if missing required vars
```

### 2. Create Auth Provider Abstraction

**Files to create in `backend/src/lib/`:**

| File | Purpose |
|------|---------|
| `authProvider.ts` | Exports `getSession()` that delegates to correct provider |
| `localAuthProvider.ts` | Wraps existing `auth.api.getSession()` |
| `controlPlaneClient.ts` | Stub for control plane API calls |

**Key change in `backend/src/trpc.ts` (line 22):**
```typescript
// Before:
const session = await auth.api.getSession({ headers });

// After:
import { getSession } from "./lib/authProvider";
const session = await getSession(headers);
```

### 3. Modify LimitsService for Dual-Mode

**File:** `backend/src/services/LimitsService.ts`

**Changes:**
1. Import mode detection: `import { isSaasMode } from "@vivd/shared/config"`
2. Make `getConfig()` async
3. Add control plane limits fetching with 5-minute cache
4. Fallback to env vars if control plane unavailable

**Key change (line 58):**
```typescript
// Before:
const getConfig = () => ({...});

// After:
async function getConfig(): Promise<LimitsConfig> {
  if (isSaasMode()) {
    return getControlPlaneConfig();  // Cached, with env fallback
  }
  return getEnvConfig();
}
```

### 4. Create docker-compose.self-hosted.yml

Copy from `docker-compose.prod.yml` with explicit:
```yaml
environment:
  - SAAS_MODE=false
```

### 5. Update Environment Variables

**Add to `.env.example`:**
```bash
# SaaS Mode (optional - for managed deployments)
# SAAS_MODE=false
# CONTROL_PLANE_URL=https://vivd.studio
# CONTROL_PLANE_SECRET=xxx
# TENANT_ID=org_xxx
```

### 6. Add Mode Logging

**In `backend/src/server.ts`** (at startup):
```typescript
import { getModeConfig, validateSaasConfig } from "@vivd/shared/config";

// Validate SaaS config if enabled
validateSaasConfig();

// Log mode for debugging
console.log("[Mode]", getModeConfig());
```

---

## Files Summary

### New Files (13)
- `packages/shared/package.json`
- `packages/shared/tsconfig.json`
- `packages/shared/src/index.ts`
- `packages/shared/src/config/index.ts`
- `packages/shared/src/config/mode.ts`
- `packages/shared/src/types/index.ts`
- `packages/shared/src/types/auth.ts`
- `packages/shared/src/types/limits.ts`
- `backend/src/lib/authProvider.ts`
- `backend/src/lib/localAuthProvider.ts`
- `backend/src/lib/controlPlaneClient.ts`
- `docker-compose.self-hosted.yml`

### Modified Files (5)
- `package.json` - Add workspace for packages/shared
- `backend/package.json` - Add @vivd/shared dependency
- `backend/src/trpc.ts` - Use `getSession()` from authProvider
- `backend/src/services/LimitsService.ts` - Async `getConfig()` with mode detection
- `backend/src/server.ts` - Add mode validation/logging
- `.env.example` - Document new SAAS_MODE variables

---

## Implementation Order

1. **Create packages/shared structure** (no deps on existing code)
2. **Update root package.json** with workspace config
3. **Create auth provider files** in backend/src/lib/
4. **Modify backend/src/trpc.ts** - single line change
5. **Modify backend/src/services/LimitsService.ts** - make getConfig async
6. **Add mode logging** to server.ts
7. **Create docker-compose.self-hosted.yml**
8. **Update .env.example**

---

## Verification

### Self-Hosted Mode (Must Pass)
```bash
# 1. Start without SAAS_MODE (should default to self-hosted)
docker compose up -d

# 2. Check logs for mode
docker compose logs backend | grep "Mode"
# Expected: [Mode] { mode: 'self-hosted', isSaas: false }

# 3. Verify auth works
# - Create user, login, verify session

# 4. Verify limits work
# - Check LICENSE_* env vars are respected
# - Generate usage, verify tracking

# 5. Full feature regression
# - Create project, run agent, publish
```

### SaaS Mode Validation (Config Check Only)
```bash
# Should fail with missing config error
SAAS_MODE=true docker compose up backend
# Expected error: "Missing required environment variables: CONTROL_PLANE_URL, TENANT_ID, CONTROL_PLANE_SECRET"
```

---

## Critical Paths

- `backend/src/trpc.ts:22` - Session retrieval (change to use authProvider)
- `backend/src/services/LimitsService.ts:58` - Config loading (make async, add mode check)
- `backend/src/server.ts` - Startup (add validation)
