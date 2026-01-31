# Usage Tracking for Standalone Studio

## Overview

Enable the standalone studio (`packages/studio`) to report usage back to the main backend when running in SaaS mode. This prepares for replacing the current embedded studio with the standalone version.

## Architecture

```
┌─────────────────────┐                    ┌─────────────────────┐
│   Standalone Studio │                    │    Main Backend     │
│                     │                    │                     │
│  ┌───────────────┐  │   POST /api/       │  ┌───────────────┐  │
│  │ OpenCode SDK  │──┼──studio/usage/────▶│  │ UsageService  │  │
│  │ (usage events)│  │     report         │  │   (record)    │  │
│  └───────────────┘  │                    │  └───────────────┘  │
│         │           │                    │         │           │
│  ┌──────▼────────┐  │   GET /api/        │  ┌──────▼────────┐  │
│  │UsageReporter  │──┼──studio/usage/────▶│  │LimitsService  │  │
│  │   Service     │  │     status         │  │   (check)     │  │
│  └───────────────┘  │                    │  └───────────────┘  │
└─────────────────────┘                    └─────────────────────┘
```

## Modes

| Mode | Description | Usage Tracking |
|------|-------------|----------------|
| `standalone` | True standalone, no backend | None (unlimited) |
| `connected` | Studio connects to main backend | Reports to backend |

## Implementation Tasks

### 1. Shared: Add Studio Mode Types (`packages/shared`)

**File: `packages/shared/src/types/studioMode.ts`** (new)

```typescript
export interface StudioUsageReport {
  sessionId: string;
  sessionTitle?: string;
  cost: number;           // dollars
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  partId?: string;        // for idempotency
  projectPath?: string;   // workspace path
  timestamp: string;      // ISO date
}

export interface StudioConfig {
  mode: 'standalone' | 'connected';
  backendUrl?: string;    // Required in connected mode
  studioSecret?: string;  // Auth secret for backend
  studioId?: string;      // Unique studio instance ID
}
```

**File: `packages/shared/src/config/studioMode.ts`** (new)

```typescript
export function getStudioMode(): 'standalone' | 'connected'
export function getBackendUrl(): string | undefined
export function getStudioSecret(): string | undefined
export function getStudioId(): string | undefined
export function isConnectedMode(): boolean
export function validateStudioConfig(): void
```

Environment variables:
- `STUDIO_MODE` = `standalone` | `connected` (default: standalone)
- `MAIN_BACKEND_URL` = URL of main backend (required in connected mode)
- `STUDIO_SECRET` = Shared secret for auth (required in connected mode)
- `STUDIO_ID` = Unique identifier for this studio instance

### 2. Studio: Usage Reporter Service

**File: `packages/studio/server/services/UsageReporter.ts`** (new)

Responsibilities:
- Listen to OpenCode usage events
- In connected mode: POST events to main backend
- Queue events with retry logic
- Handle network failures gracefully

```typescript
class UsageReporter {
  private queue: StudioUsageReport[] = [];
  private flushing = false;

  // Called by OpenCode event handler
  async report(data: UsageData, sessionId: string, sessionTitle?: string): Promise<void>

  // Batch send to backend
  private async flush(): Promise<void>

  // Retry failed reports
  private async retryFailedReports(): Promise<void>
}

export const usageReporter = new UsageReporter();
```

### 3. Studio: Integrate Reporter with OpenCode Events

**File: `packages/studio/server/routers/agent.ts`** (modify)

In the `runTask` procedure, hook into `onUsageUpdated`:

```typescript
onUsageUpdated: async (data) => {
  // Forward to usage reporter
  await usageReporter.report(data, sessionId, sessionTitle);
}
```

### 4. Studio: Update Usage Router

**File: `packages/studio/server/routers/usage.ts`** (modify)

In connected mode, proxy to backend:

```typescript
export const usageRouter = router({
  status: publicProcedure.query(async () => {
    if (isConnectedMode()) {
      // Fetch from main backend
      return await fetchBackendUsageStatus();
    }
    // Standalone: return unlimited stub
    return getUnlimitedStatus();
  }),
});
```

