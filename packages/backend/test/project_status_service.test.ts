import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getVersionDirMock, updateVersionStatusMock } = vi.hoisted(() => ({
  getVersionDirMock: vi.fn(),
  updateVersionStatusMock: vi.fn(),
}));

vi.mock("../src/generator/versionUtils", () => ({
  getVersionDir: getVersionDirMock,
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    updateVersionStatus: updateVersionStatusMock,
  },
}));

import {
  createScratchInitialGenerationManifest,
  readInitialGenerationManifest,
  writeInitialGenerationManifest,
} from "../src/generator/initialGeneration";
import { setProjectVersionStatus } from "../src/services/project/ProjectStatusService";

describe("setProjectVersionStatus", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-project-status-"));
    getVersionDirMock.mockReset();
    updateVersionStatusMock.mockReset();
    getVersionDirMock.mockReturnValue(tempDir);
    updateVersionStatusMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps the scratch initial-generation manifest in sync with a completed status", async () => {
    writeInitialGenerationManifest(
      tempDir,
      {
        ...createScratchInitialGenerationManifest({
          title: "Horse Tinder",
          description: "Scratch site",
        }),
        state: "generating_initial_site",
        sessionId: "ses_123",
        startedAt: "2026-04-09T10:00:00.000Z",
      },
    );

    await setProjectVersionStatus({
      organizationId: "org-1",
      slug: "horse-tinder",
      version: 1,
      status: "completed",
    });

    const manifest = readInitialGenerationManifest(tempDir);
    expect(manifest).not.toBeNull();
    expect(manifest?.state).toBe("completed");
    expect(manifest?.sessionId).toBe("ses_123");
    expect(manifest?.startedAt).toBe("2026-04-09T10:00:00.000Z");
    expect(manifest?.completedAt).toMatch(/^2026-04-09T/);
    expect(manifest?.errorMessage).toBeNull();

    expect(updateVersionStatusMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "horse-tinder",
      version: 1,
      status: "completed",
      errorMessage: undefined,
    });
  });

  it("writes pause metadata for scratch runs and still updates the DB status", async () => {
    writeInitialGenerationManifest(
      tempDir,
      {
        ...createScratchInitialGenerationManifest({
          title: "Horse Tinder",
          description: "Scratch site",
        }),
        state: "generating_initial_site",
        sessionId: "ses_456",
        startedAt: "2026-04-09T10:00:00.000Z",
      },
    );

    await setProjectVersionStatus({
      organizationId: "org-1",
      slug: "horse-tinder",
      version: 1,
      status: "initial_generation_paused",
      errorMessage: "Paused by admin",
    });

    const manifest = readInitialGenerationManifest(tempDir);
    expect(manifest?.state).toBe("initial_generation_paused");
    expect(manifest?.errorMessage).toBe("Paused by admin");
    expect(manifest?.completedAt).toBeNull();

    expect(updateVersionStatusMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "horse-tinder",
      version: 1,
      status: "initial_generation_paused",
      errorMessage: "Paused by admin",
    });
  });

  it("persists a running scratch session id as soon as generation starts", async () => {
    writeInitialGenerationManifest(
      tempDir,
      {
        ...createScratchInitialGenerationManifest({
          title: "Horse Tinder",
          description: "Scratch site",
        }),
        state: "starting_studio",
        sessionId: null,
        startedAt: null,
        completedAt: "2026-04-09T10:15:00.000Z",
        errorMessage: "Old failure",
      },
    );

    await setProjectVersionStatus({
      organizationId: "org-1",
      slug: "horse-tinder",
      version: 1,
      status: "generating_initial_site",
      sessionId: "ses_live_123",
    });

    const manifest = readInitialGenerationManifest(tempDir);
    expect(manifest?.state).toBe("generating_initial_site");
    expect(manifest?.sessionId).toBe("ses_live_123");
    expect(manifest?.startedAt).toMatch(/^2026-04-09T/);
    expect(manifest?.completedAt).toBeNull();
    expect(manifest?.errorMessage).toBeNull();

    expect(updateVersionStatusMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "horse-tinder",
      version: 1,
      status: "generating_initial_site",
      errorMessage: undefined,
    });
  });
});
