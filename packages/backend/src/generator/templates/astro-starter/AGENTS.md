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
- For CMS-owned text or images that should stay editable from the live preview, prefer the local toolkit under `src/lib/cms/`, especially `CmsText.astro` and `CmsImage.astro`.
- Rendering `item.data.title`, `entry.data.description`, `testimonial.data.quote`, or similar collection values directly only prints the current content; it does not create CMS ownership. Bind the actual visible text render point with `CmsText` or `cmsTextBindingAttrs(...)`.
- Derived CMS-backed render points need binding too. If the user sees a field as initials, badges, ratings, labels, truncated text, or another computed string, bind that visible output as well.
- `CmsImage` still needs the actual image field value via `src={entry.data.image}` or the equivalent field expression. Collection/entry/field metadata without `src` is incomplete and will not render the image.
- If a CMS image field stores an Astro-relative `../media/...` path, normalize it to the project's preview-safe browser URL before rendering instead of leaving the raw relative string in markup.
- The lower-level ownership helpers live in `src/lib/cmsBindings.ts`.
- Before CMS/localization work, run `vivd cms helper status`. If any toolkit file is missing or stale, refresh it with `vivd cms helper install`.
- Prefer entry-scoped helpers like `const cms = bindCmsEntry({ collection, entry })` only when a wrapper component is not a good fit.
- Bind every visible render point of a CMS-owned field, not just one occurrence. If the same entry field appears twice on the page, both render points need the CMS binding.
- Simple page-owned Astro image render points can also be replaced from preview when they use straightforward `<Image src={...} />` or `<img src="..." />` patterns that Vivd can map back to source.
- When localizing a CMS-backed Astro site, update all of these together: `astro.config.*` i18n locales/default locale, route/layout `lang` handling (including `<html lang={lang}>`), localized CMS field shapes in `src/content.config.ts`, and the existing entry files under `src/content/**`. Do not stop after adding `src/locales/*.json` and a language switcher.
- For localized CMS values, pass the locale through the CMS binding path, for example via the `locale` prop on `CmsText` or `data-cms-locale` on a lower-level binding helper. That binding only tells Studio where to save the edit; it does not make a monolingual field multilingual by itself.
- For localized CMS text, either resolve the locale-specific scalar before rendering or pass the locale object directly to `CmsText` together with `locale` and `defaultLocale` so the component can render the active locale and keep the binding path aligned.
- Keep locale-dictionary UI text in `src/locales/*.json` and use `data-i18n="key"` for those strings. Do not stack `data-i18n` on the same element as a CMS ownership binding.
- When introducing custom font stacks, include explicit emoji fallbacks such as `Apple Color Emoji`, `Segoe UI Emoji`, `Noto Color Emoji`, and `sans-serif` so CMS content containing emoji keeps rendering.
- Do not point markup at raw `src/content/media/...` filesystem paths.
- Use `public/` only for passthrough files that intentionally need raw framework-public URLs, such as favicons, manifest icons, `robots.txt`, verification files, or explicit compatibility cases.
- Before you finish a CMS-heavy page or generation pass, audit the render layer for raw `item.data.*` text render points without CMS ownership, missing bindings on duplicate or derived occurrences, `CmsImage` usage without `src`, and browser-facing `../media/...` URLs.
- Run `vivd cms validate` after changing `src/content.config.ts` or collection entry files.

Use `src/content/` selectively for structured, repeatable, user-managed content such as products, blog posts, directories, testimonials, downloads, events, or case studies.

Do not force one-off presentational page copy or layout wrappers into the CMS by default.

For long-form content such as blog posts, articles, docs, or legal pages, prefer markdown collection entries with structured frontmatter plus markdown body content instead of splitting the whole body into many short string fields.
