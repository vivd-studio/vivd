import { describe, expect, it } from "vitest";

import { resolveForwardedRuntimeBasePath } from "./runtime";

describe("resolveForwardedRuntimeBasePath", () => {
  it("keeps the route base path unchanged without a forwarded prefix", () => {
    expect(resolveForwardedRuntimeBasePath("/vivd-studio/api/preview/site/v1", null)).toBe(
      "/vivd-studio/api/preview/site/v1",
    );
  });

  it("prefixes runtime routes with the forwarded base path", () => {
    expect(
      resolveForwardedRuntimeBasePath(
        "/vivd-studio/api/preview/site/v1",
        "/_studio/runtime-123",
      ),
    ).toBe("/_studio/runtime-123/vivd-studio/api/preview/site/v1");
  });

  it("normalizes trailing slashes before joining", () => {
    expect(
      resolveForwardedRuntimeBasePath(
        "/vivd-studio/api/devpreview/site/v1/",
        "/_studio/runtime-123/",
      ),
    ).toBe("/_studio/runtime-123/vivd-studio/api/devpreview/site/v1");
  });
});
