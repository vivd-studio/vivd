import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getManifestMock,
  getCurrentVersionMock,
  getVersionDataMock,
  setProjectVersionStatusMock,
} = vi.hoisted(() => ({
  getManifestMock: vi.fn(),
  getCurrentVersionMock: vi.fn(),
  getVersionDataMock: vi.fn(),
  setProjectVersionStatusMock: vi.fn(),
}));

vi.mock("../src/generator/versionUtils", () => ({
  getManifest: getManifestMock,
  getCurrentVersion: getCurrentVersionMock,
  getVersionData: getVersionDataMock,
}));

vi.mock("../src/services/project/ProjectStatusService", () => ({
  setProjectVersionStatus: setProjectVersionStatusMock,
}));

import { projectStatusOverrideService } from "../src/services/project/ProjectStatusOverrideService";

describe("projectStatusOverrideService", () => {
  beforeEach(() => {
    getManifestMock.mockReset();
    getCurrentVersionMock.mockReset();
    getVersionDataMock.mockReset();
    setProjectVersionStatusMock.mockReset();

    getManifestMock.mockResolvedValue({
      source: "scratch",
      url: "",
      versions: [],
      createdAt: new Date().toISOString(),
      currentVersion: 1,
      publicPreviewEnabled: true,
    });
    getCurrentVersionMock.mockResolvedValue(1);
    getVersionDataMock.mockResolvedValue({
      source: "scratch",
      status: "generating_initial_site",
      version: 1,
      url: "",
      createdAt: new Date().toISOString(),
    });
    setProjectVersionStatusMock.mockResolvedValue(undefined);
  });

  it("maps scratch overrides to the low-level status sync and uses a paused default message", async () => {
    await expect(
      projectStatusOverrideService.setVersionStatus({
        organizationId: "org-1",
        slug: "horse-tinder",
        version: 1,
        status: "initial_generation_paused",
      }),
    ).resolves.toMatchObject({
      success: true,
      slug: "horse-tinder",
      version: 1,
      previousStatus: "generating_initial_site",
      newStatus: "initial_generation_paused",
    });

    expect(setProjectVersionStatusMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "horse-tinder",
      version: 1,
      status: "initial_generation_paused",
      errorMessage: "Initial generation was paused by an organization admin.",
    });
  });

  it("rejects paused overrides for non-scratch projects", async () => {
    getManifestMock.mockResolvedValueOnce({
      source: "url",
      url: "https://example.com",
      versions: [],
      createdAt: new Date().toISOString(),
      currentVersion: 1,
      publicPreviewEnabled: true,
    });
    getVersionDataMock.mockResolvedValueOnce({
      source: "url",
      status: "failed",
      version: 1,
      url: "https://example.com",
      createdAt: new Date().toISOString(),
    });

    await expect(
      projectStatusOverrideService.setVersionStatus({
        organizationId: "org-1",
        slug: "site-1",
        version: 1,
        status: "initial_generation_paused",
      }),
    ).rejects.toThrow(
      "Only scratch projects can be set to an initial-generation paused status.",
    );

    expect(setProjectVersionStatusMock).not.toHaveBeenCalled();
  });
});
