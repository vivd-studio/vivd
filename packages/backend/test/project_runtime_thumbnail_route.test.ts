import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkOrganizationAccessMock,
  getProjectVersionMock,
  getVersionDirMock,
  createS3ClientMock,
  getObjectBufferMock,
  getObjectStorageConfigFromEnvMock,
} = vi.hoisted(() => ({
  checkOrganizationAccessMock: vi.fn(),
  getProjectVersionMock: vi.fn(),
  getVersionDirMock: vi.fn(),
  createS3ClientMock: vi.fn(),
  getObjectBufferMock: vi.fn(),
  getObjectStorageConfigFromEnvMock: vi.fn(),
}));

vi.mock("../src/lib/organizationAccess", () => ({
  checkOrganizationAccess: checkOrganizationAccessMock,
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    getProjectVersion: getProjectVersionMock,
  },
}));

vi.mock("../src/generator/versionUtils", () => ({
  getVersionDir: getVersionDirMock,
}));

vi.mock("../src/services/project/ProjectArtifactStateService", () => ({
  downloadArtifactToDirectory: vi.fn(),
  getArtifactStorageConfig: vi.fn(),
  resolvePublishableArtifactState: vi.fn(),
}));

vi.mock("../src/services/project/BuildService", () => ({
  buildService: {
    getBuildPath: vi.fn(),
    getBuildStatus: vi.fn(),
  },
}));

vi.mock("../src/services/storage/ObjectStorageService", () => ({
  createS3Client: createS3ClientMock,
  getObjectBuffer: getObjectBufferMock,
  getObjectStorageConfigFromEnv: getObjectStorageConfigFromEnvMock,
}));

import { createProjectRuntimeRouter } from "../src/httpRoutes/projectRuntime";

