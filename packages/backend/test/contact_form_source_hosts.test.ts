import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendHostContext } from "@vivd/plugin-sdk";

const { inferPluginSourceHostsMock } = vi.hoisted(() => ({
  inferPluginSourceHostsMock: vi.fn(),
}));

vi.mock("@vivd/plugin-contact-form/backend/sourceHosts", async () => {
  const actual = await vi.importActual<
    typeof import("@vivd/plugin-contact-form/backend/sourceHosts")
  >("@vivd/plugin-contact-form/backend/sourceHosts");

  return {
    ...actual,
    inferContactFormAutoSourceHosts: inferPluginSourceHostsMock,
  };
});

import {
  PLATFORM_STUDIO_PREVIEW_HOST,
  inferVivdContactFormSourceHosts,
} from "@vivd/plugin-contact-form/backend/plugin";

function makeHostContext(installProfile: "platform" | "solo"): BackendHostContext {
  return {
    db: {
      query: {
        publishedSite: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        domain: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    },
    tables: {
      publishedSite: {
        organizationId: "organizationId",
        projectSlug: "projectSlug",
      },
      domain: {
        organizationId: "organizationId",
        usage: "usage",
        status: "status",
      },
    },
    pluginEntitlementService: {},
    projectPluginInstanceService: {
      ensurePluginInstance: vi.fn(),
      getPluginInstance: vi.fn(),
      updatePluginInstance: vi.fn(),
    },
    runtime: {
      getPublicPluginApiBaseUrl: vi.fn(),
      getControlPlaneOrigin: vi.fn(),
      inferProjectPluginSourceHosts: vi.fn(),
      hostUtils: {
        extractSourceHostFromHeaders: vi.fn(),
        isHostAllowed: vi.fn(),
        normalizeHostCandidate: vi.fn(),
      },
      env: {
        nodeEnv: "test",
        flyStudioPublicHost: undefined,
        flyStudioApp: undefined,
      },
    },
    email: {
      deliveryService: {},
      deliverabilityService: {},
      templates: {},
    },
    system: {
      installProfileService: {
        getInstallProfile: vi.fn().mockResolvedValue(installProfile),
        resolvePolicy: vi.fn(),
      },
    },
  };
}

describe("inferVivdContactFormSourceHosts", () => {
  beforeEach(() => {
    inferPluginSourceHostsMock.mockReset();
    inferPluginSourceHostsMock.mockResolvedValue(["customer.example"]);
  });

  it("adds the hosted Studio preview host for platform installs", async () => {
    const hosts = await inferVivdContactFormSourceHosts(
      makeHostContext("platform"),
      {
        organizationId: "org-1",
        projectSlug: "dld-diagnostika",
      },
    );

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
    const hosts = await inferVivdContactFormSourceHosts(makeHostContext("solo"), {
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

    const hosts = await inferVivdContactFormSourceHosts(
      makeHostContext("platform"),
      {
        organizationId: "org-1",
        projectSlug: "dld-diagnostika",
      },
    );

    expect(hosts).toEqual(["customer.example", PLATFORM_STUDIO_PREVIEW_HOST]);
  });
});
