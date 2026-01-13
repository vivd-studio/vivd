# Usage Tracking & Limits Implementation

> [!NOTE]
> This document tracks the implementation of the instance-wide usage tracking usage limits for vivd.

## Context & Goals

We are implementing a usage tracking system to control costs associated with running LLM agents and image generation.

**Key Requirements:**

1. **Dollar-based Tracking**: Use OpenCode's `cost` output (in dollars) for accurate billing tracking, rather than token counts.
2. **Image Generation Limits**: Track image generations separately as a monthly count.
3. **Instance-wide Limits**: Limits apply to the entire instance (all projects/users on that server).
4. **Auto-reset Periods**: Limits reset automatically:
   - **Daily**: Midnight UTC
   - **Weekly**: Sunday Midnight UTC
   - **Monthly**: 1st of month Midnight UTC
5. **UX Features**:
   - Warnings at 80% usage.
   - Hard block at 100% usage.
   - Clear messaging about reset times.

## default Limits (Configurable)

| Limit Type | Env Var | Default |
|Params|---|---|
| Daily Cost | `LICENSE_DAILY_COST_LIMIT` | $20.00 |
| Weekly Cost | `LICENSE_WEEKLY_COST_LIMIT` | $50.00 |
| Monthly Cost | `LICENSE_MONTHLY_COST_LIMIT` | $100.00 |
| Monthly Images | `LICENSE_IMAGE_GEN_PER_MONTH` | 50 images |
| Warning | `LICENSE_WARNING_THRESHOLD` | 0.8 (80%) |

## Implementation Status

### Phase 1: Database & Core Service (✅ Completed)

- [x] **Database Schema**: Added `usage_record` (audit trail) and `usage_period` (aggregates) tables.
- [x] **UsageService**: Implemented service to record costs and update aggregates transactionally.
- [x] **LimitsService**: Implemented logic to check current usage against env var limits and calculate next reset times.

### Phase 2: Backend Integration (✅ Completed)

- [x] **OpenCode Integration**: Hooked into `onUsageUpdated` event in `backend/src/opencode/index.ts` to call `UsageService.recordAiCost()`.
- [x] **Image Gen Integration**: Wrapped `createImageWithAI` and `editImageWithAI` in `aiImages.ts` to:
  1. Check `LimitsService.assertImageGenNotBlocked()` before generation.
  2. Call `UsageService.recordImageGeneration()` after success.
- [x] **API Endpoints**: Exposed `usage.status`, `usage.current`, and `usage.history` via tRPC (`backend/src/routers/usage.ts`).

### Phase 3: Frontend Integration (✅ Completed)

- [x] **Chat Warning**: Updated `ChatContext` to poll `usage.status` every 30s and expose `usageLimitStatus` and `isUsageBlocked`.
- [x] **Warning Banner**: Added yellow warning banner in `MessageList` when approaching 80% usage (dismissible).
- [x] **Blocked Banner**: Added red blocked banner when usage limit is reached.
- [x] **Blocking UI**: Disabled chat input/buttons when `blocked: true`, with helpful placeholder text.
- [x] **Admin Dashboard**: Added `UsageStatsCard` component to Admin panel with:
  - Current usage summary (daily/weekly/monthly costs + image generations)
  - Progress bars with color-coded thresholds (green/yellow/red)
  - Next reset times for each period
  - Warning/blocked status display
  - Last 7 days bar chart
  - Recent activity table (last 10 events)

## Architecture Details

### Database Tables

**`usage_record`**
Records every single cost event for auditability.

- `id`: UUID
- `eventType`: 'ai_cost' | 'image_gen'
- `cost`: Numeric (dollars)
- `tokens`: JSON (detailed token breakdown)
- `createdAt`: Timestamp

**`usage_period`**
Stores running totals for fast lookups. IDs are deterministic (e.g., `daily:2024-03-20`).

- `id`: Text (PK)
- `periodType`: 'daily' | 'weekly' | 'monthly'
- `totalCost`: Numeric
- `imageCount`: Integer

### Services

**`UsageService.ts`**

- `recordAiCost(cost)`: Inserts record + updates all 3 period aggregates (daily/weekly/monthly).
- `recordImageGeneration()`: Inserts record + increments image count in aggregates.

**`LimitsService.ts`**

- `checkLimits()`: Reads current aggregates, compares to env vars. Returns `blocked` status and warning messages.
- `assertNotBlocked()`: Throws error if any limit is hit.

## Files Modified

### Backend
- `backend/src/db/schema.ts` - Added `usage_record` and `usage_period` tables
- `backend/src/services/UsageService.ts` - Core usage tracking service
- `backend/src/services/LimitsService.ts` - Limit checking and warnings
- `backend/src/routers/usage.ts` - tRPC endpoints for frontend
- `backend/src/routers/appRouter.ts` - Added usage router
- `backend/src/opencode/index.ts` - Wired `onUsageUpdated` to record AI costs
- `backend/src/routers/assets/aiImages.ts` - Added limits checks to image generation

### Frontend
- `frontend/src/components/chat/ChatContext.tsx` - Added usage limit polling and context values
- `frontend/src/components/chat/ChatInput.tsx` - Disabled input when blocked
- `frontend/src/components/chat/MessageList.tsx` - Added warning/blocked banners
- `frontend/src/pages/Admin.tsx` - Added `UsageStatsCard` component with charts and tables

### Configuration
- `.env.example` - Added `LICENSE_*` environment variables
- `docker-compose.yml` - Added usage limit env vars to backend service
- `docker-compose.prod.yml` - Added usage limit env vars to backend service

## Testing

To test the implementation:
1. Set low limits in environment variables (e.g., `LICENSE_DAILY_COST_LIMIT=0.01`)
2. Run the agent to trigger usage recording
3. Verify warning banner appears at 80%
4. Verify blocked banner and disabled input at 100%
5. Reset by changing the date or clearing the `usage_period` table
