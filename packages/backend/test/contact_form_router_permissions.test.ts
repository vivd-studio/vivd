import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureProjectPluginInstanceMock,
  getProjectPluginInfoMock,
  updateProjectPluginConfigMock,
} = vi.hoisted(() => ({
  ensureProjectPluginInstanceMock: vi.fn(),
  getProjectPluginInfoMock: vi.fn(),
  updateProjectPluginConfigMock: vi.fn(),
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

vi.mock("../src/services/plugins/PluginEntitlementService", () => ({
  pluginEntitlementService: {
    resolveEffectiveEntitlement: resolveEffectiveEntitlementMock,
  },
}));

vi.mock("../src/trpcRouters/plugins/operations", () => ({
  ensureProjectPluginInstance: ensureProjectPluginInstanceMock,
  getProjectPluginInfo: getProjectPluginInfoMock,
  updateProjectPluginConfig: updateProjectPluginConfigMock,
  runProjectPluginAction: vi.fn(),
  extractRequestHost: vi.fn(() => "app.vivd.local"),
}));

import { router } from "../src/trpc";
import {
  contactEnsurePluginProcedure,
  contactUpdateConfigPluginProcedure,
} from "../src/trpcRouters/plugins/contactForm";

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    req: { headers: {} } as any,
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
    contactUpdateConfig: contactUpdateConfigPluginProcedure,
  });

  beforeEach(() => {
    ensureProjectPluginInstanceMock.mockReset();
    getProjectPluginInfoMock.mockReset();
    updateProjectPluginConfigMock.mockReset();
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
      turnstileEnabled: false,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
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
    expect(ensureProjectPluginInstanceMock).not.toHaveBeenCalled();
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
      turnstileEnabled: false,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
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
    expect(ensureProjectPluginInstanceMock).not.toHaveBeenCalled();
  });

  it("allows super-admin users", async () => {
    ensureProjectPluginInstanceMock.mockResolvedValueOnce({
      instanceId: "ppi-1",
      created: false,
      status: "enabled",
    });
    getProjectPluginInfoMock.mockResolvedValueOnce({
      pluginId: "contact_form",
      entitled: true,
      entitlementState: "enabled",
      enabled: true,
      instanceId: "ppi-1",
      status: "enabled",
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
      usage: null,
      details: null,
      instructions: [],
      defaultConfig: {},
      catalog: {
        pluginId: "contact_form",
        name: "Contact Form",
        description: "",
        capabilities: {
          supportsInfo: true,
          config: null,
          actions: [],
        },
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
    expect(ensureProjectPluginInstanceMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
    });
    expect(getProjectPluginInfoMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
    });
  });

  it("maps unverified-recipient config errors to BAD_REQUEST", async () => {
    updateProjectPluginConfigMock.mockRejectedValueOnce(
      new TRPCError({
        code: "BAD_REQUEST",
        message: "Recipient email is not verified for this project: unverified@example.com",
      }),
    );

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.contactUpdateConfig({
        slug: "site-1",
        config: {
          recipientEmails: ["unverified@example.com"],
          sourceHosts: [],
          redirectHostAllowlist: [],
          formFields: [
            {
              key: "name",
              label: "Name",
              type: "text",
              required: true,
              placeholder: "",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Recipient email is not verified for this project: unverified@example.com",
    });
  });

  it("maps empty-recipient config errors to BAD_REQUEST", async () => {
    updateProjectPluginConfigMock.mockRejectedValueOnce(
      new TRPCError({
        code: "BAD_REQUEST",
        message: "At least one verified recipient email is required",
      }),
    );

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.contactUpdateConfig({
        slug: "site-1",
        config: {
          recipientEmails: [],
          sourceHosts: [],
          redirectHostAllowlist: [],
          formFields: [
            {
              key: "name",
              label: "Name",
              type: "text",
              required: true,
              placeholder: "",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "At least one verified recipient email is required",
    });
  });
});
