This is the AGENTS.md file.

Please proactively add information here that is important for the project, for example where the content of this website lives and how to add or remove content from the website.

Entries should be proactively added or removed to always stay relevant to the current project.

If this Astro project uses the Vivd CMS contract, the canonical structured content lives under `src/content/`:

- collection schemas: `src/content/models/*.yaml`
- collection entries: `src/content/<collection-key>/`
- CMS media/documents: `src/content/media/`

The Vivd YAML files under `src/content/` are the canonical source of truth.

- Do not replace them with a separate Astro-only schema/source-of-truth such as `src/content.config.ts`.
- Astro Content Collections may be used as the Astro rendering/query layer, but they should read from the existing Vivd content contract instead of introducing a second parallel content model.
- Prefer flat collection folders directly under `src/content/`, for example `src/content/<collection-key>/<entry>.yaml`, unless the existing schema already uses a different `storage.path`.
- Directory-style collection entries are also allowed when the schema uses `storage.entryFormat: directory`.
- For CMS images, PDFs, downloads, and other file references, use schema fields of type `asset` or `assetList` instead of plain `string`.
- For image-like CMS fields, set `accepts` (for example `image/*`) so Studio can render image-aware picker and preview controls.
- Prefer `src/content/media/` as the canonical home for Astro-managed site assets.
- Use `public/` only for passthrough files that intentionally need raw framework-public URLs, such as favicons, manifest icons, `robots.txt`, verification files, or explicit compatibility cases.
- Do not hand-edit `.vivd/content/`; it is generated.
- Run `vivd cms validate` after changing CMS schema or collection entries.

Use `src/content/` selectively for structured, repeatable, user-managed content such as products, blog posts, directories, testimonials, downloads, events, or case studies.

Do not force one-off presentational page copy or layout wrappers into the CMS by default.
