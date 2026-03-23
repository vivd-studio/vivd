import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkOrganizationAccessMock,
  getProjectVersionMock,
  createS3ClientMock,
  getObjectBufferMock,
  getObjectStorageConfigFromEnvMock,
} = vi.hoisted(() => ({
  checkOrganizationAccessMock: vi.fn(),
  getProjectVersionMock: vi.fn(),
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

async function listen(app: express.Express): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  const server = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

describe("project runtime thumbnail route", () => {
  let closeServer: (() => Promise<void>) | null = null;

  beforeEach(() => {
    checkOrganizationAccessMock.mockReset();
    getProjectVersionMock.mockReset();
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
    if (closeServer) {
      await closeServer();
      closeServer = null;
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

    const app = express();
    app.use(
      createProjectRuntimeRouter({
        upload: {
          array: () => (_req, _res, next) => next(),
        },
        createContext: async () => ({
          session,
          organizationId: "default",
        }),
        enforceProjectAccess,
      }),
    );

    const server = await listen(app);
    closeServer = server.close;

    const response = await fetch(
      `${server.url}/vivd-studio/api/projects/felix-pahlke/v1/thumbnail`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/webp");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(thumbnailBuffer);
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
});
