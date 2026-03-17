import { afterEach, describe, expect, it } from "vitest";
import { DomainService } from "../src/services/publish/DomainService";

const originalPublicPluginApiHost = process.env.VIVD_PUBLIC_PLUGIN_API_HOST;
const originalDocsHost = process.env.VIVD_DOCS_HOST;

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
    restoreEnvVar("VIVD_DOCS_HOST", originalDocsHost);
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

  it("rejects the configured docs host", () => {
    process.env.VIVD_DOCS_HOST = "docs.customer-example.test";

    const result = service.validateDomainForRegistry("docs.customer-example.test");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("public docs host");
  });

  it("rejects the local docs host", () => {
    delete process.env.VIVD_DOCS_HOST;

    const result = service.validateDomainForRegistry("docs.localhost");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("public docs");
  });
});
