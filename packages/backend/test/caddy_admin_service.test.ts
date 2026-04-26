import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCaddyAdminUrl,
  reloadCaddyConfig,
} from "../src/services/system/CaddyAdminService";

const ENV_KEYS = [
  "CADDY_ADMIN_URL",
  "CADDY_MAIN_CONFIG_PATH",
  "CADDY_PUBLIC_ADMIN_URL",
  "CADDY_PUBLIC_MAIN_CONFIG_PATH",
  "CADDY_PLATFORM_ADMIN_URL",
  "CADDY_PLATFORM_MAIN_CONFIG_PATH",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

function restoreEnv() {
  for (const [key, value] of originalEnv) {
    if (typeof value === "string") process.env[key] = value;
    else delete process.env[key];
  }
}

describe("CaddyAdminService", () => {
  beforeEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
  });

  it("reloads the public surface against its own admin URL and Caddyfile", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-caddy-public-"));
    const caddyfilePath = path.join(tempDir, "Caddyfile.public");
    fs.writeFileSync(caddyfilePath, ":80 { respond \"public\" 200 }\n");

    process.env.CADDY_PUBLIC_ADMIN_URL = "http://caddy-public:2019";
    process.env.CADDY_PUBLIC_MAIN_CONFIG_PATH = caddyfilePath;

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await reloadCaddyConfig("public");

    expect(getCaddyAdminUrl("public")).toBe("http://caddy-public:2019");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://caddy-public:2019/load",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "text/caddyfile",
          Origin: "http://caddy-public:2019",
        }),
        body: ":80 { respond \"public\" 200 }\n",
      }),
    );
  });

  it("falls back to the legacy single-Caddy admin URL when no platform override is set", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-caddy-platform-"));
    const caddyfilePath = path.join(tempDir, "Caddyfile.platform");
    fs.writeFileSync(caddyfilePath, ":80 { respond \"platform\" 200 }\n");

    process.env.CADDY_ADMIN_URL = "http://caddy:2019";
    process.env.CADDY_MAIN_CONFIG_PATH = caddyfilePath;

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await reloadCaddyConfig("platform");

    expect(getCaddyAdminUrl("platform")).toBe("http://caddy:2019");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://caddy:2019/load",
      expect.objectContaining({
        body: ":80 { respond \"platform\" 200 }\n",
      }),
    );
  });
});
