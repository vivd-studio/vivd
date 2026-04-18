import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contactStartBackgroundJobsMock,
  contactRenameProjectSlugDataMock,
  analyticsRenameProjectSlugDataMock,
  newsletterStartBackgroundJobsMock,
  newsletterRenameProjectSlugDataMock,
  stopContactRetentionMock,
  stopContactTurnstileMock,
  stopNewsletterJobMock,
} = vi.hoisted(() => ({
  contactStartBackgroundJobsMock: vi.fn(),
  contactRenameProjectSlugDataMock: vi.fn(),
  analyticsRenameProjectSlugDataMock: vi.fn(),
  newsletterStartBackgroundJobsMock: vi.fn(),
  newsletterRenameProjectSlugDataMock: vi.fn(),
  stopContactRetentionMock: vi.fn(),
  stopContactTurnstileMock: vi.fn(),
  stopNewsletterJobMock: vi.fn(),
}));

vi.mock("../src/services/plugins/descriptors", () => ({
  backendPluginPackageDescriptors: [
    {
      pluginId: "contact_form",
      backend: {
        hooks: {
          startBackgroundJobs: contactStartBackgroundJobsMock,
          renameProjectSlugData: contactRenameProjectSlugDataMock,
        },
      },
    },
    {
      pluginId: "analytics",
      backend: {
        hooks: {
          renameProjectSlugData: analyticsRenameProjectSlugDataMock,
        },
      },
    },
    {
      pluginId: "newsletter",
      backend: {
        hooks: {
          startBackgroundJobs: newsletterStartBackgroundJobsMock,
          renameProjectSlugData: newsletterRenameProjectSlugDataMock,
        },
      },
    },
  ],
}));

import {
  renamePluginProjectDataForSlugChange,
  startInstalledPluginBackgroundJobs,
} from "../src/services/plugins/integrationHooks";

describe("plugin integration hooks", () => {
  beforeEach(() => {
    contactStartBackgroundJobsMock.mockReset();
    contactRenameProjectSlugDataMock.mockReset();
    analyticsRenameProjectSlugDataMock.mockReset();
    newsletterStartBackgroundJobsMock.mockReset();
    newsletterRenameProjectSlugDataMock.mockReset();
    stopContactRetentionMock.mockReset();
    stopContactTurnstileMock.mockReset();
    stopNewsletterJobMock.mockReset();

    contactStartBackgroundJobsMock.mockReturnValue([
      stopContactRetentionMock,
      stopContactTurnstileMock,
    ]);
    newsletterStartBackgroundJobsMock.mockReturnValue(stopNewsletterJobMock);
    contactRenameProjectSlugDataMock.mockResolvedValue(3);
    analyticsRenameProjectSlugDataMock.mockResolvedValue(2);
    newsletterRenameProjectSlugDataMock.mockResolvedValue(4);
  });

  it("starts and stops plugin background jobs through the generic hook surface", () => {
    const stop = startInstalledPluginBackgroundJobs();

    expect(contactStartBackgroundJobsMock).toHaveBeenCalledTimes(1);
    expect(newsletterStartBackgroundJobsMock).toHaveBeenCalledTimes(1);

    stop();

    expect(stopContactRetentionMock).toHaveBeenCalledTimes(1);
    expect(stopContactTurnstileMock).toHaveBeenCalledTimes(1);
    expect(stopNewsletterJobMock).toHaveBeenCalledTimes(1);

    stop();

    expect(stopContactRetentionMock).toHaveBeenCalledTimes(1);
    expect(stopContactTurnstileMock).toHaveBeenCalledTimes(1);
    expect(stopNewsletterJobMock).toHaveBeenCalledTimes(1);
  });

  it("applies plugin slug-rename hooks through the generic hook surface", async () => {
    const tx = {
      update: vi.fn(),
    };
    const options = {
      tx,
      organizationId: "org_123",
      oldSlug: "old-project",
      newSlug: "new-project",
    };

    const movedRows = await renamePluginProjectDataForSlugChange(options);

    expect(movedRows).toBe(9);
    expect(contactRenameProjectSlugDataMock).toHaveBeenCalledWith(options);
    expect(analyticsRenameProjectSlugDataMock).toHaveBeenCalledWith(options);
    expect(newsletterRenameProjectSlugDataMock).toHaveBeenCalledWith(options);
  });
});
