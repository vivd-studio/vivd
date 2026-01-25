# Configurable AI Models Feature

Make all AI models in `backend/src/generator/config.ts` configurable from the frontend with admin-only global settings.

## Current State

7 models hardcoded in `backend/src/generator/config.ts`:

| Key | Model ID | Purpose |
|-----|----------|---------|
| `GENERATION_MODEL` | google/gemini-3-pro-preview | HTML landing page generation |
| `ANALYSIS_MODEL` | google/gemini-3-pro-preview | Text analysis, hero prompt generation |
| `HERO_GENERATION_MODEL` | google/gemini-3-pro-image-preview | Hero image generation |
| `IMAGE_EDITING_MODEL` | google/gemini-3-pro-image-preview | AI image editing |
| `BACKGROUND_REMOVAL_MODEL` | openai/gpt-5-image | Background removal |
| `PRIORITIZATION_MODEL` | google/gemini-2.5-flash | Image prioritization/ranking |
| `VISION_MODEL` | google/gemma-3-12b-it:free | Image description/analysis |

## Design Decisions

- **Scope**: Global (admin-only) settings stored in database
- **Model Selection UX**: Curated recommended models + search for full OpenRouter catalog
- **Resolution**: Database → Hardcoded defaults (with 5-min cache)
- **UI Location**: New "AI Models" card in Settings page (admin only)

---

## Implementation Plan

### Phase 1: Database Schema

**File**: `backend/src/db/schema.ts`

Add `globalSettings` table:

```typescript
export const globalSettings = pgTable("global_settings", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  updatedById: text("updated_by_id").references(() => user.id, { onDelete: "set null" }),
});
```

Then generate migration: `npx drizzle-kit generate` and apply: `npx drizzle-kit migrate`

### Phase 2: Backend Service & Router

**New file**: `backend/src/services/ModelConfigService.ts`

- `getModel(category)` - Returns configured model or default
- Exports convenience functions: `getGenerationModel()`, `getAnalysisModel()`, etc.
- 5-minute in-memory cache for DB lookups
- `invalidateCache()` for cache busting on updates

**New file**: `backend/src/routers/models.ts`

- `MODEL_CATEGORIES` constant with descriptions and required capabilities per model slot
- `getModelConfig` - Returns current config merged with defaults + category metadata
- `updateModelConfig` - Admin-only, saves to `globalSettings` table
- `getAvailableModels` - Fetches from OpenRouter API (1-hour cache), filters by category capabilities
- `resetToDefaults` - Admin-only, deletes custom config
- `getRecommendedModels` - Returns curated list for quick selection

**Update**: `backend/src/routers/appRouter.ts`

- Add `models: modelsRouter`

### Phase 3: Update Generator Files

Update these files to use async model resolution instead of static imports:

| File | Changes |
|------|---------|
| `backend/src/generator/agent.ts` | `GENERATION_MODEL` → `await getGenerationModel()` |
| `backend/src/generator/hero_creator.ts` | `ANALYSIS_MODEL`, `HERO_GENERATION_MODEL` → service calls |
| `backend/src/generator/image_analyzer/describe.ts` | `VISION_MODEL` → `await getVisionModel()` |
| `backend/src/generator/image_analyzer/prioritize.ts` | `PRIORITIZATION_MODEL` → `await getPrioritizationModel()` |
| `backend/src/routers/assets/aiImages.ts` | `IMAGE_EDITING_MODEL`, `BACKGROUND_REMOVAL_MODEL`, `HERO_GENERATION_MODEL` → service calls |

### Phase 4: Frontend Components

**New file**: `frontend/src/components/settings/ModelCategorySelect.tsx`

- Select dropdown with search input
- Shows curated/recommended models first
- Groups models by provider
- Indicates current default with badge
- Fetches models from `trpc.models.getAvailableModels` on open

**New file**: `frontend/src/components/settings/ModelConfigCard.tsx`

- Card component with all 7 model categories
- Each category shows: label, description, current selection
- Save/Reset buttons
- Local state for pending changes

**Update**: `frontend/src/pages/Settings.tsx`

- Import and render `ModelConfigCard` for admin users only

---

## Key Files

### Backend (to create/modify)

- `backend/src/db/schema.ts` - Add globalSettings table
- `backend/src/services/ModelConfigService.ts` - New service
- `backend/src/routers/models.ts` - New router
- `backend/src/routers/appRouter.ts` - Wire up router
- `backend/src/generator/agent.ts` - Use service
- `backend/src/generator/hero_creator.ts` - Use service
- `backend/src/generator/image_analyzer/describe.ts` - Use service
- `backend/src/generator/image_analyzer/prioritize.ts` - Use service
- `backend/src/routers/assets/aiImages.ts` - Use service

### Frontend (to create/modify)

