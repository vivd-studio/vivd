import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCmsArtifacts,
  getCmsPaths,
  scaffoldCmsEntry,
  scaffoldCmsModel,
  scaffoldCmsWorkspace,
  validateCmsWorkspace,
} from "./cms.js";

async function createTempProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "vivd-cms-"));
}

describe("cms workspace utilities", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("scaffolds a workspace, model, and entry that validate cleanly", async () => {
    const projectDir = await createTempProjectDir();
    tempDirs.push(projectDir);

    const initResult = await scaffoldCmsWorkspace(projectDir);
    const modelResult = await scaffoldCmsModel(projectDir, "products");
    const entryResult = await scaffoldCmsEntry(projectDir, "products", "alpine-boot");
    const report = await validateCmsWorkspace(projectDir);

    expect(initResult.created).toContain("src/content/vivd.content.yaml");
    expect(modelResult.created).toContain("src/content/models/products.yaml");
    expect(entryResult.created).toContain("src/content/collections/products/alpine-boot/index.yaml");
    expect(report.valid).toBe(true);
    expect(report.initialized).toBe(true);
    expect(report.modelCount).toBe(1);
    expect(report.entryCount).toBe(1);
    expect(report.errors).toEqual([]);
  });

  it("builds .vivd content artifacts and copies referenced media", async () => {
    const projectDir = await createTempProjectDir();
    tempDirs.push(projectDir);

    await scaffoldCmsWorkspace(projectDir);
    const paths = getCmsPaths(projectDir);
    await fs.writeFile(
      path.join(paths.modelsRoot, "products.yaml"),
      `label: Products
storage:
  path: ./collections/products
  entryFormat: directory
display:
  primaryField: title
entry:
  statusField: status
  fields:
    slug:
      type: slug
      required: true
    title:
      type: string
      localized: true
      required: true
    status:
      type: enum
      options:
        - active
        - inactive
      default: active
    heroImage:
      type: asset
      accepts:
        - image/*
`,
      "utf8",
    );
    await fs.writeFile(
      paths.rootConfigPath,
      `version: 1
defaultLocale: en
locales:
  - en
models:
  - key: products
    kind: collection
    schema: ./models/products.yaml
`,
      "utf8",
    );
    const entryDir = path.join(paths.collectionsRoot, "products", "alpine-boot");
    await fs.mkdir(entryDir, { recursive: true });
    const mediaDir = path.join(paths.mediaRoot, "products", "alpine-boot");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, "hero.jpg"), "hero-bytes", "utf8");
    await fs.writeFile(
      path.join(entryDir, "index.yaml"),
      `slug: alpine-boot
status: active
title:
  en: Alpine Boot
heroImage:
  path: ../../../media/products/alpine-boot/hero.jpg
`,
      "utf8",
    );

    const result = await buildCmsArtifacts(projectDir);

    expect(result.modelCount).toBe(1);
    expect(result.entryCount).toBe(1);
    expect(result.assetCount).toBe(1);
    expect(await fs.readFile(path.join(result.outputDir, "manifest.json"), "utf8")).toContain(
      '"contentRoot": "src/content"',
    );
    expect(await fs.readFile(path.join(result.outputDir, "runtime.mjs"), "utf8")).toContain(
      "getCmsCollection",
    );
    expect(
      await fs.readFile(path.join(result.outputDir, "media", "products", "alpine-boot", "hero.jpg"), "utf8"),
    ).toBe("hero-bytes");
  });

  it("reports validation errors for unsupported schema types and bad asset roots", async () => {
    const projectDir = await createTempProjectDir();
    tempDirs.push(projectDir);

    await scaffoldCmsWorkspace(projectDir);
    const paths = getCmsPaths(projectDir);
    await fs.writeFile(
      paths.rootConfigPath,
      `version: 1
defaultLocale: en
locales:
  - en
models:
  - key: products
    kind: collection
    schema: ./models/products.yaml
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(paths.modelsRoot, "products.yaml"),
      `label: Products
storage:
  path: ./collections/products
  entryFormat: directory
entry:
  fields:
    broken:
      type: made_up_type
    heroImage:
      type: asset
`,
      "utf8",
    );
    const entryDir = path.join(paths.collectionsRoot, "products", "alpine-boot");
    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(
      path.join(entryDir, "index.yaml"),
      `broken: something
heroImage:
  path: ../hero.jpg
`,
      "utf8",
    );

    const report = await validateCmsWorkspace(projectDir);

    expect(report.valid).toBe(false);
    expect(report.errors.some((error) => error.includes("unsupported type made_up_type"))).toBe(
      true,
    );
    expect(
      report.errors.some((error) => error.includes("must point to a file under src/content/media")),
    ).toBe(true);
  });

  it("loads legacy flat-file collections declared as model strings", async () => {
    const projectDir = await createTempProjectDir();
    tempDirs.push(projectDir);

    await scaffoldCmsWorkspace(projectDir);
    const paths = getCmsPaths(projectDir);
    await fs.writeFile(
      paths.rootConfigPath,
      `version: 1
defaultLocale: en
locales:
  - en
models:
  - menu
  - features
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(paths.modelsRoot, "menu.yaml"),
      `fields:
  - name: name
    type: string
    label: Name
    required: true
  - name: level
    type: string
    label: Spiciness Level
    options:
      - Mild
      - Hot
    required: true
  - name: description
    type: text
    required: true
  - name: order
    type: number
    default: 0
`,
      "utf8",
    );
    await fs.mkdir(path.join(paths.contentRoot, "menu"), { recursive: true });
    await fs.writeFile(
      path.join(paths.contentRoot, "menu", "classic-mild.yaml"),
      `name: Classic Mild
level: Mild
description: Smooth pesto with pine nuts.
order: 1
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(paths.contentRoot, "menu", "flaming-hot.yaml"),
      `name: Flaming Hot
level: Hot
description: Aggressively spicy pesto.
order: 2
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(paths.modelsRoot, "features.yaml"),
      `fields:
  - name: title
    type: string
    required: true
`,
      "utf8",
    );
    await fs.mkdir(path.join(paths.contentRoot, "features"), { recursive: true });

    const report = await validateCmsWorkspace(projectDir);

    expect(report.valid).toBe(true);
    expect(report.modelCount).toBe(2);
    expect(report.entryCount).toBe(2);
    expect(report.models[0]?.entryFormat).toBe("file");
    expect(report.models[0]?.sortField).toBe("order");
    expect(report.models[0]?.entries[0]?.relativePath).toBe(
      "src/content/menu/classic-mild.yaml",
    );
    expect(report.models[0]?.entries[0]?.deletePath).toBe(
      "src/content/menu/classic-mild.yaml",
    );
    expect(report.models[0]?.fields.level.type).toBe("enum");
  });

  it("scaffolds new entries into legacy flat-file collections", async () => {
    const projectDir = await createTempProjectDir();
    tempDirs.push(projectDir);

    await scaffoldCmsWorkspace(projectDir);
    const paths = getCmsPaths(projectDir);
    await fs.writeFile(
      paths.rootConfigPath,
      `version: 1
defaultLocale: en
locales:
  - en
models:
  - menu
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(paths.modelsRoot, "menu.yaml"),
      `fields:
  - name: name
    type: string
    required: true
  - name: order
    type: number
    default: 0
`,
      "utf8",
    );
    await fs.mkdir(path.join(paths.contentRoot, "menu"), { recursive: true });

    const result = await scaffoldCmsEntry(projectDir, "menu", "sunny-pesto");

    expect(result.created).toContain("src/content/menu/sunny-pesto.yaml");
    expect(
      await fs.readFile(path.join(paths.contentRoot, "menu", "sunny-pesto.yaml"), "utf8"),
    ).toContain("order: 0");
    expect(await validateCmsWorkspace(projectDir)).toMatchObject({
      valid: true,
      entryCount: 1,
    });
  });
});
