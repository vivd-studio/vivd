import { describe, expect, it } from "vitest";
import { resolveStudioBrowserUrl } from "../src/services/studioMachines/runtimeAccessResolver";

describe("resolveStudioBrowserUrl", () => {
  it("keeps the direct runtime origin for hosted platform installs", () => {
    expect(
      resolveStudioBrowserUrl({
        controlPlaneMode: "host_based",
        providerKind: "fly",
        requestHost: "felix-pahlke.vivd.studio",
        requestProtocol: "https",
        runtimeUrl: "https://vivd-studio-prod.fly.dev:3115",
        compatibilityUrl: "/_studio/runtime-1",
      }),
    ).toBe("https://vivd-studio-prod.fly.dev:3115");
  });

  it("prefers the compatibility route for local platform hosts on non-fly providers", () => {
    expect(
      resolveStudioBrowserUrl({
        controlPlaneMode: "host_based",
        providerKind: "local",
        requestHost: "app.localhost:18080",
        requestProtocol: "http",
        runtimeUrl: "http://app.localhost:4100",
        compatibilityUrl: "http://app.localhost:18080/_studio/runtime-1",
      }),
    ).toBe("http://app.localhost:18080/_studio/runtime-1");
  });

  it("prefers the compatibility route for local-development docker platform hosts", () => {
    expect(
      resolveStudioBrowserUrl({
        controlPlaneMode: "host_based",
        providerKind: "docker",
        requestHost: "app.localhost:18080",
        requestProtocol: "http",
        runtimeUrl: "http://app.localhost:4100",
        compatibilityUrl: "http://app.localhost/_studio/runtime-1",
      }),
    ).toBe("http://app.localhost:18080/_studio/runtime-1");
  });

  it("prefers the compatibility route for path-based installs when the direct runtime uses a non-default port", () => {
    expect(
      resolveStudioBrowserUrl({
        controlPlaneMode: "path_based",
        providerKind: "docker",
        requestHost: "vivd.felixpahlke.de",
        requestProtocol: "https",
        runtimeUrl: "https://vivd.felixpahlke.de:4100",
        compatibilityUrl: "https://vivd.felixpahlke.de/_studio/runtime-1",
      }),
    ).toBe("https://vivd.felixpahlke.de/_studio/runtime-1");
  });

  it("prefers the same-origin compatibility route for local providers when the host uses a different origin than the dev server", () => {
    expect(
      resolveStudioBrowserUrl({
        controlPlaneMode: "path_based",
        providerKind: "local",
        requestHost: "app.localhost:18080",
        requestProtocol: "http",
        runtimeUrl: "http://app.localhost:4100",
        compatibilityUrl: "http://app.localhost:18080/_studio/runtime-1",
      }),
    ).toBe("http://app.localhost:18080/_studio/runtime-1");
  });

  it("keeps the direct runtime origin when the request already targets the local dev server origin", () => {
    expect(
      resolveStudioBrowserUrl({
        controlPlaneMode: "path_based",
        providerKind: "local",
        requestHost: "app.localhost:4100",
        requestProtocol: "http",
        runtimeUrl: "http://app.localhost:4100",
        compatibilityUrl: "http://app.localhost:18080/_studio/runtime-1",
      }),
    ).toBe("http://app.localhost:4100");
  });

  it("falls back to the compatibility route when no direct runtime origin is available", () => {
    expect(
      resolveStudioBrowserUrl({
        controlPlaneMode: "path_based",
        providerKind: "docker",
        requestHost: "vivd.felixpahlke.de",
        requestProtocol: "https",
        runtimeUrl: null,
        compatibilityUrl: "https://vivd.felixpahlke.de/_studio/runtime-1",
      }),
    ).toBe("https://vivd.felixpahlke.de/_studio/runtime-1");
  });
});
