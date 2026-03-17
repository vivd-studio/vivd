import { describe, expect, it } from "vitest";
import { getPageInfo } from "./pageInfo";

describe("getPageInfo", () => {
  it("treats super admin routes as super admin pages", () => {
    expect(getPageInfo("/vivd-studio/superadmin")).toMatchObject({
      title: "Super Admin",
      isProjectPage: false,
    });

    expect(getPageInfo("/vivd-studio/superadmin/users")).toMatchObject({
      title: "Super Admin",
      isProjectPage: false,
    });
  });

  it("preserves project route parsing for project sub-pages", () => {
    expect(getPageInfo("/vivd-studio/projects/demo/plugins")).toMatchObject({
      title: "Plugins",
      isProjectPage: false,
      projectSlug: "demo",
      isProjectPluginsPage: true,
    });
  });
});
