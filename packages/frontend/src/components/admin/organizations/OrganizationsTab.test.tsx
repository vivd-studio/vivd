import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useOrganizationsAdminMock } = vi.hoisted(() => ({
  useOrganizationsAdminMock: vi.fn(),
}));

vi.mock("./useOrganizationsAdmin", () => ({
  useOrganizationsAdmin: useOrganizationsAdminMock,
}));

vi.mock("./components/UsageLimitsPanel", () => ({
  UsageLimitsPanel: () => <div>Usage panel</div>,
}));

vi.mock("./components/MembersPanel", () => ({
  MembersPanel: () => <div>Members panel</div>,
}));

vi.mock("./components/DomainsPanel", () => ({
  DomainsPanel: () => <div>Domains panel</div>,
}));

import { OrganizationsTab } from "./OrganizationsTab";

function makeAdmin(overrides: Record<string, unknown> = {}) {
  return {
    isLoading: false,
    error: null,
    selectedOrg: {
      id: "org-1",
      name: "Acme",
      slug: "acme",
      status: "active",
      memberCount: 7,
      githubRepoPrefix: "acme-web",
      limits: {},
    },
    usage: {
      limits: {
        blocked: false,
        imageGenBlocked: false,
      },
    },
    usageLoading: false,
    usageError: null,
    projectsLoading: false,
    projects: [{ id: "project-1" }, { id: "project-2" }],
    domainsLoading: false,
    domainsError: null,
    domains: [{ domain: "acme.example.com" }],
    limitsForm: {
      dailyCreditLimit: "1000",
      weeklyCreditLimit: "2500",
      monthlyCreditLimit: "5000",
      imageGenPerMonth: "25",
      warningThreshold: "0.8",
      maxProjects: "0",
    },
    setLimitsForm: vi.fn(),
    patchLimits: {
      isPending: false,
      error: null,
      mutateAsync: vi.fn(),
    },
    userForm: {
      email: "",
      name: "",
      password: "",
      organizationRole: "admin",
      projectSlug: "",
    },
    setUserForm: vi.fn(),
    createUser: {
      isPending: false,
      error: null,
      mutate: vi.fn(),
    },
    membersLoading: false,
    membersError: null,
    members: [],
    memberEdits: {},
    setMemberEdits: vi.fn(),
    updateMemberRole: {
      isPending: false,
      mutate: vi.fn(),
    },
    removeMember: {
      isPending: false,
      mutate: vi.fn(),
    },
    addDomain: {
      isPending: false,
      mutate: vi.fn(),
    },
    setDomainStatus: {
      isPending: false,
      mutate: vi.fn(),
    },
    setDomainUsage: {
      isPending: false,
      mutate: vi.fn(),
    },
    startDomainVerification: {
      isPending: false,
      mutate: vi.fn(),
    },
    checkDomainVerification: {
      isPending: false,
      mutate: vi.fn(),
    },
    removeDomain: {
      isPending: false,
      mutate: vi.fn(),
    },
    orgNameForm: "Acme",
    setOrgNameForm: vi.fn(),
    renameOrg: {
      isPending: false,
      mutate: vi.fn(),
    },
    githubPrefixForm: "acme-web",
    setGithubPrefixForm: vi.fn(),
    saveGitHubPrefix: {
      isPending: false,
      mutate: vi.fn(),
    },
    deleteOrg: {
      isPending: false,
      mutate: vi.fn(),
    },
    ...overrides,
  };
}

describe("OrganizationsTab", () => {
  beforeEach(() => {
    useOrganizationsAdminMock.mockReset();
  });

  it("renders the workspace summary and structured settings metadata", () => {
    useOrganizationsAdminMock.mockReturnValue(makeAdmin());

    render(
      <OrganizationsTab
        selectedOrgId="org-1"
        activeTab="settings"
        onTabChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByText("Workspace summary")).toBeInTheDocument();
    expect(screen.getAllByText("Organization ID")).not.toHaveLength(0);
    expect(screen.getByText("Repository defaults")).toBeInTheDocument();
    expect(screen.getByText("acme-web-<project-slug>")).toBeInTheDocument();
  });

  it("keeps delete disabled for the default organization", () => {
    useOrganizationsAdminMock.mockReturnValue(
      makeAdmin({
        selectedOrg: {
          id: "default",
          name: "Default Org",
          slug: "default",
          status: "active",
          memberCount: 1,
          githubRepoPrefix: "",
          limits: {},
        },
        orgNameForm: "Default Org",
        githubPrefixForm: "",
      }),
    );

    render(
      <OrganizationsTab
        selectedOrgId="default"
        activeTab="settings"
        onTabChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "The default organization stays in place as the platform fallback tenant.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete organization" }),
    ).toBeDisabled();
  });
});
