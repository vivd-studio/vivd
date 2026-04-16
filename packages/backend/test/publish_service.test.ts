import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { db } from "../src/db";

const envSnapshot = { ...process.env };

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
    process.env = { ...envSnapshot };
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

  afterEach(() => {
    process.env = { ...envSnapshot };
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

  it("regenerates existing site configs from the current Caddy template on startup sync", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-publish-sync-"));
    process.env.CADDY_SITES_DIR = tempDir;

    const fromMock = vi.fn().mockResolvedValue([
      {
        id: "pub-1",
        organizationId: "org-1",
        projectSlug: "site-1",
        projectVersion: 3,
        domain: "localhost",
        commitHash: "commit-1",
        publishedAt: new Date(),
        publishedById: "user-1",
      },
    ]);
    vi.spyOn(db, "select").mockReturnValue({
      from: fromMock,
    } as any);

    const redirectRules = [
      {
        fromPath: "/old",
        to: "/new",
        statusCode: 308 as const,
        isPrefix: false,
      },
    ];
    const readRedirectRulesSpy = vi
      .spyOn(service as any, "readRedirectRulesFromDirectory")
      .mockReturnValue(redirectRules);
    const generateCaddyConfigSpy = vi
      .spyOn(service as any, "generateCaddyConfig")
      .mockResolvedValue(undefined);
    vi.spyOn(db.query.domain, "findMany").mockResolvedValue([]);
    const reloadCaddySpy = vi
      .spyOn(service as any, "reloadCaddy")
      .mockResolvedValue(undefined);

    const syncedCount = await service.syncGeneratedCaddyConfigs();

    expect(syncedCount).toBe(1);
    expect(readRedirectRulesSpy).toHaveBeenCalledWith(
      "/srv/published/org-1/site-1",
    );
    expect(generateCaddyConfigSpy).toHaveBeenCalledWith(
      "localhost",
      "org-1",
      "site-1",
      redirectRules,
    );
    expect(reloadCaddySpy).toHaveBeenCalledTimes(1);
  });

  it("creates placeholder configs for active tenant hosts without a live publish", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-tenant-placeholder-"));
    process.env.CADDY_SITES_DIR = tempDir;

    vi.spyOn(db, "select").mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    } as any);
    vi.spyOn(db.query.domain, "findMany").mockResolvedValue([
      {
        domain: "acme.example.com",
      },
    ] as any);
    const reloadCaddySpy = vi
      .spyOn(service as any, "reloadCaddy")
      .mockResolvedValue(undefined);

    const syncedCount = await service.syncGeneratedCaddyConfigs();

    expect(syncedCount).toBe(0);
    expect(reloadCaddySpy).toHaveBeenCalledTimes(1);
    expect(
      fs.readFileSync(path.join(tempDir, "acme-example-com.caddy"), "utf-8"),
    ).toContain("/unpublished-site-placeholder.html");
    expect(
      fs.readFileSync(
        path.join(tempDir, "_system", "unpublished-site-placeholder.html"),
        "utf-8",
      ),
    ).toContain("Open /vivd-studio");
  });

  it("cleans up a directly-restored tenant placeholder when the tenant host disappears later", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-tenant-placeholder-cleanup-"));
    process.env.CADDY_SITES_DIR = tempDir;

    (service as any).generateUnpublishedTenantHostCaddyConfig("acme.example.com");

    const configPath = path.join(tempDir, "acme-example-com.caddy");
    expect(fs.existsSync(configPath)).toBe(true);

    vi.spyOn(db, "select").mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    } as any);
    vi.spyOn(db.query.domain, "findMany").mockResolvedValue([]);
    const reloadCaddySpy = vi
      .spyOn(service as any, "reloadCaddy")
      .mockResolvedValue(undefined);

    await service.syncGeneratedCaddyConfigs();

    expect(reloadCaddySpy).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(configPath)).toBe(false);
  });
});
