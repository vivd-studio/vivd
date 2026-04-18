This file is project memory for future agent sessions.

Keep it short. This file should only hold project-specific notes, content locations, and editing workflows that are useful for this particular site. Or user-specific preferences of how things should be done on this site.

Starter defaults:

- Structured content schema: `src/content.config.ts`
- Collection entries: `src/content/**`
- CMS media and other managed assets: `src/content/media/`
- CMS toolkit helpers: `src/lib/cmsBindings.ts`, `src/lib/cms/CmsText.astro`, `src/lib/cms/CmsImage.astro`
- Locale dictionaries: `src/locales/*.json`
- Passthrough public files: `public/`

Use `src/content/` for structured, repeatable, user-managed content. Keep one-off layout wrappers or presentational page copy in pages/components unless the project intentionally moves that content into the CMS.

Update this file whenever the project adds a new content area, changes where managed assets live, or adopts a project-specific editing convention worth remembering. Or if specific needs & preferences of the user become clear and are worth remembering.
