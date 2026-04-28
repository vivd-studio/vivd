import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createContextMock,
  checkOrganizationAccessMock,
  getProjectMock,
  createProjectVersionMock,
  deleteProjectVersionMock,
  updateVersionStatusMock,
  initializeGitRepositoryMock,
  uploadProjectSourceToBucketMock,
  uploadProjectPreviewToBucketMock,
  detectProjectTypeMock,
  buildSyncMock,
  getCurrentCommitMock,
  ensureReferencedAstroCmsToolkitMock,
  ensureVivdInternalFilesDirMock,
  extractZipMock,
} = vi.hoisted(() => ({
  createContextMock: vi.fn(),
  checkOrganizationAccessMock: vi.fn(),
  getProjectMock: vi.fn(),
  createProjectVersionMock: vi.fn(),
  deleteProjectVersionMock: vi.fn(),
  updateVersionStatusMock: vi.fn(),
  initializeGitRepositoryMock: vi.fn(),
  uploadProjectSourceToBucketMock: vi.fn(),
  uploadProjectPreviewToBucketMock: vi.fn(),
  detectProjectTypeMock: vi.fn(),
  buildSyncMock: vi.fn(),
  getCurrentCommitMock: vi.fn(),
  ensureReferencedAstroCmsToolkitMock: vi.fn(),
  ensureVivdInternalFilesDirMock: vi.fn(),
  extractZipMock: vi.fn(),
}));

vi.mock("../src/trpc", () => ({
  createContext: createContextMock,
}));

vi.mock("../src/lib/organizationAccess", () => ({
  checkOrganizationAccess: checkOrganizationAccessMock,
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    getProject: getProjectMock,
    createProjectVersion: createProjectVersionMock,
    deleteProjectVersion: deleteProjectVersionMock,
    updateVersionStatus: updateVersionStatusMock,
  },
}));

vi.mock("../src/generator/versionUtils", () => ({
  getProjectDir: (organizationId: string, slug: string) =>
    `/tmp/vivd-import-test/${organizationId}/${slug}`,
  getVersionDir: (organizationId: string, slug: string, version: number) =>
    `/tmp/vivd-import-test/${organizationId}/${slug}/v${version}`,
}));

vi.mock("../src/generator/gitUtils", () => ({
  initializeGitRepository: initializeGitRepositoryMock,
}));

vi.mock("../src/generator/vivdPaths", () => ({
  ensureVivdInternalFilesDir: ensureVivdInternalFilesDirMock,
}));

vi.mock("../src/services/project/ProjectArtifactsService", () => ({
  uploadProjectSourceToBucket: uploadProjectSourceToBucketMock,
  uploadProjectPreviewToBucket: uploadProjectPreviewToBucketMock,
}));

vi.mock("../src/devserver/projectType", () => ({
  detectProjectType: detectProjectTypeMock,
}));

vi.mock("../src/services/project/BuildService", () => ({
  buildService: {
    buildSync: buildSyncMock,
  },
}));

vi.mock("../src/services/integrations/GitService", () => ({
  gitService: {
    getCurrentCommit: getCurrentCommitMock,
  },
}));

vi.mock("@vivd/shared/cms", () => ({
  ensureReferencedAstroCmsToolkit: ensureReferencedAstroCmsToolkitMock,
}));

vi.mock("extract-zip", () => ({
  default: extractZipMock,
}));

import { createImportRouter } from "../src/httpRoutes/import";

type TestResponse = {
  statusCode: number;
  body: any;
  status: (code: number) => TestResponse;
  json: (body: unknown) => TestResponse;
};

function makeResponse(): TestResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

function getImportHandler(options?: { uploadError?: unknown; maxFileSizeMb?: number }) {
  const router = createImportRouter({
    auth: {
      api: {
        getSession: async () => null,
      },
    },
    upload: {
      single: () => (_req: any, _res: any, next: (err?: unknown) => void) =>
        next(options?.uploadError),
    } as any,
    maxFileSizeMb: options?.maxFileSizeMb,
  });

  const routeLayer = (router as any).stack.find(
    (layer: any) => layer.route?.path === "/import" && layer.route.methods.post,
  );
  if (!routeLayer) {
    throw new Error("Could not locate /import handler");
  }

  return routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
}