### 5. Backend: Studio API Endpoints

**File: `packages/backend/src/routers/studioApi.ts`** (new)

New router for studio-to-backend communication:

```typescript
export const studioApiRouter = router({
  // Receive usage reports from studio instances
  reportUsage: publicProcedure
    .input(z.object({
      studioId: z.string(),
      studioSecret: z.string(),
      reports: z.array(studioUsageReportSchema),
    }))
    .mutation(async ({ input }) => {
      // Verify secret
      assertValidStudioSecret(input.studioSecret);

      // Record each report via UsageService
      for (const report of input.reports) {
        await usageService.recordAiCost(
          report.cost,
          report.tokens,
          report.sessionId,
          report.sessionTitle,
          report.projectPath,
          report.partId,
        );
      }

      return { success: true };
    }),

  // Return current usage status for a studio
  getStatus: publicProcedure
    .input(z.object({
      studioId: z.string(),
      studioSecret: z.string(),
    }))
    .query(async ({ input }) => {
      assertValidStudioSecret(input.studioSecret);
      return await limitsService.checkLimits();
    }),
});
```

### 6. Backend: Register Studio API Router

**File: `packages/backend/src/routers/_app.ts`** (modify)

Add the studio API router:

```typescript
import { studioApiRouter } from './studioApi';

export const appRouter = router({
  // ... existing routers
  studioApi: studioApiRouter,
});
```

### 7. Backend: Studio Secret Validation

**File: `packages/backend/src/lib/studioAuth.ts`** (new)

```typescript
export function assertValidStudioSecret(secret: string): void {
  const validSecret = process.env.STUDIO_API_SECRET;
  if (!validSecret) {
    throw new Error('STUDIO_API_SECRET not configured');
  }
  if (secret !== validSecret) {
    throw new Error('Invalid studio secret');
  }
}
```

Environment variable:
- `STUDIO_API_SECRET` = Secret that studio instances use to authenticate

## File Summary

| Package | File | Action |
|---------|------|--------|
| shared | `src/types/studioMode.ts` | Create |
| shared | `src/config/studioMode.ts` | Create |
| shared | `src/types/index.ts` | Export new types |
| shared | `src/config/index.ts` | Export new config |
| studio | `server/services/UsageReporter.ts` | Create |
| studio | `server/routers/agent.ts` | Modify (hook reporter) |
| studio | `server/routers/usage.ts` | Modify (proxy in connected mode) |
| backend | `src/routers/studioApi.ts` | Create |
| backend | `src/routers/_app.ts` | Modify (add router) |
| backend | `src/lib/studioAuth.ts` | Create |

## Environment Variables

### Studio (connected mode)
```env
STUDIO_MODE=connected
MAIN_BACKEND_URL=https://api.vivd.io
STUDIO_SECRET=<shared-secret>
STUDIO_ID=studio-instance-1
```

### Backend
```env
STUDIO_API_SECRET=<shared-secret>
```

## Verification

1. **Standalone mode (no changes needed)**:
   - Start studio without `STUDIO_MODE` env
   - Usage status returns unlimited stub
   - No network calls to backend

2. **Connected mode**:
   - Set `STUDIO_MODE=connected` and other env vars
   - Run a task in studio that uses AI
   - Verify usage event is sent to backend
   - Check backend database for new usage record
   - Verify `usage.status` returns actual limits from backend

3. **Error handling**:
   - Start studio in connected mode with backend down
   - Run a task - should queue events
   - Start backend - queued events should flush
   - Verify usage eventually recorded

## Future Considerations

- **Multi-tenant**: If backend serves multiple organizations, studio reports could include `tenantId`
- **Billing integration**: Backend could aggregate studio usage for billing
- **Real-time limits**: WebSocket for instant limit updates instead of polling
- **Usage history**: Studio could cache recent usage for display even in connected mode