describe("project runtime thumbnail route", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    checkOrganizationAccessMock.mockReset();
    getProjectVersionMock.mockReset();
    getVersionDirMock.mockReset();
    createS3ClientMock.mockReset();
    getObjectBufferMock.mockReset();
    getObjectStorageConfigFromEnvMock.mockReset();

    checkOrganizationAccessMock.mockResolvedValue({ ok: true });
    getObjectStorageConfigFromEnvMock.mockReturnValue({
      bucket: "vivd",
      endpointUrl: "http://minio:9000",
      region: "us-east-1",
      accessKeyId: "local-access",
      secretAccessKey: "local-secret",
      sessionToken: undefined,
    });
  });

  afterEach(async () => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("streams the requested thumbnail through the backend and aligns stale slug keys", async () => {
    const session = { user: { id: "user-1" } };
    const fakeClient = { name: "s3-client" };
    const thumbnailBuffer = Buffer.from("webp-bytes");
    const enforceProjectAccess = vi.fn().mockResolvedValue(true);

    createS3ClientMock.mockReturnValue(fakeClient);
    getProjectVersionMock.mockResolvedValue({
      thumbnailKey:
        "tenants/default/projects/old-slug/v1/thumbnails/thumbnail.webp",
    });
    getObjectBufferMock.mockResolvedValue({
      buffer: thumbnailBuffer,
      contentType: "image/webp",
    });

    const router = createProjectRuntimeRouter({
      upload: {
        array: () => (_req, _res, next) => next(),
      },
      createContext: async () => ({
        session,
        organizationId: "default",
      }),
      enforceProjectAccess,
    });
    const thumbnailLayer = router.stack.find(
      (layer: any) =>
        layer.route?.path === "/vivd-studio/api/projects/:slug/v:version/thumbnail",
    );
    const thumbnailHandler = thumbnailLayer?.route?.stack?.[0]?.handle;
    if (!thumbnailHandler) {
      throw new Error("Expected thumbnail route handler");
    }

    const req = {
      method: "GET",
      path: "/felix-pahlke/v1/thumbnail",
      params: {
        slug: "felix-pahlke",
        version: "1",
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as any;

    await thumbnailHandler(req, res, vi.fn());

    expect(res.type).toHaveBeenCalledWith("image/webp");
    expect(res.send).toHaveBeenCalledWith(thumbnailBuffer);
    expect(checkOrganizationAccessMock).toHaveBeenCalledWith({
      session,
      organizationId: "default",
    });
    expect(enforceProjectAccess).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      session,
      "default",
      "felix-pahlke",
    );
    expect(getObjectBufferMock).toHaveBeenCalledWith({
      client: fakeClient,
      bucket: "vivd",
      key: "tenants/default/projects/felix-pahlke/v1/thumbnails/thumbnail.webp",
    });
  });

  it("serves hidden .vivd files through the authenticated project file route", async () => {
    const session = { user: { id: "user-1" } };
    const enforceProjectAccess = vi.fn().mockResolvedValue(true);
    const versionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vivd-project-runtime-projects-"),
    );
    tempDirs.push(versionDir);

    const relativePath = ".vivd/uploads/hero.webp";
    const fullPath = path.join(versionDir, ".vivd", "uploads", "hero.webp");
    const fileBuffer = Buffer.from("webp-bytes");
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, fileBuffer);
    getVersionDirMock.mockReturnValue(versionDir);

    const router = createProjectRuntimeRouter({
      upload: {
        array: () => (_req, _res, next) => next(),
      },
      createContext: async () => ({
        session,
        organizationId: "default",
      }),
      enforceProjectAccess,
    });
    const projectLayer = router.stack.find(
      (layer: any) =>
        !layer.route &&
        Array.isArray(layer.matchers) &&
        layer.matchers.some((matcher: (pathname: string) => unknown) =>
          Boolean(matcher("/vivd-studio/api/projects/felix-pahlke/v1")),
        ),
    );
    if (!projectLayer) {
      throw new Error("Expected project file route layer");
    }

    const req = {
      method: "GET",
      path: "/felix-pahlke/v1",
      query: { path: relativePath },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      sendFile: vi.fn(),
      type: vi.fn(),
    } as any;

    await projectLayer.handle(req, res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.type).not.toHaveBeenCalled();
    expect(res.sendFile).toHaveBeenCalledWith(fullPath, {
      dotfiles: "allow",
    });
    expect(enforceProjectAccess).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      session,
      "default",
      "felix-pahlke",
    );
  });

  it("serves hidden .vivd files through the authenticated asset file route", async () => {
    const session = { user: { id: "user-1" } };
    const enforceProjectAccess = vi.fn().mockResolvedValue(true);
    const versionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vivd-project-runtime-assets-"),
    );
    tempDirs.push(versionDir);

    const relativePath = ".vivd/uploads/hero.webp";
    const fullPath = path.join(versionDir, ".vivd", "uploads", "hero.webp");
    const fileBuffer = Buffer.from("webp-bytes");
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, fileBuffer);
    getVersionDirMock.mockReturnValue(versionDir);

    const router = createProjectRuntimeRouter({
      upload: {
        array: () => (_req, _res, next) => next(),
      },
      createContext: async () => ({
        session,
        organizationId: "default",
      }),
      enforceProjectAccess,
    });
    const assetLayer = router.stack.find(
      (layer: any) =>
        !layer.route &&
        Array.isArray(layer.matchers) &&
        layer.matchers.some((matcher: (pathname: string) => unknown) =>
          Boolean(matcher("/vivd-studio/api/assets/felix-pahlke/1")),
        ),
    );
    if (!assetLayer) {
      throw new Error("Expected asset file route layer");
    }

    const req = {
      method: "GET",
      path: "/felix-pahlke/1",
      query: { path: relativePath },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      sendFile: vi.fn(),
      type: vi.fn(),
    } as any;

    await assetLayer.handle(req, res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.type).not.toHaveBeenCalled();
    expect(res.sendFile).toHaveBeenCalledWith(fullPath, {
      dotfiles: "allow",
    });
    expect(enforceProjectAccess).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      session,
      "default",
      "felix-pahlke",
    );
  });
});
