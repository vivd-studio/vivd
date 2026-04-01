import { describe, expect, it } from "vitest";

import {
  buildHostOrigin,
  inferSchemeForHost,
  isLocalDevelopmentHost,
  resolveLocalDevelopmentHost,
  stripPort,
} from "./localHostRouting";

describe("localHostRouting", () => {
  it("detects local development hosts even when they include a port", () => {
    expect(isLocalDevelopmentHost("app.localhost:18080")).toBe(true);
    expect(isLocalDevelopmentHost("app.vivd.studio")).toBe(false);
  });

  it("preserves the active local dev port when the target host omits one", () => {
    expect(
      resolveLocalDevelopmentHost("app.localhost", "default.localhost:18080"),
    ).toBe("app.localhost:18080");
  });

  it("does not override an explicitly configured target port", () => {
    expect(
      resolveLocalDevelopmentHost("app.localhost:19090", "default.localhost:18080"),
    ).toBe("app.localhost:19090");
  });

  it("builds origins that preserve the current local dev port", () => {
    expect(buildHostOrigin("app.localhost", "default.localhost:18080")).toBe(
      "http://app.localhost:18080",
    );
  });

  it("keeps production hosts unchanged", () => {
    expect(buildHostOrigin("app.vivd.studio", "felix.vivd.studio")).toBe(
      "https://app.vivd.studio",
    );
  });

  it("strips ports consistently", () => {
    expect(stripPort("app.localhost:18080")).toBe("app.localhost");
    expect(inferSchemeForHost("app.localhost:18080")).toBe("http");
  });
});
