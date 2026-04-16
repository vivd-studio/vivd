import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyScratchAstroStarter,
  createScratchInitialGenerationManifest,
  getScratchCreationMode,
  readInitialGenerationManifest,
  writeInitialGenerationManifest,
} from "../src/generator/initialGeneration";

describe("initial generation helpers", () => {
  const originalScratchMode = process.env.VIVD_SCRATCH_CREATION_MODE;

  afterEach(() => {
    if (originalScratchMode === undefined) {
      delete process.env.VIVD_SCRATCH_CREATION_MODE;
    } else {
      process.env.VIVD_SCRATCH_CREATION_MODE = originalScratchMode;
    }
    vi.unstubAllEnvs();
  });

  it("defaults scratch creation mode to studio_astro", () => {
    delete process.env.VIVD_SCRATCH_CREATION_MODE;

    expect(getScratchCreationMode()).toBe("studio_astro");
  });

  it("copies the Astro starter scaffold and writes the manifest", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-astro-starter-"));

    try {
      applyScratchAstroStarter({ versionDir: tmpDir });
      writeInitialGenerationManifest(
        tmpDir,
        createScratchInitialGenerationManifest({
          title: "Acme",
          description: "A site for Acme",
          businessType: "design studio",
          referenceUrls: ["https://example.com"],
          model: {
            provider: "openrouter",
            modelId: "openai/gpt-5.4",
            variant: "high",
          },
        }),
      );

      expect(
        fs.existsSync(path.join(tmpDir, "package.json")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpDir, "astro.config.mjs")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "pages", "index.astro")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "content.config.ts")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "lib", "cmsBindings.ts")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "lib", "cms", "CmsText.astro")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "lib", "cms", "CmsImage.astro")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "content", "vivd.content.yaml")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "content", "models")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "content", "collections")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "pages", "media", "[...path].js")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "layouts", "Layout.astro")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "layouts", "BaseLayout.astro")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tmpDir, "src", "components")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tmpDir, "AGENTS.md")),
      ).toBe(true);
      expect(
        fs.readFileSync(
          path.join(tmpDir, "AGENTS.md"),
          "utf-8",
        ),
      ).toContain("does not create CMS ownership");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "AGENTS.md"),
          "utf-8",
        ),
      ).toContain("Derived CMS-backed render points need binding too");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "AGENTS.md"),
          "utf-8",
        ),
      ).toContain("`CmsImage` still needs the actual image field value");

      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "pages", "index.astro"),
          "utf-8",
        ),
      ).toContain('import Layout from "../layouts/Layout.astro";');
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "pages", "index.astro"),
          "utf-8",
        ),
      ).not.toContain("components/sections");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "styles", "global.css"),
          "utf-8",
        ).trim(),
      ).toBe('@import "tailwindcss";');
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "layouts", "Layout.astro"),
          "utf-8",
        ),
      ).toContain('title = "your-title",');
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "layouts", "Layout.astro"),
          "utf-8",
        ),
      ).toContain('description = "your-description",');
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "layouts", "Layout.astro"),
          "utf-8",
        ),
      ).toContain('lang = "en",');
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "layouts", "Layout.astro"),
          "utf-8",
        ),
      ).not.toContain("New Astro Site");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "layouts", "Layout.astro"),
          "utf-8",
        ),
      ).toContain("<html lang={lang}>");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "lib", "cmsBindings.ts"),
          "utf-8",
        ),
      ).toContain("CmsBindingFieldPath");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "lib", "cmsBindings.ts"),
          "utf-8",
        ),
      ).toContain("vivd-cms-toolkit-version");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "lib", "cmsBindings.ts"),
          "utf-8",
        ),
      ).toContain("resolveCmsTextValue");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "lib", "cmsBindings.ts"),
          "utf-8",
        ),
      ).toContain("cmsAssetBindingAttrs");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "lib", "cms", "CmsText.astro"),
          "utf-8",
        ),
      ).toContain("cmsTextBindingAttrs");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "lib", "cms", "CmsText.astro"),
          "utf-8",
        ),
      ).toContain("vivd-cms-toolkit-version");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "lib", "cms", "CmsText.astro"),
          "utf-8",
        ),
      ).toContain("resolveCmsTextValue");
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "lib", "cms", "CmsImage.astro"),
          "utf-8",
        ),
      ).toContain('import { Image } from "astro:assets";');
      expect(
        fs.readFileSync(
          path.join(tmpDir, "src", "lib", "cms", "CmsImage.astro"),
          "utf-8",
        ),
      ).toContain("vivd-cms-toolkit-version");

      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(tmpDir, ".vivd", "initial-generation.json"),
          "utf-8",
        ),
      ) as {
        state?: string;
        flow?: string;
        mode?: string;
        title?: string;
        model?: { provider?: string; modelId?: string; variant?: string };
      };

      expect(manifest).toMatchObject({
        flow: "scratch",
        mode: "studio_astro",
        state: "draft",
        title: "Acme",
        model: {
          provider: "openrouter",
          modelId: "openai/gpt-5.4",
          variant: "high",
        },
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads back persisted initial-generation session metadata", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-initial-generation-"));

    try {
      writeInitialGenerationManifest(tmpDir, {
        ...createScratchInitialGenerationManifest({
          title: "Acme",
          description: "A site for Acme",
        }),
        state: "generating_initial_site",
        sessionId: "sess-1",
        startedAt: "2026-03-31T09:53:06.000Z",
      });

      expect(readInitialGenerationManifest(tmpDir)).toMatchObject({
        state: "generating_initial_site",
        sessionId: "sess-1",
        startedAt: "2026-03-31T09:53:06.000Z",
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
