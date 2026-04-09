import { describe, expect, it } from "vitest";
import { resolveStudioMainBackendUrl } from "../src/services/studioMachines/backendCallbackUrl";

describe("resolveStudioMainBackendUrl", () => {
  it("prefers canonical BACKEND_URL for fly machines when configured", () => {
    const url = resolveStudioMainBackendUrl({
      providerKind: "fly",
      requestHost: "felixpahlke.vivd.studio",
      backendUrlEnv: "https://default.vivd.studio",
      domainEnv: "https://default.vivd.studio",
      betterAuthUrlEnv: "https://default.vivd.studio",
      backendPort: "3000",
    });

    expect(url).toBe("https://default.vivd.studio/vivd-studio");
  });

  it("prefers canonical BACKEND_URL for docker machines when configured", () => {
    const url = resolveStudioMainBackendUrl({
      providerKind: "docker",
      requestHost: "app.vivd.studio",
      backendUrlEnv: "https://default.vivd.studio",
      domainEnv: "https://default.vivd.studio",
      betterAuthUrlEnv: "https://default.vivd.studio",
      backendPort: "3000",
    });

    expect(url).toBe("https://default.vivd.studio/vivd-studio");
  });

  it("falls back to BACKEND_URL when fly request host is unavailable", () => {
    const url = resolveStudioMainBackendUrl({
      providerKind: "fly",
      requestHost: null,
      backendUrlEnv: "https://app.vivd.studio",
      domainEnv: "https://fallback.vivd.studio",
      betterAuthUrlEnv: "https://auth.vivd.studio",
      backendPort: "3000",
    });

    expect(url).toBe("https://app.vivd.studio/vivd-studio");
  });

  it("uses local loopback fallback for local provider", () => {
    const url = resolveStudioMainBackendUrl({
      providerKind: "local",
      requestHost: "app.localhost",
      backendUrlEnv: "",
      domainEnv: "",
      betterAuthUrlEnv: "",
      backendPort: "3100",
    });

    expect(url).toBe("http://127.0.0.1:3100/vivd-studio");
  });

  it("does not inject localhost request hosts for remote providers", () => {
    const url = resolveStudioMainBackendUrl({
      providerKind: "fly",
      requestHost: "org.localhost",
      backendUrlEnv: "",
      domainEnv: "",
      betterAuthUrlEnv: "",
      backendPort: "3000",
    });

    expect(url).toBeNull();
  });

  it("does not inject localhost canonical origins for remote providers", () => {
    const url = resolveStudioMainBackendUrl({
      providerKind: "fly",
      requestHost: null,
      backendUrlEnv: "",
      domainEnv: "http://localhost",
      betterAuthUrlEnv: "http://app.localhost",
      backendPort: "3000",
    });

    expect(url).toBeNull();
  });
});
