import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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
    expect(entryResult.created).toContain("src/content/products/alpine-boot.yaml");
    expect(report.valid).toBe(true);
    expect(report.initialized).toBe(true);
    expect(report.modelCount).toBe(1);
    expect(report.entryCount).toBe(1);
    expect(report.errors).toEqual([]);
  });

  it("inspects Astro Content Collections directly from src/content.config.ts", async () => {
    const projectDir = await createTempProjectDir();
    tempDirs.push(projectDir);

    await fs.mkdir(path.join(projectDir, "src", "content", "blog"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "src", "content", "media", "blog"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectDir, "src", "content.config.ts"),
      `import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      status: z.enum(["active", "inactive"]).optional(),
      order: z.number().optional(),
      hero: image().optional(),
    }),
});

export const collections = { blog };
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(projectDir, "src", "content", "blog", "welcome.yaml"),
      `title: Welcome
status: active
order: 2
hero: ../media/blog/hero.jpg
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(projectDir, "src", "content", "media", "blog", "hero.jpg"),
      "hero",
      "utf8",
    );

    const report = await validateCmsWorkspace(projectDir);

    expect(report.sourceKind).toBe("astro-collections");
    expect(report.initialized).toBe(true);
    expect(report.valid).toBe(true);
    expect(report.modelCount).toBe(1);
    expect(report.entryCount).toBe(1);
    expect(report.assetCount).toBe(1);
    expect(report.models[0]?.key).toBe("blog");
    expect(report.models[0]?.relativeSchemaPath).toBe("src/content.config.ts");
    expect(report.models[0]?.fields.hero).toMatchObject({
      type: "asset",
      accepts: ["image/*"],
      required: false,
    });
    expect(report.models[0]?.entries[0]?.relativePath).toBe("src/content/blog/welcome.yaml");
    expect(report.models[0]?.entries[0]?.values).toMatchObject({
      title: "Welcome",
      status: "active",
      order: 2,
      hero: "../media/blog/hero.jpg",
    });
  });

  it("promotes obvious string-based Astro image fields back to asset UI metadata", async () => {
    const projectDir = await createTempProjectDir();
    tempDirs.push(projectDir);

    await fs.mkdir(path.join(projectDir, "src", "content", "team"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "src", "content", "media", "team"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectDir, "src", "content.config.ts"),
      `import { defineCollection, z } from "astro:content";

const team = defineCollection({
  schema: z.object({
    name: z.string(),
    profileImage: z.string().optional(),
    galleryImages: z.array(z.string()).optional(),
  }),
});

export const collections = { team };
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(projectDir, "src", "content", "team", "apollo.yaml"),
      `name: Apollo
profileImage: ../media/team/apollo.webp
galleryImages:
  - ../media/team/apollo-1.webp
  - ../media/team/apollo-2.webp
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(projectDir, "src", "content", "media", "team", "apollo.webp"),
      "hero",
      "utf8",
    );
    await fs.writeFile(
      path.join(projectDir, "src", "content", "media", "team", "apollo-1.webp"),
      "gallery-1",
      "utf8",
    );
    await fs.writeFile(
      path.join(projectDir, "src", "content", "media", "team", "apollo-2.webp"),
      "gallery-2",
      "utf8",
    );

    const report = await validateCmsWorkspace(projectDir);

    expect(report.valid).toBe(true);
    expect(report.models[0]?.fields.profileImage).toMatchObject({
      type: "asset",
      accepts: ["image/*"],
    });
    expect(report.models[0]?.fields.galleryImages).toMatchObject({
      type: "assetList",
      accepts: ["image/*"],
    });
    expect(report.assetCount).toBe(3);
  });

  it("preserves Astro reference target metadata for structured CMS editing", async () => {
    const projectDir = await createTempProjectDir();
    tempDirs.push(projectDir);

    await fs.mkdir(path.join(projectDir, "src", "content", "posts"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "src", "content.config.ts"),
      `import { defineCollection, reference, z } from "astro:content";

const posts = defineCollection({
  schema: z.object({
    title: z.string(),
    author: reference("authors").optional(),
  }),
});

export const collections = { posts };
`,
      "utf8",
    );

    const report = await validateCmsWorkspace(projectDir);

    expect(report.models[0]?.fields.author).toMatchObject({
      type: "reference",
      referenceModelKey: "authors",
      required: false,
    });
  });

  it("reports missing src/content.config.ts for Astro projects before falling back to legacy YAML scaffolding", async () => {
    const projectDir = await createTempProjectDir();
    tempDirs.push(projectDir);

    await fs.writeFile(path.join(projectDir, "astro.config.mjs"), "export default {};\n", "utf8");

    const report = await validateCmsWorkspace(projectDir);

    expect(report.sourceKind).toBe("astro-collections");
    expect(report.initialized).toBe(false);
    expect(report.valid).toBe(false);
    expect(report.errors[0]).toContain("src/content.config.ts");
    await expect(scaffoldCmsWorkspace(projectDir)).rejects.toThrow("Astro-backed projects now use");
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
  path: ./products
  entryFormat: file
entry:
  fields:
    broken:
      type: made_up_type
    heroImage:
      type: asset
`,
      "utf8",
    );
    await fs.mkdir(path.join(paths.contentRoot, "products"), { recursive: true });
    await fs.writeFile(
      path.join(paths.contentRoot, "products", "alpine-boot.yaml"),
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

  it("accepts flat collection layouts and legacy field-list schemas", async () => {
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
      `label: Menu
fields:
  - name: name
    type: string
    required: true
`,
      "utf8",
    );
    await fs.mkdir(path.join(paths.contentRoot, "menu"), { recursive: true });
    await fs.writeFile(
      path.join(paths.contentRoot, "menu", "classic-mild.yaml"),
      `name: Classic Mild
`,
      "utf8",
    );

    const report = await validateCmsWorkspace(projectDir);

    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.modelCount).toBe(1);
    expect(report.entryCount).toBe(1);
  });

});
