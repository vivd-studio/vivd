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
- Do not point markup at raw `src/content/media/...` filesystem paths.
- Use `public/` only for passthrough files that intentionally need raw framework-public URLs, such as favicons, manifest icons, `robots.txt`, verification files, or explicit compatibility cases.
- Run `vivd cms validate` after changing `src/content.config.ts` or collection entry files.

Use `src/content/` selectively for structured, repeatable, user-managed content such as products, blog posts, directories, testimonials, downloads, events, or case studies.

Do not force one-off presentational page copy or layout wrappers into the CMS by default.
