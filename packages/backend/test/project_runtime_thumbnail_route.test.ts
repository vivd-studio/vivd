import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkOrganizationAccessMock,
  getProjectMock,
  getProjectVersionMock,
  getVersionDirMock,
  resolvePublishableArtifactStateMock,
  createS3ClientMock,
  getObjectBufferMock,
  getObjectStorageConfigFromEnvMock,
  getInternalPreviewAccessTokenMock,
} = vi.hoisted(() => ({
  checkOrganizationAccessMock: vi.fn(),
  getProjectMock: vi.fn(),
  getProjectVersionMock: vi.fn(),
  getVersionDirMock: vi.fn(),
  resolvePublishableArtifactStateMock: vi.fn(),
  createS3ClientMock: vi.fn(),
  getObjectBufferMock: vi.fn(),
  getObjectStorageConfigFromEnvMock: vi.fn(),
  getInternalPreviewAccessTokenMock: vi.fn(),
}));

vi.mock("../src/lib/organizationAccess", () => ({
  checkOrganizationAccess: checkOrganizationAccessMock,
}));

vi.mock("../src/config/preview", () => ({
  getInternalPreviewAccessToken: getInternalPreviewAccessTokenMock,
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    getProject: getProjectMock,
    getProjectVersion: getProjectVersionMock,
  },
}));

vi.mock("../src/generator/versionUtils", () => ({
  getVersionDir: getVersionDirMock,
}));

