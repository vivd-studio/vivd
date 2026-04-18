import { beforeEach, describe, expect, it, vi } from "vitest";

const { inferPluginSourceHostsMock, getInstallProfileMock } = vi.hoisted(() => ({
  inferPluginSourceHostsMock: vi.fn(),
  getInstallProfileMock: vi.fn(),
}));

vi.mock("@vivd/plugin-contact-form/backend/sourceHosts", () => ({
  inferContactFormAutoSourceHosts: inferPluginSourceHostsMock,
}));

vi.mock("../src/services/system/InstallProfileService", () => ({
  installProfileService: {
    getInstallProfile: getInstallProfileMock,
  },
}));

import {
  inferContactFormAutoSourceHosts,
  PLATFORM_STUDIO_PREVIEW_HOST,
} from "../src/services/plugins/contactForm/sourceHosts";

describe("inferContactFormAutoSourceHosts", () => {
  beforeEach(() => {
    inferPluginSourceHostsMock.mockReset();
    getInstallProfileMock.mockReset();
    inferPluginSourceHostsMock.mockResolvedValue(["customer.example"]);
    getInstallProfileMock.mockResolvedValue("platform");
  });

  it("adds the hosted Studio preview host for platform installs", async () => {
    const hosts = await inferContactFormAutoSourceHosts({
      organizationId: "org-1",
      projectSlug: "dld-diagnostika",
    });

    expect(inferPluginSourceHostsMock).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        projectSlug: "dld-diagnostika",
      },
      expect.objectContaining({
        listPublishedSiteDomains: expect.any(Function),
        listTenantHostDomains: expect.any(Function),
      }),
    );
    expect(hosts).toEqual(["customer.example", PLATFORM_STUDIO_PREVIEW_HOST]);
  });

  it("does not add the hosted Studio preview host for solo installs", async () => {
    getInstallProfileMock.mockResolvedValue("solo");

    const hosts = await inferContactFormAutoSourceHosts({
      organizationId: "org-1",
      projectSlug: "dld-diagnostika",
    });

    expect(hosts).toEqual(["customer.example"]);
  });

  it("deduplicates the hosted Studio preview host when it is already present", async () => {
    inferPluginSourceHostsMock.mockResolvedValue([
      PLATFORM_STUDIO_PREVIEW_HOST,
      "customer.example",
    ]);

    const hosts = await inferContactFormAutoSourceHosts({
      organizationId: "org-1",
      projectSlug: "dld-diagnostika",
    });

    expect(hosts).toEqual(["customer.example", PLATFORM_STUDIO_PREVIEW_HOST]);
  });
});
