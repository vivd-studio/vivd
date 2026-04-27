import { describe, expect, it } from "vitest";
import { classifyStudioBootstrapStatusResponse } from "./studioBootstrapStatus";

describe("classifyStudioBootstrapStatusResponse", () => {
  it("classifies structured ready status as bootstrap-ready", () => {
    expect(
      classifyStudioBootstrapStatusResponse({
        ok: true,
        status: 200,
        retryAfter: null,
        payload: {
          status: "ready",
          retryable: false,
          canBootstrap: true,
          message: "Studio is ready",
        },
        bodyText: "",
      }),
    ).toMatchObject({ kind: "ready" });
  });

  it("keeps structured runtime_starting responses on the startup path", () => {
    expect(
      classifyStudioBootstrapStatusResponse({
        ok: false,
        status: 503,
        retryAfter: "2",
        payload: {
          status: "starting",
          code: "runtime_starting",
          retryable: true,
          canBootstrap: false,
          message: "Studio is starting",
        },
        bodyText: "",
      }),
    ).toMatchObject({ kind: "starting", retryAfterMs: 2_000 });
  });

  it("classifies structured bootstrap_unconfigured as terminal", () => {
    expect(
      classifyStudioBootstrapStatusResponse({
        ok: false,
        status: 503,
        retryAfter: null,
        payload: {
          status: "failed",
          code: "bootstrap_unconfigured",
          retryable: false,
          canBootstrap: false,
          message: "Studio bootstrap is not configured",
        },
        bodyText: "",
      }),
    ).toMatchObject({
      kind: "failed",
      failure: {
        code: "bootstrap_unconfigured",
        retryable: false,
        source: "bootstrap",
      },
    });
  });

  it("treats a missing status endpoint as legacy-ready", () => {
    expect(
      classifyStudioBootstrapStatusResponse({
        ok: false,
        status: 404,
        retryAfter: null,
        payload: null,
        bodyText: "Not found",
      }),
    ).toMatchObject({ kind: "ready", legacy: true });
  });
});
