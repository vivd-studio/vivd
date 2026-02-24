import { describe, expect, it } from "vitest";
import {
  alignProjectArtifactKeyToSlug,
  rewriteProjectArtifactKeyForSlug,
} from "../src/services/project/slugRename";

describe("rewriteProjectArtifactKeyForSlug", () => {
  it("rewrites keys that point to the old project prefix", () => {
    const rewritten = rewriteProjectArtifactKeyForSlug({
      organizationId: "org-1",
      oldSlug: "old-slug",
      newSlug: "new-slug",
      key: "tenants/org-1/projects/old-slug/v1/thumbnails/thumbnail.webp",
    });

    expect(rewritten).toBe(
      "tenants/org-1/projects/new-slug/v1/thumbnails/thumbnail.webp",
    );
  });

  it("keeps unrelated keys unchanged", () => {
    const key = "tenants/org-1/projects/some-other-slug/v1/thumbnails/thumbnail.webp";
    const rewritten = rewriteProjectArtifactKeyForSlug({
      organizationId: "org-1",
      oldSlug: "old-slug",
      newSlug: "new-slug",
      key,
    });

    expect(rewritten).toBe(key);
  });

  it("returns null for null keys", () => {
    const rewritten = rewriteProjectArtifactKeyForSlug({
      organizationId: "org-1",
      oldSlug: "old-slug",
      newSlug: "new-slug",
      key: null,
    });

    expect(rewritten).toBeNull();
  });
});

describe("alignProjectArtifactKeyToSlug", () => {
  it("realigns project slug in keys for the same organization", () => {
    const aligned = alignProjectArtifactKeyToSlug({
      organizationId: "org-1",
      slug: "new-slug",
      key: "tenants/org-1/projects/old-slug/v1/thumbnails/thumbnail.webp",
    });

    expect(aligned).toBe(
      "tenants/org-1/projects/new-slug/v1/thumbnails/thumbnail.webp",
    );
  });

  it("keeps keys from another organization unchanged", () => {
    const key = "tenants/org-2/projects/old-slug/v1/thumbnails/thumbnail.webp";
    const aligned = alignProjectArtifactKeyToSlug({
      organizationId: "org-1",
      slug: "new-slug",
      key,
    });

    expect(aligned).toBe(key);
  });

  it("keeps malformed keys unchanged", () => {
    const key = "thumbnails/thumbnail.webp";
    const aligned = alignProjectArtifactKeyToSlug({
      organizationId: "org-1",
      slug: "new-slug",
      key,
    });

    expect(aligned).toBe(key);
  });
});
