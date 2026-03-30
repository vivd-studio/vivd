import { describe, expect, it } from "vitest";
import {
  selectBrowserStudioBaseUrl,
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
  it("prefers the compatibility route for https pages when the direct runtime uses a non-default port", () => {
    expect(
      selectBrowserStudioBaseUrl(
        makeRuntime({
          runtimeUrl: "https://vivd.felixpahlke.de:4100",
          compatibilityUrl: "https://vivd.felixpahlke.de/_studio/runtime-1",
        }),
        "https://vivd.felixpahlke.de",
      ),
    ).toBe("https://vivd.felixpahlke.de/_studio/runtime-1");
  });

  it("keeps the direct runtime for local http development hosts", () => {
    expect(
      selectBrowserStudioBaseUrl(
        makeRuntime({
          runtimeUrl: "http://app.localhost:4100",
          compatibilityUrl: "http://app.localhost/_studio/runtime-1",
        }),
        "http://app.localhost",
      ),
    ).toBe("http://app.localhost:4100");
  });

  it("keeps a normal https runtime origin on the default port", () => {
    expect(
      selectBrowserStudioBaseUrl(
        makeRuntime({
          runtimeUrl: "https://studio.example.com",
          compatibilityUrl: "https://app.example.com/_studio/runtime-1",
        }),
        "https://app.example.com",
      ),
    ).toBe("https://studio.example.com");
  });
});
