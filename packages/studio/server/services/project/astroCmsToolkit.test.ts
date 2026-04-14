import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureAstroCmsToolkit,
  projectReferencesCmsToolkit,
} from "./astroCmsToolkit.js";

const tempDirs: string[] = [];

async function makeTempProject(): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-astro-cms-toolkit-"));
  tempDirs.push(projectDir);
  await fs.mkdir(path.join(projectDir, "src", "pages"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "astro.config.mjs"), "export default {};\n", "utf8");
  return projectDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("astroCmsToolkit", () => {
  it("detects Astro source files that reference the local CMS toolkit", async () => {
    const projectDir = await makeTempProject();
    await fs.writeFile(
      path.join(projectDir, "src", "pages", "index.astro"),
      'import CmsText from "../lib/cms/CmsText.astro";\n',
      "utf8",
    );

    await expect(projectReferencesCmsToolkit(projectDir)).resolves.toBe(true);
  });

  it("installs missing toolkit files only when the Astro project references them", async () => {
    const projectDir = await makeTempProject();
    await fs.writeFile(
      path.join(projectDir, "src", "pages", "index.astro"),
      'import CmsText from "../lib/cms/CmsText.astro";\n',
      "utf8",
    );

    await ensureAstroCmsToolkit(projectDir, "astro");

    await expect(
      fs.stat(path.join(projectDir, "src", "lib", "cmsBindings.ts")),
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectDir, "src", "lib", "cms", "CmsText.astro")),
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectDir, "src", "lib", "cms", "CmsImage.astro")),
    ).resolves.toBeDefined();
  });

  it("does not create toolkit files for Astro projects that do not reference them", async () => {
    const projectDir = await makeTempProject();
    await fs.writeFile(
      path.join(projectDir, "src", "pages", "index.astro"),
      "<h1>Hello</h1>\n",
      "utf8",
    );

    await ensureAstroCmsToolkit(projectDir, "astro");

    await expect(
      fs.stat(path.join(projectDir, "src", "lib", "cmsBindings.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
