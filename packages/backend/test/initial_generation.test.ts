import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyScratchAstroStarter,
  createScratchInitialGenerationManifest,
  getScratchCreationMode,
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

  it("defaults scratch creation mode to legacy_html", () => {
    delete process.env.VIVD_SCRATCH_CREATION_MODE;

    expect(getScratchCreationMode()).toBe("legacy_html");
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
        fs.existsSync(path.join(tmpDir, "AGENTS.md")),
      ).toBe(true);

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
});