describe("import route safety checks", () => {
  beforeEach(() => {
    fs.rmSync("/tmp/vivd-import-test", { recursive: true, force: true });

    createContextMock.mockReset();
    checkOrganizationAccessMock.mockReset();
    getProjectMock.mockReset();
    createProjectVersionMock.mockReset();
    deleteProjectVersionMock.mockReset();
    updateVersionStatusMock.mockReset();
    initializeGitRepositoryMock.mockReset();
    uploadProjectSourceToBucketMock.mockReset();
    uploadProjectPreviewToBucketMock.mockReset();
    detectProjectTypeMock.mockReset();
    buildSyncMock.mockReset();
    getCurrentCommitMock.mockReset();
    ensureReferencedAstroCmsToolkitMock.mockReset();
    ensureVivdInternalFilesDirMock.mockReset();
    extractZipMock.mockReset();

    createContextMock.mockResolvedValue({
      session: {
        user: {
          id: "user-1",
          role: "admin",
        },
      },
      organizationId: "org-1",
      hostOrganizationId: null,
    });
    checkOrganizationAccessMock.mockResolvedValue({
      ok: true,
      isSuperAdmin: false,
      organizationRole: "admin",
    });
    getProjectMock.mockResolvedValue(null);
    detectProjectTypeMock.mockReturnValue({
      framework: "generic",
      packageManager: "npm",
    });
    ensureReferencedAstroCmsToolkitMock.mockResolvedValue(null);
    getCurrentCommitMock.mockResolvedValue("commit-1");
    extractZipMock.mockResolvedValue(undefined);
    deleteProjectVersionMock.mockResolvedValue(undefined);
    updateVersionStatusMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync("/tmp/vivd-import-test", { recursive: true, force: true });
    delete process.env.VIVD_S3_BUCKET;
  });

  it("rejects organization override when host is pinned to a different org", async () => {
    createContextMock.mockResolvedValueOnce({
      session: {
        user: {
          id: "user-1",
          role: "admin",
        },
      },
      organizationId: "org-1",
      hostOrganizationId: "org-1",
    });
    const handler = getImportHandler();
    const req = {
      query: {
        organizationId: "org-2",
      },
      body: {},
      file: undefined,
      headers: {},
    } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "Organization selection is pinned to this domain",
    });
    expect(checkOrganizationAccessMock).not.toHaveBeenCalled();
  });

  it("accepts non-slug organization IDs in import override query", async () => {
    const handler = getImportHandler();
    const req = {
      query: {
        organizationId: "Org_A2",
      },
      body: {},
      headers: {},
      file: undefined,
    } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(checkOrganizationAccessMock).toHaveBeenCalledWith({
      session: {
        user: {
          id: "user-1",
          role: "admin",
        },
      },
      organizationId: "Org_A2",
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Missing file" });
  });

  it("rejects imported ZIP archives that contain symlinks", async () => {
    extractZipMock.mockImplementationOnce(
      async (_zipPath: string, options: { dir: string }) => {
        const siteDir = path.join(options.dir, "site");
        fs.mkdirSync(siteDir, { recursive: true });
        fs.writeFileSync(path.join(siteDir, "index.html"), "<html></html>", "utf-8");
        fs.symlinkSync("index.html", path.join(siteDir, "linked.html"));
      },
    );

    const handler = getImportHandler();
    const req = {
      query: {},
      body: {},
      headers: {},
      file: {
        originalname: "site.zip",
        buffer: Buffer.from("fake-zip"),
      },
    } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "Invalid ZIP: symbolic links are not supported",
    });
    expect(createProjectVersionMock).not.toHaveBeenCalled();
    expect(uploadProjectSourceToBucketMock).not.toHaveBeenCalled();
  });

  it("returns a clear error when the ZIP exceeds the configured upload limit", async () => {
    const handler = getImportHandler({
      uploadError: { code: "LIMIT_FILE_SIZE" },
      maxFileSizeMb: 250,
    });
    const req = {
      query: {},
      body: {},
      headers: {},
    } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({
      error: "ZIP file is too large. Maximum size is 250MB.",
    });
    expect(createContextMock).not.toHaveBeenCalled();
  });

  it("marks the project version failed when artifact sync fails after the project row was created", async () => {
    extractZipMock.mockImplementationOnce(
      async (_zipPath: string, options: { dir: string }) => {
        const siteDir = path.join(options.dir, "site");
        fs.mkdirSync(siteDir, { recursive: true });
        fs.writeFileSync(path.join(siteDir, "index.html"), "<html></html>", "utf-8");
      },
    );
    uploadProjectSourceToBucketMock.mockRejectedValueOnce(new Error("bucket write failed"));

    const handler = getImportHandler();
    const req = {
      query: {},
      body: {},
      headers: {},
      file: {
        originalname: "site.zip",
        buffer: Buffer.from("fake-zip"),
      },
    } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error:
        "Import failed after the project was created. The project was kept with failed status.",
      slug: "site",
      version: 1,
    });
    expect(createProjectVersionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        slug: "site",
        version: 1,
        status: "importing_zip",
      }),
    );
    expect(updateVersionStatusMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "site",
      version: 1,
      status: "failed",
      errorMessage: "bucket write failed",
    });
    expect(deleteProjectVersionMock).not.toHaveBeenCalled();
  });

  it("drops imported runtime artifacts before saving source files", async () => {
    extractZipMock.mockImplementationOnce(
      async (_zipPath: string, options: { dir: string }) => {
        const siteDir = path.join(options.dir, "site");
        fs.mkdirSync(path.join(siteDir, "node_modules", "left-pad"), {
          recursive: true,
        });
        fs.mkdirSync(path.join(siteDir, ".git", "objects"), { recursive: true });
        fs.mkdirSync(path.join(siteDir, ".astro"), { recursive: true });
        fs.writeFileSync(path.join(siteDir, "index.html"), "<html></html>", "utf-8");
      },
    );

    const handler = getImportHandler();
    const req = {
      query: {},
      body: {},
      headers: {},
      file: {
        originalname: "site.zip",
        buffer: Buffer.from("fake-zip"),
      },
    } as any;
    const res = makeResponse();

    await handler(req, res);

    const versionDir = "/tmp/vivd-import-test/org-1/site/v1";
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(versionDir, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(versionDir, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(versionDir, ".astro"))).toBe(false);
    expect(updateVersionStatusMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "site",
      version: 1,
      status: "completed",
    });
  });

  it("repairs referenced Astro CMS helpers before uploading imported Astro source", async () => {
    extractZipMock.mockImplementationOnce(
      async (_zipPath: string, options: { dir: string }) => {
        const siteDir = path.join(options.dir, "site");
        fs.mkdirSync(path.join(siteDir, "src", "pages"), { recursive: true });
        fs.writeFileSync(
          path.join(siteDir, "package.json"),
          JSON.stringify({ name: "site", scripts: { dev: "astro dev" } }),
          "utf-8",
        );
        fs.writeFileSync(path.join(siteDir, "astro.config.mjs"), "export default {};\n", "utf-8");
        fs.writeFileSync(
          path.join(siteDir, "src", "pages", "produkte.astro"),
          "import CmsText from '../lib/cms/CmsText.astro';\n",
          "utf-8",
        );
      },
    );
    detectProjectTypeMock.mockReturnValue({
      framework: "astro",
      packageManager: "npm",
    });
    ensureReferencedAstroCmsToolkitMock.mockResolvedValue({
      created: ["src/lib/cmsBindings.ts"],
      skipped: [],
      paths: {} as any,
    });
    buildSyncMock.mockResolvedValue("/tmp/vivd-import-test/org-1/site/v1/dist");

    const handler = getImportHandler();
    const req = {
      query: {},
      body: {},
      headers: {},
      file: {
        originalname: "site.zip",
        buffer: Buffer.from("fake-zip"),
      },
    } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(ensureReferencedAstroCmsToolkitMock).toHaveBeenCalledWith(
      "/tmp/vivd-import-test/org-1/site/v1",
    );
    expect(uploadProjectSourceToBucketMock).toHaveBeenCalledOnce();
    expect(
      ensureReferencedAstroCmsToolkitMock.mock.invocationCallOrder[0],
    ).toBeLessThan(uploadProjectSourceToBucketMock.mock.invocationCallOrder[0]!);
    expect(updateVersionStatusMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "site",
      version: 1,
      status: "completed",
    });
  });
});
