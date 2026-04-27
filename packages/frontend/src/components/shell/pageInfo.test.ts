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

    expect(getPageInfo("/vivd-studio/projects/demo/plugins/analytics")).toMatchObject({
      title: "Analytics",
      isProjectPage: false,
      projectSlug: "demo",
      isProjectPluginPage: true,
      projectPluginId: "analytics",
    });
  });

  it("treats the scratch route as a non-project page with its own content shell", () => {
    expect(getPageInfo("/vivd-studio/projects/new/scratch")).toMatchObject({
      title: "New project",
      isProjectPage: false,
      usesImmersiveSidebar: true,
      isScratchWizardPage: true,
    });
  });

  it("marks project overview routes as immersive-sidebar pages", () => {
    expect(getPageInfo("/vivd-studio/projects/demo")).toMatchObject({
      title: "Projects",
      isProjectPage: true,
      usesImmersiveSidebar: true,
      projectSlug: "demo",
    });
  });

  it("marks the projects index as a framed content page", () => {
    const pageInfo = getPageInfo("/vivd-studio");

    expect(pageInfo).toMatchObject({
      title: "Projects",
      isProjectPage: false,
      isProjectsIndexPage: true,
    });
    expect(pageInfo.usesImmersiveSidebar).toBeUndefined();
  });
});
