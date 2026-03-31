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
      ).not.toContain("New Astro Site");

      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(tmpDir, ".vivd", "initial-generation.json"),
          "utf-8",
        ),
      ) as { state?: string; flow?: string; mode?: string; title?: string };

      expect(manifest).toMatchObject({
        flow: "scratch",
        mode: "studio_astro",
        state: "draft",
        title: "Acme",
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
