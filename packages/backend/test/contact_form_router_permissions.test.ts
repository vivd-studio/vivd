import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureContactFormPluginMock } = vi.hoisted(() => ({
  ensureContactFormPluginMock: vi.fn(),
}));
const { resolveEffectiveEntitlementMock } = vi.hoisted(() => ({
  resolveEffectiveEntitlementMock: vi.fn(),
}));

const { organizationFindFirstMock, selectMock, selectFromMock, selectWhereMock } = vi.hoisted(
  () => {
    const selectWhereMock = vi.fn().mockResolvedValue([]);
    const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
    const selectMock = vi.fn(() => ({ from: selectFromMock }));
    return {
      organizationFindFirstMock: vi.fn(),
      selectMock,
      selectFromMock,
      selectWhereMock,
    };
  },
);

vi.mock("../src/db", () => ({
  db: {
    select: selectMock,
    query: {
      organization: {
        findFirst: organizationFindFirstMock,
      },
    },
  },
}));

vi.mock("../src/services/plugins/ProjectPluginService", () => ({
  projectPluginService: {
    ensureContactFormPlugin: ensureContactFormPluginMock,
  },
}));

vi.mock("../src/services/plugins/PluginEntitlementService", () => ({
  pluginEntitlementService: {
    resolveEffectiveEntitlement: resolveEffectiveEntitlementMock,
  },
}));

import { router } from "../src/trpc";
import { contactEnsurePluginProcedure } from "../src/trpcRouters/plugins/contactForm";

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    req: {} as any,
    res: {} as any,
    session: {
      session: {
        id: "sess-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User",
        role: "user",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    requestHost: "app.vivd.local",
    requestDomain: "app.vivd.local",
    isSuperAdminHost: true,
    hostKind: "control_plane_host",
    hostOrganizationId: null,
    hostOrganizationSlug: null,
    canSelectOrganization: true,
    organizationId: "org-1",
    organizationRole: "owner",
    ...overrides,
  };
}

describe("plugins.contactEnsure permissions", () => {
  const pluginsRouter = router({
    contactEnsure: contactEnsurePluginProcedure,
  });

  beforeEach(() => {
    ensureContactFormPluginMock.mockReset();
    resolveEffectiveEntitlementMock.mockReset();
    organizationFindFirstMock.mockReset();
    selectMock.mockClear();
    selectFromMock.mockClear();
    selectWhereMock.mockReset();
    organizationFindFirstMock.mockResolvedValue({ status: "active" });
    selectWhereMock.mockResolvedValue([]);
    resolveEffectiveEntitlementMock.mockResolvedValue({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
      scope: "project",
      state: "enabled",
      managedBy: "manual_superadmin",
      monthlyEventLimit: null,
      hardStop: true,
      notes: "",
      changedByUserId: null,
      updatedAt: new Date(),
    });
  });

  it("rejects non-super-admin users", async () => {
    const caller = pluginsRouter.createCaller(makeContext());

    await expect(caller.contactEnsure({ slug: "site-1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Only super-admin users can enable plugins",
    });
    expect(ensureContactFormPluginMock).not.toHaveBeenCalled();
  });

  it("rejects when entitlement is not enabled", async () => {
    resolveEffectiveEntitlementMock.mockResolvedValueOnce({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
      scope: "project",
      state: "disabled",
      managedBy: "manual_superadmin",
      monthlyEventLimit: null,
      hardStop: true,
      notes: "",
      changedByUserId: null,
      updatedAt: new Date(),
    });

    const caller = pluginsRouter.createCaller(
      makeContext({
        session: {
          session: {
            id: "sess-1",
            userId: "user-1",
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
            updatedAt: new Date(),
            ipAddress: null,
            userAgent: null,
          },
          user: {
            id: "user-1",
            email: "sa@example.com",
            name: "Super Admin",
            role: "super_admin",
            emailVerified: true,
            image: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        organizationRole: null,
      }),
    );

    await expect(caller.contactEnsure({ slug: "site-1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Contact Form is not entitled for this project",
    });
    expect(ensureContactFormPluginMock).not.toHaveBeenCalled();
  });

  it("allows super-admin users", async () => {
    ensureContactFormPluginMock.mockResolvedValueOnce({
      pluginId: "contact_form",
      instanceId: "ppi-1",
      status: "enabled",
      created: false,
      publicToken: "ppi-1.token",
      config: {
        recipientEmails: [],
        sourceHosts: [],
        redirectHostAllowlist: [],
        formFields: [],
      },
      snippets: {
        html: "<form></form>",
        astro: "<form></form>",
      },
    });

    const caller = pluginsRouter.createCaller(
      makeContext({
        session: {
          session: {
            id: "sess-1",
            userId: "user-1",
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
            updatedAt: new Date(),
            ipAddress: null,
            userAgent: null,
          },
          user: {
            id: "user-1",
            email: "sa@example.com",
            name: "Super Admin",
            role: "super_admin",
            emailVerified: true,
            image: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        organizationRole: null,
      }),
    );

    await expect(caller.contactEnsure({ slug: "site-1" })).resolves.toMatchObject({
      pluginId: "contact_form",
      instanceId: "ppi-1",
      status: "enabled",
    });
    expect(ensureContactFormPluginMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
    });
  });
});
