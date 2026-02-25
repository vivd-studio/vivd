import { afterEach, describe, expect, it } from "vitest";
import { DomainService } from "../src/services/publish/DomainService";

const originalPublicPluginApiHost = process.env.VIVD_PUBLIC_PLUGIN_API_HOST;

function restoreEnvVar(name: string, value: string | undefined): void {
  if (typeof value === "string") {
    process.env[name] = value;
    return;
  }
  delete process.env[name];
}

describe("DomainService.validateDomainForRegistry", () => {
  const service = new DomainService();

  afterEach(() => {
    restoreEnvVar("VIVD_PUBLIC_PLUGIN_API_HOST", originalPublicPluginApiHost);
  });

  it("rejects the default public plugin API host", () => {
    delete process.env.VIVD_PUBLIC_PLUGIN_API_HOST;

    const result = service.validateDomainForRegistry("api.vivd.studio");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("public plugin API host");
  });

  it("rejects a configured public plugin API host", () => {
    process.env.VIVD_PUBLIC_PLUGIN_API_HOST = "plugins.customer-api.example";

    const result = service.validateDomainForRegistry("plugins.customer-api.example");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("public plugin API host");
  });

  it("allows regular domains", () => {
    process.env.VIVD_PUBLIC_PLUGIN_API_HOST = "plugins.customer-api.example";

    const result = service.validateDomainForRegistry("felixpahlke.de");
    expect(result.valid).toBe(true);
  });
});
