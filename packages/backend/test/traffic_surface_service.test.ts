import { describe, expect, it } from "vitest";
import { classifyTrafficSurface } from "../src/services/system/TrafficSurfaceService";

describe("classifyTrafficSurface", () => {
  it("classifies control-plane paths as platform traffic", () => {
    expect(
      classifyTrafficSurface({
        hostKind: "control_plane_host",
        requestHost: "app.vivd.studio",
        requestPath: "/vivd-studio/projects/demo",
        controlPlaneHost: "app.vivd.studio",
      }),
    ).toBe("platform");
  });

  it("classifies dedicated plugin API host requests as public ingest", () => {
    expect(
      classifyTrafficSurface({
        hostKind: "unknown",
        requestHost: "api.vivd.studio",
        requestPath: "/plugins/contact-form/v1/submit",
        publicPluginApiHost: "api.vivd.studio",
      }),
    ).toBe("public_ingest");
  });

  it("classifies published domains as public site traffic", () => {
    expect(
      classifyTrafficSurface({
        hostKind: "published_domain",
        requestHost: "customer.example.com",
        requestPath: "/",
        controlPlaneHost: "app.vivd.studio",
      }),
    ).toBe("public_site");
  });

  it("keeps same-host plugin endpoints on the control-plane host in the platform surface", () => {
    expect(
      classifyTrafficSurface({
        hostKind: "control_plane_host",
        requestHost: "app.vivd.studio",
        requestPath: "/plugins/analytics/v1/track",
        controlPlaneHost: "app.vivd.studio",
        publicPluginApiHost: "api.vivd.studio",
      }),
    ).toBe("platform");
  });

  it("classifies preview traffic separately", () => {
    expect(
      classifyTrafficSurface({
        hostKind: "control_plane_host",
        requestHost: "app.vivd.studio",
        requestPath: "/vivd-studio/api/preview/demo/v1/index.html",
        controlPlaneHost: "app.vivd.studio",
      }),
    ).toBe("preview");
  });
});
