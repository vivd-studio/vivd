import { describe, expect, it } from "vitest";
import {
  selectBootstrapStatusStudioBaseUrl,
  selectBrowserStudioBaseUrl,
  selectHostProbeStudioBaseUrl,
  shouldReloadRecoveredStudioRuntime,
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
  it("prefers the explicit backend-resolved browser URL when no same-origin compatibility route is available", () => {
    expect(
      selectBrowserStudioBaseUrl(
        makeRuntime({
          browserUrl: "https://vivd-studio-prod.fly.dev:3115",
          runtimeUrl: "https://vivd-studio-prod.fly.dev:3115",
          compatibilityUrl: "https://app.example.com/_studio/runtime-1",
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

  it("prefers the same-origin compatibility route over a cross-origin direct runtime", () => {
    const locationSnapshot = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...locationSnapshot,
        origin: "http://app.localhost:18080",
        href: "http://app.localhost:18080/vivd-studio/projects/site-1",
        protocol: "http:",
        host: "app.localhost:18080",
        hostname: "app.localhost",
        pathname: "/vivd-studio/projects/site-1",
        search: "",
      },
    });

    expect(
      selectBrowserStudioBaseUrl(
        makeRuntime({
          browserUrl: "http://app.localhost:4100",
          url: "http://app.localhost:4100",
          runtimeUrl: "http://app.localhost:4100",
          compatibilityUrl: "http://app.localhost:18080/_studio/runtime-1",
        }),
      ),
    ).toBe("http://app.localhost:18080/_studio/runtime-1");

    Object.defineProperty(window, "location", {
      configurable: true,
      value: locationSnapshot,
    });
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

describe("selectBootstrapStatusStudioBaseUrl", () => {
  it("prefers the same-origin compatibility route for bootstrap status", () => {
    expect(
      selectBootstrapStatusStudioBaseUrl(
        makeRuntime({
          browserUrl: "http://localhost:4100",
          url: "http://localhost:4100",
          runtimeUrl: "http://localhost:4100",
          compatibilityUrl: "/_studio/runtime-1",
        }),
      ),
    ).toBe("/_studio/runtime-1");
  });

  it("falls back to the direct runtime route when no same-origin compatibility route exists", () => {
    expect(
      selectBootstrapStatusStudioBaseUrl(
        makeRuntime({
          browserUrl: "http://localhost:4100",
          url: "http://localhost:4100",
          runtimeUrl: "http://localhost:4100",
          compatibilityUrl: null,
        }),
      ),
    ).toBe("http://localhost:4100");
  });
});

describe("shouldReloadRecoveredStudioRuntime", () => {
  it("does not reload when recovery returns the same runtime identity", () => {
    const current = makeRuntime({
      url: "http://localhost:4100",
      browserUrl: "http://localhost:4100",
      runtimeUrl: "http://localhost:4100",
      compatibilityUrl: null,
      bootstrapToken: "token-1",
      userActionToken: "action-1",
    });

    expect(
      shouldReloadRecoveredStudioRuntime(current, {
        ...current,
        url: "http://localhost:4100/",
        browserUrl: "http://localhost:4100/",
        bootstrapToken: "token-2",
        userActionToken: "action-2",
      }),
    ).toBe(false);
  });

  it("reloads when recovery switches to a different runtime URL", () => {
    expect(
      shouldReloadRecoveredStudioRuntime(
        makeRuntime({
          url: "http://localhost:4100",
          runtimeUrl: "http://localhost:4100",
        }),
        makeRuntime({
          url: "http://localhost:4101",
          runtimeUrl: "http://localhost:4101",
        }),
      ),
    ).toBe(true);
  });

  it("reloads when recovery changes the direct runtime behind a stable compatibility route", () => {
    expect(
      shouldReloadRecoveredStudioRuntime(
        makeRuntime({
          url: "/_studio/runtime-1",
          browserUrl: "/_studio/runtime-1",
          runtimeUrl: "http://localhost:4100",
          compatibilityUrl: "/_studio/runtime-1",
        }),
        makeRuntime({
          url: "/_studio/runtime-1",
          browserUrl: "/_studio/runtime-1",
          runtimeUrl: "http://localhost:4101",
          compatibilityUrl: "/_studio/runtime-1",
        }),
      ),
    ).toBe(true);
  });
});
