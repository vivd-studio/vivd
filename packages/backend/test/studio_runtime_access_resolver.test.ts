import { describe, expect, it } from "vitest";
import { resolveStudioBrowserUrl } from "../src/services/studioMachines/runtimeAccessResolver";

describe("resolveStudioBrowserUrl", () => {
  it("keeps the direct runtime origin for platform installs", () => {
    expect(
      resolveStudioBrowserUrl({
        installProfile: "platform",
        providerKind: "fly",
        requestHost: "felix-pahlke.vivd.studio",
        requestProtocol: "https",
        runtimeUrl: "https://vivd-studio-prod.fly.dev:3115",
        compatibilityUrl: "/_studio/runtime-1",
      }),
    ).toBe("https://vivd-studio-prod.fly.dev:3115");
  });

  it("prefers the compatibility route for solo installs when the direct runtime uses a non-default port", () => {
    expect(
      resolveStudioBrowserUrl({
        installProfile: "solo",
        providerKind: "docker",
        requestHost: "vivd.felixpahlke.de",
        requestProtocol: "https",
        runtimeUrl: "https://vivd.felixpahlke.de:4100",
        compatibilityUrl: "https://vivd.felixpahlke.de/_studio/runtime-1",
      }),
    ).toBe("https://vivd.felixpahlke.de/_studio/runtime-1");
  });

  it("keeps the direct runtime origin for local development hosts", () => {
    expect(
      resolveStudioBrowserUrl({
        installProfile: "solo",
        providerKind: "docker",
        requestHost: "app.localhost",
        requestProtocol: "http",
        runtimeUrl: "http://app.localhost:4100",
        compatibilityUrl: "http://app.localhost/_studio/runtime-1",
      }),
    ).toBe("http://app.localhost:4100");
  });

  it("falls back to the compatibility route when no direct runtime origin is available", () => {
    expect(
      resolveStudioBrowserUrl({
        installProfile: "solo",
        providerKind: "docker",
        requestHost: "vivd.felixpahlke.de",
        requestProtocol: "https",
        runtimeUrl: null,
        compatibilityUrl: "https://vivd.felixpahlke.de/_studio/runtime-1",
      }),
    ).toBe("https://vivd.felixpahlke.de/_studio/runtime-1");
  });
});
