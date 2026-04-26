import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyAstroPatches } from "./AstroPatchService.js";

describe("AstroPatchService", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("uses sourceLoc to patch the nearest Astro text occurrence", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-astro-patch-"));
    tempDirs.push(projectDir);
    const filePath = path.join(projectDir, "src", "pages", "index.astro");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `<div>
  <p>Shared Title</p>
  <section>
    <h2>Shared Title</h2>
  </section>
</div>
`,
      "utf8",
    );

    const result = applyAstroPatches(projectDir, [
      {
        type: "setAstroText",
        sourceFile: "src/pages/index.astro",
        sourceLoc: "4:9",
        oldValue: "Shared Title",
        newValue: "Updated Title",
      },
    ]);

    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain("<p>Shared Title</p>");
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain("<h2>Updated Title</h2>");
  });

  it("skips ambiguous Astro text replacements when no sourceLoc is available", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-astro-patch-"));
    tempDirs.push(projectDir);
    const filePath = path.join(projectDir, "src", "pages", "index.astro");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `<div>
  <p>Shared Title</p>
  <h2>Shared Title</h2>
</div>
`,
      "utf8",
    );

    const result = applyAstroPatches(projectDir, [
      {
        type: "setAstroText",
        sourceFile: "src/pages/index.astro",
        oldValue: "Shared Title",
        newValue: "Updated Title",
      },
    ]);

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "src/pages/index.astro",
        reason: 'Ambiguous text match: "Shared Title"',
      },
    ]);
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain("<p>Shared Title</p>");
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain("<h2>Shared Title</h2>");
  });

  it("rewrites a source-owned Astro Image to an imported src/content/media asset", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-astro-patch-"));
    tempDirs.push(projectDir);
    const filePath = path.join(projectDir, "src", "components", "Hero.astro");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `---
import { Image } from "astro:assets";
const heroImage = "/images/hero-horse.webp";
---
<section>
  <Image src={heroImage} alt="Horse hero" width={1200} height={900} />
</section>
`,
      "utf8",
    );

    const result = applyAstroPatches(projectDir, [
      {
        type: "setAstroImage",
        sourceFile: "src/components/Hero.astro",
        sourceLoc: "6:4",
        assetPath: "src/content/media/shared/new-hero.webp",
        oldValue: "/images/hero-horse.webp",
      },
    ]);

    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain(
      'import vivdImageNewHero from "../content/media/shared/new-hero.webp";',
    );
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain(
      '<Image src={vivdImageNewHero} alt="Horse hero" width={1200} height={900} />',
    );
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain(
      'const heroImage = "/images/hero-horse.webp";',
    );
  });

  it("rewrites a plain img tag to use an imported src/content/media asset", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-astro-patch-"));
    tempDirs.push(projectDir);
    const filePath = path.join(projectDir, "src", "pages", "index.astro");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `<section>
  <img src="/images/legacy-hero.webp" alt="Legacy hero" />
</section>
`,
      "utf8",
    );

    const result = applyAstroPatches(projectDir, [
      {
        type: "setAstroImage",
        sourceFile: "src/pages/index.astro",
        sourceLoc: "2:4",
        assetPath: "src/content/media/shared/new-hero.webp",
        oldValue: "/images/legacy-hero.webp",
      },
    ]);

    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain(
      'import vivdImageNewHero from "../content/media/shared/new-hero.webp";',
    );
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain(
      '<img src={vivdImageNewHero.src} alt="Legacy hero" />',
    );
  });

  it("rewrites a plain img tag to use a nested src/content asset import", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-astro-patch-"));
    tempDirs.push(projectDir);
    const filePath = path.join(projectDir, "src", "pages", "index.astro");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `<section>
  <img src="/images/legacy-hero.webp" alt="Legacy hero" />
</section>
`,
      "utf8",
    );

    const result = applyAstroPatches(projectDir, [
      {
        type: "setAstroImage",
        sourceFile: "src/pages/index.astro",
        sourceLoc: "2:4",
        assetPath: "src/content/posts/horse/hero.webp",
        oldValue: "/images/legacy-hero.webp",
      },
    ]);

    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain(
      'import vivdImageHero from "../content/posts/horse/hero.webp";',
    );
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain(
      '<img src={vivdImageHero.src} alt="Legacy hero" />',
    );
  });
});
