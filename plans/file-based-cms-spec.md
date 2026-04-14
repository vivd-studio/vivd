# File-Based CMS Spec

Archived.

The earlier YAML-first CMS direction has been moved to [`plans/old/file-based-cms-spec.md`](./old/file-based-cms-spec.md).

For Astro-backed projects, the active implementation plan is now [`plans/astro-content-collections-plan.md`](./astro-content-collections-plan.md):

- `src/content.config.ts` is the canonical model/schema source of truth
- real Astro collection entry files under `src/content/**` are the canonical entry source of truth
- `src/content/media/` is the canonical Vivd-managed local asset root
- Studio and the CLI adapt to Astro internally instead of requiring generated CMS runtime folders