vi.mock("../src/services/project/ProjectArtifactStateService", () => ({
  downloadArtifactToDirectory: vi.fn(),
  getArtifactStorageConfig: vi.fn(),
  resolvePublishableArtifactState: resolvePublishableArtifactStateMock,
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
  const fakeClient = { send: vi.fn() };

  beforeEach(() => {
    checkOrganizationAccessMock.mockReset();
    getProjectMock.mockReset();
    getProjectVersionMock.mockReset();
    getVersionDirMock.mockReset();
    resolvePublishableArtifactStateMock.mockReset();
    createS3ClientMock.mockReset();
    getObjectBufferMock.mockReset();
    getObjectStorageConfigFromEnvMock.mockReset();
    getInternalPreviewAccessTokenMock.mockReset();

    checkOrganizationAccessMock.mockResolvedValue({ ok: true });
    getProjectMock.mockResolvedValue({
      slug: "site-1",
      publicPreviewEnabled: false,
    });
    resolvePublishableArtifactStateMock.mockResolvedValue({
      storageEnabled: true,
      readiness: "ready",
      sourceKind: "preview",
      framework: "generic",
      commitHash: "commit-1",
      builtAt: "2026-04-06T10:00:00.000Z",
      previewCommitHash: "commit-1",
      sourceCommitHash: "commit-1",
      previewBuiltAt: "2026-04-06T10:00:00.000Z",
      sourceBuiltAt: "2026-04-06T10:00:00.000Z",
      error: null,
      previewStatus: "success",
      sourceStatus: "success",
    });
    fakeClient.send.mockReset();
    createS3ClientMock.mockReturnValue(fakeClient);
    getObjectBufferMock.mockResolvedValue({
      buffer: Buffer.from("<!doctype html><html><body>preview</body></html>"),
      contentType: "text/html",
    });
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

  function createRouter(options: {
    session?: { user: { id: string } } | null;
    organizationId?: string | null;
    enforceProjectAccess?: ReturnType<typeof vi.fn>;
  } = {}) {
    const session = options.session ?? null;
    const organizationId =
      Object.prototype.hasOwnProperty.call(options, "organizationId")
        ? (options.organizationId ?? null)
        : "default";
    const enforceProjectAccess =
      options.enforceProjectAccess ?? vi.fn().mockResolvedValue(true);

    const router = createProjectRuntimeRouter({
      upload: {
        array: () => (_req, _res, next) => next(),
      },
      createContext: async () => ({
        session,
        organizationId,
      }),
      enforceProjectAccess,
    });

    return { router, enforceProjectAccess };
  }

  function getPreviewLayer(router: ReturnType<typeof createProjectRuntimeRouter>) {
    const previewLayer = router.stack.find(
      (layer: any) =>
        !layer.route &&
        Array.isArray(layer.matchers) &&
        layer.matchers.some((matcher: (pathname: string) => unknown) =>
          Boolean(matcher("/vivd-studio/api/preview/site-1/v1")),
        ),
    );

    if (!previewLayer) {
      throw new Error("Expected preview route layer");
    }

    return previewLayer;
  }

  function createPreviewRequest(options: {
    slug?: string;
    version?: string;
    url?: string;
    sessionCookie?: string;
    previewToken?: string;
    forwardedOrgId?: string;
  } = {}) {
    const headers: Record<string, string> = {};

    if (options.sessionCookie) {
      headers.cookie = options.sessionCookie;
    }

    if (options.previewToken) {
      headers["x-vivd-preview-token"] = options.previewToken;
    }

    if (options.forwardedOrgId) {
      headers["x-vivd-organization-id"] = options.forwardedOrgId;
    }

    return {
      method: "GET",
      url: options.url ?? "/",
      path: options.url ?? "/",
      params: {
        slug: options.slug ?? "site-1",
        version: options.version ?? "1",
      },
      query: {},
      headers,
      secure: true,
      aborted: false,
      get(name: string) {
        return headers[name.toLowerCase()] ?? headers[name] ?? undefined;
      },
      on: vi.fn(),
      off: vi.fn(),
    } as any;
  }

  function createPreviewResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      cookie: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      writableEnded: false,
      writableFinished: false,
      destroyed: false,
    } as any;
  }

  it("returns not found for unauthenticated private preview requests", async () => {
    getProjectMock.mockResolvedValueOnce({
      slug: "site-preview-locked",
      publicPreviewEnabled: false,
    });

    const { router, enforceProjectAccess } = createRouter({
      session: null,
    });
    const previewLayer = getPreviewLayer(router);
    const req = createPreviewRequest({
      slug: "site-preview-locked",
    });
    const res = createPreviewResponse();

    await previewLayer.handle(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Not found" });
    expect(checkOrganizationAccessMock).not.toHaveBeenCalled();
    expect(enforceProjectAccess).not.toHaveBeenCalled();
    expect(resolvePublishableArtifactStateMock).not.toHaveBeenCalled();
  });

  it("allows private preview requests for authenticated project members", async () => {
    getProjectMock.mockResolvedValueOnce({
      slug: "site-member-preview",
      publicPreviewEnabled: false,
    });

    const session = { user: { id: "user-1" } };
    const { router, enforceProjectAccess } = createRouter({
      session,
    });
    const previewLayer = getPreviewLayer(router);
    const req = createPreviewRequest({
      slug: "site-member-preview",
    });
    const res = createPreviewResponse();

    await previewLayer.handle(req, res, vi.fn());

    expect(checkOrganizationAccessMock).toHaveBeenCalledWith({
      session,
      organizationId: "default",
    });
    expect(enforceProjectAccess).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      session,
      "default",
      "site-member-preview",
    );
    expect(resolvePublishableArtifactStateMock).toHaveBeenCalledWith({
      organizationId: "default",
      slug: "site-member-preview",
      version: 1,
    });
    expect(res.type).toHaveBeenCalledWith("html");
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("preview"),
    );
  });

  it("allows private preview requests via the internal preview token and persists the cookie", async () => {
    getInternalPreviewAccessTokenMock.mockReturnValue("preview-token-1");
    getProjectMock.mockResolvedValueOnce({
      slug: "site-internal-preview",
      publicPreviewEnabled: false,
    });

    const { router, enforceProjectAccess } = createRouter({
      session: null,
    });
    const previewLayer = getPreviewLayer(router);
    const req = createPreviewRequest({
      slug: "site-internal-preview",
      previewToken: "preview-token-1",
    });
    const res = createPreviewResponse();

    await previewLayer.handle(req, res, vi.fn());

    expect(res.cookie).toHaveBeenCalledWith(
      "vivd_preview_token",
      "preview-token-1",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/vivd-studio/api/preview",
      }),
    );
    expect(checkOrganizationAccessMock).not.toHaveBeenCalled();
    expect(enforceProjectAccess).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("preview"),
    );
  });

  it("accepts the persisted internal preview cookie on follow-up requests", async () => {
    getInternalPreviewAccessTokenMock.mockReturnValue("preview-token-2");
    getProjectMock.mockResolvedValueOnce({
      slug: "site-cookie-preview",
      publicPreviewEnabled: false,
    });

    const { router, enforceProjectAccess } = createRouter({
      session: null,
    });
    const previewLayer = getPreviewLayer(router);
    const req = createPreviewRequest({
      slug: "site-cookie-preview",
      sessionCookie: "vivd_preview_token=preview-token-2",
    });
    const res = createPreviewResponse();

    await previewLayer.handle(req, res, vi.fn());

    expect(res.cookie).not.toHaveBeenCalled();
    expect(checkOrganizationAccessMock).not.toHaveBeenCalled();
    expect(enforceProjectAccess).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining("preview"),
    );
  });
});