- `frontend/src/components/settings/ModelConfigCard.tsx` - New
- `frontend/src/components/settings/ModelCategorySelect.tsx` - New
- `frontend/src/pages/Settings.tsx` - Add ModelConfigCard

---

## Model Categories Definition

```typescript
export const MODEL_CATEGORIES = {
  generation: {
    label: "HTML Generation",
    description: "Creates HTML landing pages from website content and screenshots",
    requiredCapabilities: ["text"],
    recommended: ["google/gemini-3-pro-preview", "anthropic/claude-sonnet-4", "openai/gpt-4o"],
  },
  analysis: {
    label: "Text Analysis",
    description: "Text analysis, planning operations, and hero prompt generation",
    requiredCapabilities: ["text"],
    recommended: ["google/gemini-3-pro-preview", "anthropic/claude-sonnet-4"],
  },
  heroGeneration: {
    label: "Hero Image Generation",
    description: "Generates hero images for landing pages from prompts and reference images",
    requiredCapabilities: ["image-generation"],
    recommended: ["google/gemini-3-pro-image-preview", "openai/gpt-5-image"],
  },
  imageEditing: {
    label: "Image Editing",
    description: "AI-powered image editing with custom prompts",
    requiredCapabilities: ["image-generation", "vision"],
    recommended: ["google/gemini-3-pro-image-preview", "openai/gpt-5-image"],
  },
  backgroundRemoval: {
    label: "Background Removal",
    description: "Removes backgrounds from images with transparency support",
    requiredCapabilities: ["image-generation", "vision"],
    recommended: ["openai/gpt-5-image", "google/gemini-3-pro-image-preview"],
  },
  prioritization: {
    label: "Image Prioritization",
    description: "Prioritizes and ranks images by relevance to website content",
    requiredCapabilities: ["text"],
    recommended: ["google/gemini-2.5-flash", "google/gemini-2.5-pro"],
  },
  vision: {
    label: "Image Description",
    description: "Describes and analyzes images for context in generation",
    requiredCapabilities: ["vision"],
    recommended: ["google/gemma-3-12b-it:free", "google/gemini-2.5-flash"],
  },
};
```

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend                                   │
├─────────────────────────────────────────────────────────────────────┤
│  Settings Page                                                       │
│  └── ModelConfigCard                                                │
│      └── ModelCategorySelect (x7)                                   │
│          ├── trpc.models.getModelConfig() → Display current         │
│          ├── trpc.models.getAvailableModels() → Populate dropdown   │
│          └── trpc.models.updateModelConfig() → Save changes         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           Backend                                    │
├─────────────────────────────────────────────────────────────────────┤
│  modelsRouter                                                        │
│  ├── getModelConfig → Read from DB, merge with defaults             │
│  ├── updateModelConfig → Write to DB                                │
│  └── getAvailableModels → Fetch from OpenRouter (cached)            │
│                                                                      │
│  ModelConfigService                                                  │
│  └── getModel(category) → DB → Default (cached 5min)                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Generation Pipeline                           │
├─────────────────────────────────────────────────────────────────────┤
│  agent.ts         → await getGenerationModel()                      │
│  hero_creator.ts  → await getAnalysisModel()                        │
│                   → await getHeroGenerationModel()                  │
│  describe.ts      → await getVisionModel()                          │
│  prioritize.ts    → await getPrioritizationModel()                  │
│  aiImages.ts      → await getImageEditingModel()                    │
│                   → await getBackgroundRemovalModel()               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## OpenRouter Model Filtering

When fetching models from OpenRouter API (`GET https://openrouter.ai/api/v1/models`), filter based on category capabilities:

| Capability | Filter Logic |
|------------|--------------|
| `text` | `architecture.modality` includes "text" |
| `vision` | `architecture.input_modalities` includes "image" |
| `image-generation` | `architecture.output_modalities` includes "image" |

The curated/recommended models for each category will appear first in the dropdown, followed by a separator, then the full filtered list grouped by provider.

---

## Verification Plan

1. **Database**: Run migration, verify `global_settings` table exists
2. **API**: Test endpoints via tRPC playground or curl:
   - `GET /api/trpc/models.getModelConfig` - Returns defaults
   - `POST /api/trpc/models.updateModelConfig` - Saves custom config
   - `GET /api/trpc/models.getAvailableModels` - Returns filtered model list
3. **UI**: Log in as admin, navigate to Settings, verify ModelConfigCard appears
4. **Integration**: Change a model, run a URL flow generation, verify new model is used in OpenRouter API calls (check logs or cost tracking)
5. **Fallback**: Delete custom config, verify defaults are used

---

## Future Considerations

1. **Project-level overrides**: Add a `project_settings` table that can override global settings per-project
2. **Per-generation model selection**: Allow selecting models at generation time
3. **Model recommendations**: Show cost/performance recommendations based on usage patterns
4. **Model validation**: Test model availability before saving selection
5. **Audit log**: Track who changed models and when
