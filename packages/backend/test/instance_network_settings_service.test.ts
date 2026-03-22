import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let storedValue: unknown = null;

vi.mock("../src/services/system/SystemSettingsService", () => ({
  SYSTEM_SETTING_KEYS: {
    instanceNetworkSettings: "instance_network_settings",
  },
  getSystemSettingJsonValue: vi.fn(async () => storedValue),
  setSystemSettingJsonValue: vi.fn(async (_key: string, value: unknown) => {
    storedValue = value;
  }),
}));

import { instanceNetworkSettingsService } from "../src/services/system/InstanceNetworkSettingsService";

const envSnapshot = { ...process.env };

describe("instance network settings service", () => {
  beforeEach(() => {
    storedValue = null;
    process.env = { ...envSnapshot };
    delete process.env.VIVD_APP_URL;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.CONTROL_PLANE_HOST;
    delete process.env.DOMAIN;
    delete process.env.VIVD_CADDY_TLS_MODE;
    delete process.env.VIVD_CADDY_ACME_EMAIL;
    delete process.env.VIVD_CADDY_PRIMARY_HOST;
    delete process.env.VIVD_SELFHOST_CADDY_UI_MANAGED;
    delete process.env.CADDY_MAIN_CONFIG_PATH;
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("lets stored self-host settings override bootstrap DOMAIN env", async () => {
    process.env.DOMAIN = "https://bootstrap.example.com";
    storedValue = {
      publicHost: "ui.example.com",
      tlsMode: "external",
    };

    await instanceNetworkSettingsService.refreshFromStore();

    expect(instanceNetworkSettingsService.getResolvedSettings()).toMatchObject({
      publicHost: "ui.example.com",
      publicOrigin: "https://ui.example.com",
      tlsMode: "external",
      sources: {
        publicHost: "settings",
        tlsMode: "settings",
      },
    });
  });

  it("keeps explicit control-plane/auth envs authoritative", async () => {
    process.env.DOMAIN = "https://bootstrap.example.com";
    process.env.CONTROL_PLANE_HOST = "app.example.com";
    storedValue = {
      publicHost: "ui.example.com",
      tlsMode: "managed",
    };

    await instanceNetworkSettingsService.refreshFromStore();

    expect(instanceNetworkSettingsService.getResolvedSettings()).toMatchObject({
      publicHost: "app.example.com",
      publicOrigin: "https://app.example.com",
      sources: {
        publicHost: "explicit_env",
      },
      deploymentManaged: {
        publicHost: true,
      },
    });
  });

  it("writes self-host Caddy config from the resolved settings", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-caddy-"));
    const caddyfilePath = path.join(tempDir, "Caddyfile");
    process.env.VIVD_SELFHOST_CADDY_UI_MANAGED = "true";
    process.env.CADDY_MAIN_CONFIG_PATH = caddyfilePath;
    storedValue = {
      publicHost: "solo.example.com",
      tlsMode: "managed",
      acmeEmail: "admin@example.com",
    };

    await instanceNetworkSettingsService.refreshFromStore();
    await instanceNetworkSettingsService.syncSelfHostedCaddyConfig();

    expect(fs.readFileSync(caddyfilePath, "utf-8")).toContain(
      "email admin@example.com",
    );
    expect(fs.readFileSync(caddyfilePath, "utf-8")).toContain(
      "solo.example.com {",
    );

    await instanceNetworkSettingsService.updateStoredSettings({
      tlsMode: "off",
    });
    await instanceNetworkSettingsService.syncSelfHostedCaddyConfig();

    expect(fs.readFileSync(caddyfilePath, "utf-8")).toContain("auto_https off");
    expect(fs.readFileSync(caddyfilePath, "utf-8")).toContain(
      "http://solo.example.com {",
    );
  });
});
