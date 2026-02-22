import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createContextMock,
  checkOrganizationAccessMock,
  getProjectMock,
  createProjectVersionMock,
  initializeGitRepositoryMock,
  uploadProjectSourceToBucketMock,
  uploadProjectPreviewToBucketMock,
  detectProjectTypeMock,
  buildSyncMock,
  getCurrentCommitMock,
  ensureVivdInternalFilesDirMock,
  extractZipMock,
} = vi.hoisted(() => ({
  createContextMock: vi.fn(),
  checkOrganizationAccessMock: vi.fn(),
  getProjectMock: vi.fn(),
  createProjectVersionMock: vi.fn(),
  initializeGitRepositoryMock: vi.fn(),
  uploadProjectSourceToBucketMock: vi.fn(),
  uploadProjectPreviewToBucketMock: vi.fn(),
  detectProjectTypeMock: vi.fn(),
  buildSyncMock: vi.fn(),
  getCurrentCommitMock: vi.fn(),
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

function getImportHandler() {
  const router = createImportRouter({
    auth: {
      api: {
        getSession: async () => null,
      },
    },
    upload: {
      single: () => (_req: any, _res: any, next: (err?: unknown) => void) => next(),
    } as any,
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
    createContextMock.mockReset();
    checkOrganizationAccessMock.mockReset();
    getProjectMock.mockReset();
    createProjectVersionMock.mockReset();
    initializeGitRepositoryMock.mockReset();
    uploadProjectSourceToBucketMock.mockReset();
    uploadProjectPreviewToBucketMock.mockReset();
    detectProjectTypeMock.mockReset();
    buildSyncMock.mockReset();
    getCurrentCommitMock.mockReset();
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
    getCurrentCommitMock.mockResolvedValue("commit-1");
    extractZipMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
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
});
