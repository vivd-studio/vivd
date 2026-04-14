# Usage Tracking for Standalone Studio

> **Status: IMPLEMENTED**
>
> This document was the original planning doc. The implementation is now complete.

## Implementation Summary

### Studio Side (`packages/studio`)

- **Mode detection**: `packages/shared/src/config/studioMode.ts`
  - `isConnectedMode()` - returns true when `MAIN_BACKEND_URL` is set
  - `getBackendUrl()`, `getSessionToken()`, `getStudioId()`

- **Usage reporter**: `packages/studio/server/services/UsageReporter.ts`
  - Queues usage events with batching
  - Sends to backend every 5 seconds
  - Retry logic with exponential backoff
  - Graceful shutdown with final flush

- **Usage router**: `packages/studio/server/trpcRouters/usage.ts`
  - In connected mode: proxies to backend via `usageReporter.fetchStatus()`
  - In standalone mode: returns unlimited stub

### Backend Side (`packages/backend`)

- **Studio API router**: `packages/backend/src/trpcRouters/studioApi.ts`
  - `reportUsage` - receives usage reports from studio instances
  - `getStatus` - returns current usage limits
  - Uses existing `UsageService` and `LimitsService`

## Configuration

### Studio (Connected Mode)
```env
MAIN_BACKEND_URL=https://api.vivd.io   # Enables connected mode
SESSION_TOKEN=<user-auth-token>         # For backend auth
STUDIO_ID=studio-instance-1             # Unique instance ID
```

### Studio (Standalone Mode)
No configuration needed - standalone is the default when `MAIN_BACKEND_URL` is not set.
