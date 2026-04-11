import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc/context.js";

const { touchMock, requestBucketSyncMock } = vi.hoisted(() => ({
  touchMock: vi.fn(),
  requestBucketSyncMock: vi.fn(() => true),
}));

vi.mock("../services/reporting/ProjectTouchReporter.js", () => ({
  projectTouchReporter: {
    touch: touchMock,
  },
}));

vi.mock("../services/sync/AgentTaskSyncService.js", () => ({
  requestBucketSync: requestBucketSyncMock,
}));

import { cmsRouter } from "./cms.js";

function makeContext(projectDir: string): Context {
  return {
    workspace: {
      isInitialized: vi.fn(() => true),
      getProjectPath: vi.fn(() => projectDir),
    } as unknown as Context["workspace"],
  };
}

describe("cms router", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-cms-router-"));
    touchMock.mockReset();
    requestBucketSyncMock.mockReset();
    requestBucketSyncMock.mockReturnValue(true);
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it("initializes the CMS workspace and builds empty artifacts", async () => {
    const caller = cmsRouter.createCaller(makeContext(projectDir));

    const result = await caller.init({
      slug: "demo-site",
      version: 1,
    });

    expect(result.report.initialized).toBe(true);
    expect(result.report.valid).toBe(true);
    expect(result.built).toBe(false);
    expect(result.validationOnly).toBe(true);
    await expect(
      fs.stat(path.join(projectDir, "src/content/vivd.content.yaml")),
    ).resolves.toBeDefined();
    expect(touchMock).toHaveBeenCalledWith("demo-site");
    expect(requestBucketSyncMock).toHaveBeenCalledWith("cms-initialized", {
      slug: "demo-site",
      version: 1,
    });
  });

  it("scaffolds a model and entry and returns them in status order", async () => {
    const caller = cmsRouter.createCaller(makeContext(projectDir));

    await caller.init({ slug: "demo-site", version: 1 });
    await caller.scaffoldModel({
      slug: "demo-site",
      version: 1,
      modelKey: "products",
    });
    const result = await caller.scaffoldEntry({
      slug: "demo-site",
      version: 1,
      modelKey: "products",
      entryKey: "alpine-boot",
    });

    expect(result.report.valid).toBe(true);
    expect(result.built).toBe(false);
    expect(result.validationOnly).toBe(true);
    expect(result.report.models).toHaveLength(1);
    expect(result.report.models[0]?.key).toBe("products");
    expect(result.report.models[0]?.entries[0]?.key).toBe("alpine-boot");
    expect(result.report.models[0]?.entries[0]?.values).toMatchObject({
      slug: "alpine-boot",
      status: "active",
      sortOrder: 0,
      title: {
        en: "Alpine Boot",
      },
    });
  });

  it("reports Astro collections as the source of truth and blocks legacy init", async () => {
    await fs.mkdir(path.join(projectDir, "src", "content", "blog"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "src", "content.config.ts"),
      `import { defineCollection, z } from "astro:content";

export const collections = {
  blog: defineCollection({
    schema: z.object({
      title: z.string(),
    }),
  }),
};
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(projectDir, "src", "content", "blog", "welcome.yaml"),
      "title: Welcome\n",
      "utf8",
    );

    const caller = cmsRouter.createCaller(makeContext(projectDir));
    const status = await caller.status();

    expect(status.sourceKind).toBe("astro-collections");
    expect(status.initialized).toBe(true);
    expect(status.valid).toBe(true);
    expect(status.modelCount).toBe(1);
    expect(status.entryCount).toBe(1);
    await expect(
      caller.init({
        slug: "demo-site",
        version: 1,
      }),
    ).rejects.toThrow("Astro-backed projects now use");
  });

  it("creates Astro collection models in src/content.config.ts through the structured CMS path", async () => {
    await fs.mkdir(path.join(projectDir, "src", "content", "media"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "src", "content.config.ts"),
      "export const collections = {};\n",
      "utf8",
    );

    const caller = cmsRouter.createCaller(makeContext(projectDir));
    const result = await caller.scaffoldModel({
      slug: "demo-site",
      version: 1,
      modelKey: "blog",
    });

    expect(result.report.sourceKind).toBe("astro-collections");
    expect(result.report.valid).toBe(true);
    expect(result.report.modelCount).toBe(1);
    expect(result.report.models[0]?.key).toBe("blog");
    await expect(
      fs.readFile(path.join(projectDir, "src", "content.config.ts"), "utf8"),
    ).resolves.toContain("blog: defineCollection({");
    await expect(
      fs.readFile(path.join(projectDir, "src", "content.config.ts"), "utf8"),
    ).resolves.toContain("title: z.string(),");
    await expect(
      fs.stat(path.join(projectDir, "src", "content", "blog", ".gitkeep")),
    ).resolves.toBeDefined();
    expect(requestBucketSyncMock).toHaveBeenCalledWith("cms-model-scaffolded", {
      slug: "demo-site",
      version: 1,
    });
  });

  it("creates Astro collection entries as real collection files", async () => {
    await fs.mkdir(path.join(projectDir, "src", "content", "blog"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "src", "content.config.ts"),
      `import { defineCollection, z } from "astro:content";

export const collections = {
  blog: defineCollection({
    schema: z.object({
      slug: z.string().optional(),
      title: z.string(),
      order: z.number().optional(),
    }),
  }),
};
`,
      "utf8",
    );

    const caller = cmsRouter.createCaller(makeContext(projectDir));
    const result = await caller.createEntry({
      slug: "demo-site",
      version: 1,
      modelKey: "blog",
      entryKey: "new-post",
    });

    expect(result.created.createdEntryKey).toBe("new-post");
    expect(result.report.valid).toBe(true);
    await expect(
      fs.readFile(path.join(projectDir, "src", "content", "blog", "new-post.yaml"), "utf8"),
    ).resolves.toContain("title: New Post");
    expect(touchMock).toHaveBeenCalledWith("demo-site");
    expect(requestBucketSyncMock).toHaveBeenCalledWith("cms-entry-created", {
      slug: "demo-site",
      version: 1,
    });
  });

  it("uses Astro glob pattern hints when creating the first entry in a markdown collection", async () => {
    await fs.mkdir(path.join(projectDir, "src", "content", "notes"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "src", "content.config.ts"),
      `import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

export const collections = {
  notes: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),
    schema: z.object({
      title: z.string(),
    }),
  }),
};
`,
      "utf8",
    );

    const caller = cmsRouter.createCaller(makeContext(projectDir));
    const result = await caller.createEntry({
      slug: "demo-site",
      version: 1,
      modelKey: "notes",
      entryKey: "first-note",
    });

    expect(result.created.createdEntryRelativePath).toBe("src/content/notes/first-note.md");
    await expect(
      fs.readFile(path.join(projectDir, "src", "content", "notes", "first-note.md"), "utf8"),
    ).resolves.toContain("---");
  });

  it("updates Astro collection schemas through the structured model editor path", async () => {
    await fs.mkdir(path.join(projectDir, "src", "content", "blog"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "src", "content.config.ts"),
      `import { defineCollection, z } from "astro:content";

export const collections = {
  blog: defineCollection({
    schema: z.object({
      title: z.string(),
    }),
  }),
};
`,
      "utf8",
    );

    const caller = cmsRouter.createCaller(makeContext(projectDir));
    const result = await caller.updateModel({
      slug: "demo-site",
      version: 1,
      modelKey: "blog",
      fields: {
        title: { type: "string", required: true },
        heroImage: {
          type: "asset",
          required: false,
          description: "Primary image",
        },
        author: {
          type: "reference",
          required: false,
          referenceModelKey: "authors",
        },
      },
    });

    expect(result.report.valid).toBe(true);
    const nextConfig = await fs.readFile(path.join(projectDir, "src", "content.config.ts"), "utf8");
    expect(nextConfig).toContain('import { defineCollection, reference, z } from "astro:content";');
    expect(nextConfig).toContain("schema: ({ image }) => z.object({");
    expect(nextConfig).toContain('heroImage: image().describe("Primary image").optional(),');
    expect(nextConfig).toContain('author: reference("authors").optional(),');
    expect(requestBucketSyncMock).toHaveBeenCalledWith("cms-model-updated", {
      slug: "demo-site",
      version: 1,
    });
  });

  it("applies preview-owned CMS field updates back into Astro entry files", async () => {
    await fs.mkdir(path.join(projectDir, "src", "content", "blog"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "src", "content", "media", "blog"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectDir, "src", "content.config.ts"),
      `import { defineCollection, z } from "astro:content";

export const collections = {
  blog: defineCollection({
    schema: ({ image }) =>
      z.object({
        title: z.string(),
        heroImage: image().optional(),
      }),
  }),
};
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(projectDir, "src", "content", "blog", "welcome.yaml"),
      `title: Welcome
heroImage: ../media/blog/original.webp
`,
      "utf8",
    );

    const caller = cmsRouter.createCaller(makeContext(projectDir));
    const result = await caller.applyPreviewFieldUpdates({
      slug: "demo-site",
      version: 1,
      updates: [
        {
          modelKey: "blog",
          entryKey: "welcome",
          fieldPath: ["title"],
          value: "Updated welcome",
        },
        {
          modelKey: "blog",
          entryKey: "welcome",
          fieldPath: ["heroImage"],
          value: "src/content/media/blog/replaced.webp",
        },
      ],
    });

    expect(result.report.valid).toBe(true);
    await expect(
      fs.readFile(path.join(projectDir, "src", "content", "blog", "welcome.yaml"), "utf8"),
    ).resolves.toContain("title: Updated welcome");
    await expect(
      fs.readFile(path.join(projectDir, "src", "content", "blog", "welcome.yaml"), "utf8"),
    ).resolves.toContain("heroImage: ../media/blog/replaced.webp");
    expect(requestBucketSyncMock).toHaveBeenCalledWith("cms-preview-updated", {
      slug: "demo-site",
      version: 1,
    });
  });
});
