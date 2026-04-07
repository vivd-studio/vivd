import { describe, expect, it } from "vitest";
import { formatDocumentTitle, getRouteDocumentTitle } from "./brand";

describe("brand titles", () => {
  it("formats page titles with capitalized branding", () => {
    expect(formatDocumentTitle()).toBe("Vivd");
    expect(formatDocumentTitle("Projects")).toBe("Projects · Vivd");
  });

  it("returns route-aware titles for top-level screens", () => {
    expect(getRouteDocumentTitle("/vivd-studio")).toBe("Projects · Vivd");
    expect(getRouteDocumentTitle("/vivd-studio/login")).toBe("Login · Vivd");
    expect(getRouteDocumentTitle("/vivd-studio/org", "?tab=plugins")).toBe(
      "Organization Plugins · Vivd",
    );
    expect(
      getRouteDocumentTitle("/vivd-studio/superadmin", "?section=machines"),
    ).toBe("Machines · Vivd");
  });

  it("derives readable project titles from project routes", () => {
    expect(getRouteDocumentTitle("/vivd-studio/projects/acme-studio")).toBe(
      "Acme Studio · Vivd",
    );
    expect(
      getRouteDocumentTitle("/vivd-studio/projects/acme-studio/plugins/analytics"),
    ).toBe("Acme Studio Analytics · Vivd");
    expect(
      getRouteDocumentTitle("/vivd-studio/projects/acme-studio/fullscreen"),
    ).toBe("Acme Studio Preview · Vivd");
  });
});
