This is the AGENTS.md file.

Please proactively add information here that is important for the project, for example where the content of this website lives and how to add or remove content from the website.

Entries should be proactively added or removed to always stay relevant to the current project.

For Astro-backed projects, the canonical structured content contract is Astro-native:

- model/schema definitions: `src/content.config.ts`
- collection entries: the real files under `src/content/**`
- Vivd-managed local assets: `src/content/media/`

Vivd adapts to Astro Content Collections internally.

- Do not invent or reintroduce a parallel Vivd YAML schema contract such as `src/content/vivd.content.yaml` or `src/content/models/*.yaml`.
- When changing models, edit `src/content.config.ts`.
- When changing content, edit the real collection entry files under `src/content/**`.
- Follow Astro's collection structure as declared in `src/content.config.ts`.
- Prefer `src/content/media/` as the canonical home for Astro-managed site assets.
- For local or content-managed images in Astro pages/components, default to Astro's `Image` component from `astro:assets`.
- Use plain `<img>` mainly for remote URLs, deliberate passthrough/public files, SVG edge cases, or existing project patterns that already require it.
- For CMS-owned text or images that should stay editable from the live preview, emit neutral `data-cms-*` ownership attributes from project code.
- Prefer the tiny local helper at `src/lib/cmsBindings.ts` for those attributes instead of inventing a Vivd-specific package dependency.
- If the helper is missing or stale, refresh it with `vivd cms helper install` or recreate the same small local helper directly.
- Prefer explicit wrappers like `cmsTextBindingAttrs(...)` and `cmsAssetBindingAttrs(...)` when available, or an entry-scoped helper like `const cms = bindCmsEntry({ collection, entry })` followed by `cms.text(...)` / `cms.asset(...)`.
- Bind every visible render point of a CMS-owned field, not just one occurrence. If the same entry field appears twice on the page, both render points need the CMS binding.
- Include `data-cms-locale` when binding localized CMS values.
- Do not point markup at raw `src/content/media/...` filesystem paths.
- Use `public/` only for passthrough files that intentionally need raw framework-public URLs, such as favicons, manifest icons, `robots.txt`, verification files, or explicit compatibility cases.
- Run `vivd cms validate` after changing `src/content.config.ts` or collection entry files.

Use `src/content/` selectively for structured, repeatable, user-managed content such as products, blog posts, directories, testimonials, downloads, events, or case studies.

Do not force one-off presentational page copy or layout wrappers into the CMS by default.
