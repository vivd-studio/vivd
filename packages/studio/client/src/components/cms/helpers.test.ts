import type { CmsModelRecord } from "@vivd/shared/cms";
import { describe, expect, it } from "vitest";
import {
  buildStoredAssetReferencePath,
  buildRelativeReferencePath,
  deriveCmsLocales,
  buildDefaultFieldValue,
  getCmsEntryFileFormat,
  inferAssetAcceptsForValues,
  inferAssetStorageFromValue,
  inferStringFieldAssetAccepts,
  isPathInsideRoot,
  isWritableCmsEntryFile,
  resolveAssetReferencePath,
  shouldRenderImageAssetField,
  shouldRenderImageAssetListField,
  resolveRelativePath,
  serializeCmsEntryValues,
  titleizeKey,
} from "./helpers";

describe("cms helpers", () => {
  it("builds a relative asset reference from an entry file to a media file", () => {
    const entryPath = "src/content/collections/horse/apollo/index.yaml";
    const mediaPath = "src/content/media/horse/apollo/portrait.webp";

    expect(buildRelativeReferencePath(entryPath, mediaPath)).toBe(
      "../../../media/horse/apollo/portrait.webp",
    );
  });

  it("round-trips relative references through resolveRelativePath", () => {
    const entryPath = "src/content/collections/horse/apollo/index.yaml";
    const mediaPath = "src/content/media/horse/apollo/portrait.webp";
    const relativePath = buildRelativeReferencePath(entryPath, mediaPath);

    expect(resolveRelativePath(entryPath, relativePath)).toBe(mediaPath);
  });

  it("maps site-root file references to public files for Studio file access", () => {
    expect(
      resolveAssetReferencePath(
        "src/content/products/apollo.yaml",
        "/pdfs/products/apollo/safety-sheet.pdf",
      ),
    ).toBe("public/pdfs/products/apollo/safety-sheet.pdf");
  });

  it("keeps explicit public asset paths stable when resolving file references", () => {
    expect(
      resolveAssetReferencePath(
        "src/content/products/apollo.yaml",
        "public/pdfs/products/apollo/safety-sheet.pdf",
      ),
    ).toBe("public/pdfs/products/apollo/safety-sheet.pdf");
  });

  it("stores public assets as leading-slash site paths and content media as relative refs", () => {
    expect(
      buildStoredAssetReferencePath(
        "src/content/products/apollo.yaml",
        "public/pdfs/products/apollo/safety-sheet.pdf",
      ),
    ).toBe("/pdfs/products/apollo/safety-sheet.pdf");

    expect(
      buildStoredAssetReferencePath(
        "src/content/collections/horse/apollo/index.yaml",
        "src/content/media/horse/apollo/portrait.webp",
      ),
    ).toBe("../../../media/horse/apollo/portrait.webp");
  });

  it("checks whether a candidate path stays inside the CMS media root", () => {
    expect(isPathInsideRoot("src/content/media/horse/apollo/portrait.webp", "src/content/media")).toBe(
      true,
    );
    expect(isPathInsideRoot("src/content/collections/horse/apollo/index.yaml", "src/content/media")).toBe(
      false,
    );
  });

  it("detects writable Astro entry file formats", () => {
    expect(getCmsEntryFileFormat("src/content/blog/post.yaml")).toBe("yaml");
    expect(getCmsEntryFileFormat("src/content/blog/post.json")).toBe("json");
    expect(getCmsEntryFileFormat("src/content/blog/post.mdx")).toBe("markdown");
    expect(isWritableCmsEntryFile("src/content/blog/post.markdown")).toBe(true);
    expect(isWritableCmsEntryFile("src/content/blog/post.txt")).toBe(false);
  });

  it("serializes markdown entries by replacing frontmatter and preserving body", () => {
    const content = serializeCmsEntryValues(
      "src/content/blog/post.mdx",
      {
        title: "Updated",
        order: 2,
      },
      `---
title: Old
order: 1
---

# Hello

Body content.
`,
    );

    expect(content).toContain("title: Updated");
    expect(content).toContain("order: 2");
    expect(content).toContain("# Hello");
    expect(content).toContain("Body content.");
  });

  it("treats obvious string image fields as image assets in the Studio editor", () => {
    expect(
      shouldRenderImageAssetField("profileImage", { type: "string" }, ""),
    ).toBe(true);
    expect(
      shouldRenderImageAssetField(
        "hero",
        { type: "string" },
        "../media/horse/apollo/portrait.webp",
      ),
    ).toBe(true);
    expect(
      shouldRenderImageAssetField(
        "profileImage",
        { type: "string" },
        "https://cdn.example.com/avatar.webp",
      ),
    ).toBe(false);
  });

  it("infers file asset accepts for local PDF references but not bare filenames", () => {
    expect(
      inferStringFieldAssetAccepts(
        "safetySheet",
        { type: "string" },
        "/pdfs/products/apollo/safety-sheet.pdf",
      ),
    ).toEqual([".pdf", "application/pdf"]);
    expect(
      inferStringFieldAssetAccepts("fileName", { type: "string" }, "safety-sheet.pdf"),
    ).toBeNull();
  });

  it("aggregates localized file references into shared asset accepts", () => {
    expect(
      inferAssetAcceptsForValues([
        "/pdfs/products/apollo/de.pdf",
        "/pdfs/products/apollo/en.pdf",
      ]),
    ).toEqual([".pdf", "application/pdf"]);
  });

  it("infers public asset storage roots from localized public download fields", () => {
    expect(
      inferAssetStorageFromValue({
        de: "/pdfs/products/apollo/de.pdf",
        en: "/pdfs/products/apollo/en.pdf",
      }),
    ).toEqual({
      storageKind: "public",
      assetRootPath: "public/pdfs",
      defaultFolderPath: "public/pdfs/products/apollo",
    });
  });

  it("derives CMS locales from locale-shaped schema fields and localized entry values", () => {
    const model: CmsModelRecord = {
      key: "products",
      label: "Products",
      schemaPath: "/tmp/src/content.config.ts",
      relativeSchemaPath: "src/content.config.ts",
      collectionRoot: "/tmp/src/content/products",
      relativeCollectionRoot: "src/content/products",
      entryFormat: "file",
      entryFileExtension: ".yaml",
      directoryIndexEntries: false,
      sortField: null,
      fields: {
        hrefByLang: {
          type: "string",
          localized: true,
          accepts: [".pdf", "application/pdf"],
        },
        titleByLang: {
          type: "object",
          fields: {
            de: { type: "string" },
            en: { type: "string" },
          },
        },
      },
      entries: [
        {
          key: "apollo",
          filePath: "/tmp/src/content/products/apollo.yaml",
          relativePath: "src/content/products/apollo.yaml",
          deletePath: "/tmp/src/content/products/apollo.yaml",
          values: {
            hrefByLang: {
              de: "/pdfs/products/apollo/de.pdf",
              en: "/pdfs/products/apollo/en.pdf",
            },
            titleByLang: {
              de: "Gebrauchsanweisung",
              en: "Instructions for Use",
            },
          },
          slug: null,
          status: null,
          sortOrder: null,
          assetRefs: [],
        },
      ],
    };

    expect(
      deriveCmsLocales(
        {
          locales: [],
          models: [model],
        },
        "en",
      ),
    ).toEqual(["en", "de"]);
  });

  it("builds localized default values for all resolved locales", () => {
    expect(
      buildDefaultFieldValue(
        "hrefByLang",
        { type: "string", localized: true },
        "en",
        ["en", "de"],
      ),
    ).toEqual({
      en: "",
      de: "",
    });
  });

  it("treats obvious string-list image fields as image asset lists in the Studio editor", () => {
    expect(
      shouldRenderImageAssetListField(
        "galleryImages",
        { type: "list", item: { type: "string" } },
        [],
      ),
    ).toBe(true);
    expect(
      shouldRenderImageAssetListField(
        "gallery",
        { type: "list", item: { type: "string" } },
        ["../media/horse/apollo/1.webp", "../media/horse/apollo/2.webp"],
      ),
    ).toBe(true);
    expect(
      shouldRenderImageAssetListField(
        "galleryImages",
        { type: "list", item: { type: "string" } },
        ["https://cdn.example.com/1.webp"],
      ),
    ).toBe(false);
  });

  it("builds human-readable labels from camelCase field keys", () => {
    expect(titleizeKey("profileImage")).toBe("Profile Image");
    expect(titleizeKey("galleryImages")).toBe("Gallery Images");
  });
});
