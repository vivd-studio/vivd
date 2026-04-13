import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publishedSiteFindManyMock, domainFindManyMock } = vi.hoisted(() => ({
  publishedSiteFindManyMock: vi.fn(),
  domainFindManyMock: vi.fn(),
}));

vi.mock("../src/db", () => ({
  db: {
    query: {
      publishedSite: {
        findMany: publishedSiteFindManyMock,
      },
      domain: {
        findMany: domainFindManyMock,
      },
    },
  },
}));

import { inferProjectPluginSourceHosts } from "../src/services/plugins/runtime/sourceHosts";

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  VIVD_APP_URL: process.env.VIVD_APP_URL,
  BACKEND_URL: process.env.BACKEND_URL,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  DOMAIN: process.env.DOMAIN,
  CONTROL_PLANE_HOST: process.env.CONTROL_PLANE_HOST,
  FLY_STUDIO_PUBLIC_HOST: process.env.FLY_STUDIO_PUBLIC_HOST,
};

function restoreEnvVar(name: keyof typeof originalEnv, value: string | undefined) {
  if (typeof value === "string") {
    process.env[name] = value;
    return;
  }
  delete process.env[name];
}

describe("inferProjectPluginSourceHosts", () => {
  beforeEach(() => {
    publishedSiteFindManyMock.mockReset();
    domainFindManyMock.mockReset();
    publishedSiteFindManyMock.mockResolvedValue([{ domain: "default.localhost" }]);
    domainFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    restoreEnvVar("NODE_ENV", originalEnv.NODE_ENV);
    restoreEnvVar("VIVD_APP_URL", originalEnv.VIVD_APP_URL);
    restoreEnvVar("BACKEND_URL", originalEnv.BACKEND_URL);
    restoreEnvVar("BETTER_AUTH_URL", originalEnv.BETTER_AUTH_URL);
    restoreEnvVar("DOMAIN", originalEnv.DOMAIN);
    restoreEnvVar("CONTROL_PLANE_HOST", originalEnv.CONTROL_PLANE_HOST);
    restoreEnvVar("FLY_STUDIO_PUBLIC_HOST", originalEnv.FLY_STUDIO_PUBLIC_HOST);
  });

  it("includes local preview and control-plane hosts during development", async () => {
    process.env.NODE_ENV = "development";
    process.env.VIVD_APP_URL = "http://app.localhost";
    process.env.BACKEND_URL = "http://app.localhost";
    process.env.BETTER_AUTH_URL = "http://app.localhost";
    process.env.DOMAIN = "http://default.localhost";
    process.env.CONTROL_PLANE_HOST = "app.localhost:18080";

    const hosts = await inferProjectPluginSourceHosts({
      organizationId: "org-1",
      projectSlug: "horse-tinder",
    });

    expect(hosts).toEqual(
      expect.arrayContaining([
        "default.localhost",
        "app.localhost",
        "app.localhost:18080",
        "localhost",
      ]),
    );
  });
});
