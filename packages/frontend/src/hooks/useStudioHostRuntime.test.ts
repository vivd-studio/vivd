import { describe, expect, it } from "vitest";
import {
  selectBrowserStudioBaseUrl,
  selectHostProbeStudioBaseUrl,
  type StudioRuntimeSession,
} from "./useStudioHostRuntime";

function makeRuntime(
  overrides: Partial<StudioRuntimeSession> = {},
): StudioRuntimeSession {
  return {
    url: "https://studio.example.com",
    runtimeUrl: "https://studio.example.com",
    compatibilityUrl: null,
    bootstrapToken: null,
    userActionToken: null,
    ...overrides,
  };
}

describe("selectBrowserStudioBaseUrl", () => {
  it("prefers the explicit backend-resolved browser URL", () => {
    expect(
      selectBrowserStudioBaseUrl(
        makeRuntime({
          browserUrl: "https://vivd-studio-prod.fly.dev:3115",
          runtimeUrl: "https://vivd-studio-prod.fly.dev:3115",
          compatibilityUrl: "/_studio/runtime-1",
        }),
      ),
    ).toBe("https://vivd-studio-prod.fly.dev:3115");
  });

  it("preserves a host-relative compatibility browser URL", () => {
    expect(
      selectBrowserStudioBaseUrl(
        makeRuntime({
          browserUrl: "/_studio/runtime-1",
          runtimeUrl: "https://vivd-studio-prod.fly.dev:3115",
          compatibilityUrl: "/_studio/runtime-1",
        }),
      ),
    ).toBe("/_studio/runtime-1");
  });

  it("falls back to the existing session url", () => {
    expect(
      selectBrowserStudioBaseUrl(
        makeRuntime({
          url: "https://studio.example.com/runtime",
          runtimeUrl: "https://studio.example.com/runtime",
          compatibilityUrl: "https://app.example.com/_studio/runtime-1",
        }),
      ),
    ).toBe("https://studio.example.com/runtime");
  });

  it("falls back to the direct runtime url when needed", () => {
    expect(
      selectBrowserStudioBaseUrl(
        makeRuntime({
          url: "",
          runtimeUrl: "http://app.localhost:4100",
          compatibilityUrl: "http://app.localhost/_studio/runtime-1",
        }),
      ),
    ).toBe("http://app.localhost:4100");
  });

  it("falls back to the compatibility url when it is the only browser-safe path left", () => {
    expect(
      selectBrowserStudioBaseUrl(
        makeRuntime({
          url: "",
          runtimeUrl: null,
          compatibilityUrl: "http://49.13.48.211/_studio/runtime-1",
        }),
      ),
    ).toBe("http://49.13.48.211/_studio/runtime-1");
  });
});

describe("selectHostProbeStudioBaseUrl", () => {
  it("prefers the same-origin compatibility route for host probes", () => {
    expect(
      selectHostProbeStudioBaseUrl(
        makeRuntime({
          browserUrl: "http://localhost:4100",
          url: "http://localhost:4100",
          runtimeUrl: "http://localhost:4100",
          compatibilityUrl: "/_studio/runtime-1",
        }),
      ),
    ).toBe("/_studio/runtime-1");
  });

  it("returns null when the runtime only exposes a cross-origin direct URL", () => {
    expect(
      selectHostProbeStudioBaseUrl(
        makeRuntime({
          browserUrl: "http://localhost:4100",
          url: "http://localhost:4100",
          runtimeUrl: "http://localhost:4100",
          compatibilityUrl: null,
        }),
      ),
    ).toBeNull();
  });
});
