import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const { getResolvedSettingsMock, normalizeDomainMock, getInstallProfileMock } = vi.hoisted(() => ({
  getResolvedSettingsMock: vi.fn(),
  normalizeDomainMock: vi.fn(),
  getInstallProfileMock: vi.fn(),
}));

vi.mock("../src/services/system/InstanceNetworkSettingsService", () => ({
  instanceNetworkSettingsService: {
    getResolvedSettings: getResolvedSettingsMock,
  },
}));

vi.mock("../src/services/publish/DomainService", () => ({
  domainService: {
    normalizeDomain: normalizeDomainMock,
    ensurePublishDomainEnabled: vi.fn(),
    validateDomainForRegistry: vi.fn(),
  },
}));

vi.mock("../src/services/system/InstallProfileService", () => ({
  installProfileService: {
    getInstallProfile: getInstallProfileMock,
  },
}));

const envSnapshot = { ...process.env };

function normalizeHostLike(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(":")[0];
}

describe("PublishService primary-host Caddy generation", () => {
  beforeEach(() => {
    process.env = { ...envSnapshot };
    getResolvedSettingsMock.mockReset();
    normalizeDomainMock.mockReset();
    getInstallProfileMock.mockReset();
    getResolvedSettingsMock.mockReturnValue({
      publicHost: "solo.example.com",
      tlsMode: "managed",
      sources: {
        tlsMode: "settings",
      },
    });
    normalizeDomainMock.mockImplementation((value: string) =>
      normalizeHostLike(value),
    );
    getInstallProfileMock.mockResolvedValue("solo");
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("writes primary-host publishes as inline snippets instead of duplicate site blocks", async () => {
    vi.resetModules();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-primary-host-"));
    const publishedDir = path.join(tempDir, "published");
    const sitesDir = path.join(tempDir, "sites.d");
    const publishedPath = path.join(publishedDir, "org-1", "site-1");
    fs.mkdirSync(publishedPath, { recursive: true });
    fs.mkdirSync(sitesDir, { recursive: true });
    fs.writeFileSync(path.join(publishedPath, "index.html"), "<h1>ok</h1>");

    process.env.PUBLISHED_DIR = publishedDir;
    process.env.CADDY_SITES_DIR = sitesDir;

    const legacyTopLevelConfigPath = path.join(sitesDir, "solo-example-com.caddy");
    fs.writeFileSync(legacyTopLevelConfigPath, "legacy");

    const { PublishService } = await import("../src/services/publish/PublishService");
    const service = new PublishService();

    await (service as any).generateCaddyConfig("solo.example.com", "org-1", "site-1");

    const primaryInlineConfigPath = path.join(
      sitesDir,
      "_primary",
      "published-site.caddy",
    );

    expect(fs.existsSync(primaryInlineConfigPath)).toBe(true);
    expect(fs.existsSync(legacyTopLevelConfigPath)).toBe(false);
    expect(fs.readFileSync(primaryInlineConfigPath, "utf-8")).toContain(
      `root * ${publishedPath}`,
    );
    expect(fs.readFileSync(primaryInlineConfigPath, "utf-8")).toContain(
      "@primaryPublishedNotVivdRuntime",
    );
  });

  it("keeps platform publishes as normal site blocks even when the domain matches the resolved public host", async () => {
    vi.resetModules();
    getInstallProfileMock.mockResolvedValue("platform");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-platform-host-"));
    const publishedDir = path.join(tempDir, "published");
    const sitesDir = path.join(tempDir, "sites.d");
    const publishedPath = path.join(publishedDir, "org-1", "site-1");
    fs.mkdirSync(publishedPath, { recursive: true });
    fs.mkdirSync(sitesDir, { recursive: true });
    fs.writeFileSync(path.join(publishedPath, "index.html"), "<h1>ok</h1>");

    process.env.PUBLISHED_DIR = publishedDir;
    process.env.CADDY_SITES_DIR = sitesDir;

    const { PublishService } = await import("../src/services/publish/PublishService");
    const service = new PublishService();

    await (service as any).generateCaddyConfig("solo.example.com", "org-1", "site-1");

    const primaryInlineConfigPath = path.join(
      sitesDir,
      "_primary",
      "published-site.caddy",
    );
    const publishedConfigPath = path.join(sitesDir, "solo-example-com.caddy");

    expect(fs.existsSync(primaryInlineConfigPath)).toBe(false);
    expect(fs.existsSync(publishedConfigPath)).toBe(true);
    expect(fs.readFileSync(publishedConfigPath, "utf-8")).toContain(
      "solo.example.com, www.solo.example.com {",
    );
  });
});
