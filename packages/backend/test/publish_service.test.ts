import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensurePublishDomainEnabledMock,
  normalizeDomainMock,
  validateDomainForRegistryMock,
  resolvePublishableArtifactStateMock,
  downloadArtifactToDirectoryMock,
  uploadProjectPublishedToBucketMock,
} = vi.hoisted(() => ({
  ensurePublishDomainEnabledMock: vi.fn(),
  normalizeDomainMock: vi.fn(),
  validateDomainForRegistryMock: vi.fn(),
  resolvePublishableArtifactStateMock: vi.fn(),
  downloadArtifactToDirectoryMock: vi.fn(),
  uploadProjectPublishedToBucketMock: vi.fn(),
}));

vi.mock("../src/services/publish/DomainService", () => ({
  domainService: {
    ensurePublishDomainEnabled: ensurePublishDomainEnabledMock,
    normalizeDomain: normalizeDomainMock,
    validateDomainForRegistry: validateDomainForRegistryMock,
  },
}));

vi.mock("../src/services/project/ProjectArtifactStateService", () => ({
  resolvePublishableArtifactState: resolvePublishableArtifactStateMock,
  downloadArtifactToDirectory: downloadArtifactToDirectoryMock,
}));

vi.mock("../src/services/project/ProjectArtifactsService", () => ({
  uploadProjectPublishedToBucket: uploadProjectPublishedToBucketMock,
}));

import {
  PublishConflictError,
  PublishService,
} from "../src/services/publish/PublishService";

function makeArtifactState(overrides: Record<string, unknown> = {}) {
  return {
    storageEnabled: true,
    readiness: "ready",
    sourceKind: "source",
    framework: "generic",
    commitHash: "commit-1",
    builtAt: new Date().toISOString(),
    previewCommitHash: null,
    sourceCommitHash: "commit-1",
    previewBuiltAt: null,
    sourceBuiltAt: new Date().toISOString(),
    error: null,
    previewStatus: null,
    sourceStatus: null,
    ...overrides,
  };
}

describe("PublishService conflict behavior", () => {
  let service: PublishService;

  beforeEach(() => {
    ensurePublishDomainEnabledMock.mockReset();
    normalizeDomainMock.mockReset();
    validateDomainForRegistryMock.mockReset();
    resolvePublishableArtifactStateMock.mockReset();
    downloadArtifactToDirectoryMock.mockReset();
    uploadProjectPublishedToBucketMock.mockReset();

    ensurePublishDomainEnabledMock.mockResolvedValue({ enabled: true });
    normalizeDomainMock.mockImplementation((domain: string) =>
      domain.trim().toLowerCase(),
    );
    validateDomainForRegistryMock.mockReturnValue({ valid: true });
    resolvePublishableArtifactStateMock.mockResolvedValue(makeArtifactState());
    downloadArtifactToDirectoryMock.mockResolvedValue({ downloaded: true });
    uploadProjectPublishedToBucketMock.mockResolvedValue(undefined);

    service = new PublishService();
    vi.spyOn(service, "isDomainAvailable").mockResolvedValue(true);
  });

  it("throws a build_in_progress conflict when preview build is running", async () => {
    resolvePublishableArtifactStateMock.mockResolvedValueOnce(
      makeArtifactState({
        readiness: "build_in_progress",
        sourceKind: "preview",
      }),
    );

    await expect(
      service.publish({
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
        domain: "example.com",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      name: "PublishConflictError",
      reason: "build_in_progress",
    });
  });

  it("throws an artifact_not_ready conflict when no publishable artifact exists", async () => {
    resolvePublishableArtifactStateMock.mockResolvedValueOnce(
      makeArtifactState({
        readiness: "artifact_not_ready",
        sourceKind: null,
        error: "Artifact is still being prepared",
      }),
    );

    await expect(
      service.publish({
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
        domain: "example.com",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      name: "PublishConflictError",
      reason: "artifact_not_ready",
      message: "Artifact is still being prepared",
    });
  });

  it("throws artifact_changed when expected commit hash is stale", async () => {
    resolvePublishableArtifactStateMock.mockResolvedValueOnce(
      makeArtifactState({
        readiness: "ready",
        sourceKind: "source",
        commitHash: "commit-new",
      }),
    );

    await expect(
      service.publish({
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
        domain: "example.com",
        userId: "user-1",
        expectedCommitHash: "commit-old",
      }),
    ).rejects.toMatchObject({
      name: "PublishConflictError",
      reason: "artifact_changed",
    });
  });

  it("serializes publishes for the same project with an in-memory lock", async () => {
    let resolveFirst: (() => void) | null = null;
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let invocation = 0;

    resolvePublishableArtifactStateMock.mockImplementation(async () => {
      invocation += 1;
      if (invocation === 1) {
        await firstGate;
      }
      return makeArtifactState({
        readiness: "artifact_not_ready",
        sourceKind: null,
        error: "Not ready",
      });
    });

    const publishParams = {
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
      domain: "example.com",
      userId: "user-1",
    };

    const first = service.publish(publishParams).catch((err) => err);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = service.publish(publishParams).catch((err) => err);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(resolvePublishableArtifactStateMock).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    const [firstError, secondError] = await Promise.all([first, second]);

    expect(firstError).toBeInstanceOf(PublishConflictError);
    expect(secondError).toBeInstanceOf(PublishConflictError);
    expect(resolvePublishableArtifactStateMock).toHaveBeenCalledTimes(2);
  });
});
