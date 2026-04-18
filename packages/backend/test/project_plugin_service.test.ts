import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContactFormPluginService } from "@vivd/plugin-contact-form/backend/service";
import { db } from "../src/db";
import { projectPluginInstance } from "../src/db/schema";
import {
  ensureProjectPluginInstance,
  getProjectPluginInstance,
} from "../src/services/plugins/core/instanceStore";

const {
  findFirstMock,
  organizationMemberFindManyMock,
  contactFormRecipientVerificationFindManyMock,
  insertMock,
  insertValuesMock,
  insertReturningMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
} = vi.hoisted(() => {
  const findFirstMock = vi.fn();
  const organizationMemberFindManyMock = vi.fn();
  const contactFormRecipientVerificationFindManyMock = vi.fn();

  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn();
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    findFirstMock,
    organizationMemberFindManyMock,
    contactFormRecipientVerificationFindManyMock,
    insertMock,
    insertValuesMock,
    insertReturningMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    updateReturningMock,
  };
});

const {
  listVerifiedExternalRecipientEmailSetMock,
  markRecipientVerifiedMock,
  syncProjectTurnstileWidgetMock,
} = vi.hoisted(() => ({
  listVerifiedExternalRecipientEmailSetMock: vi.fn(),
  markRecipientVerifiedMock: vi.fn(),
  syncProjectTurnstileWidgetMock: vi.fn(),
}));

vi.mock("../src/db", () => ({
  db: {
    query: {
      projectPluginInstance: {
        findFirst: findFirstMock,
        findMany: vi.fn().mockResolvedValue([]),
      },
      organizationMember: {
        findMany: organizationMemberFindManyMock,
      },
      contactFormRecipientVerification: {
        findMany: contactFormRecipientVerificationFindManyMock,
      },
    },
    insert: insertMock,
    update: updateMock,
  },
}));

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ppi-1",
    organizationId: "org-1",
    projectSlug: "site-1",
    pluginId: "contact_form",
    status: "enabled",
    configJson: {},
    publicToken: "ppi-1.public-token",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("contactFormPluginService", () => {
  const buildService = () =>
    createContactFormPluginService({
      projectPluginInstanceService: {
        ensurePluginInstance: ensureProjectPluginInstance,
        getPluginInstance: getProjectPluginInstance,
        async updatePluginInstance(hostOptions) {
          const updates: {
            configJson?: unknown;
            status?: string;
            updatedAt: Date;
          } = {
            updatedAt: hostOptions.updatedAt ?? new Date(),
          };
          if (Object.prototype.hasOwnProperty.call(hostOptions, "configJson")) {
            updates.configJson = hostOptions.configJson;
          }
          if (typeof hostOptions.status === "string") {
            updates.status = hostOptions.status;
          }

          const [updated] = await db
            .update(projectPluginInstance)
            .set(updates)
            .where(eq(projectPluginInstance.id, hostOptions.instanceId))
            .returning();

          return updated ?? null;
        },
      },
      pluginEntitlementService: {
        resolveEffectiveEntitlement: vi.fn(),
      },
      recipientVerificationService: {
        listRecipientDirectory: vi.fn().mockResolvedValue({
          options: [],
          pending: [],
        }),
        listVerifiedExternalRecipientEmailSet:
          listVerifiedExternalRecipientEmailSetMock,
        requestRecipientVerification: vi.fn(),
        markRecipientVerified: markRecipientVerifiedMock,
        verifyRecipientByToken: vi.fn(),
      },
      getContactFormSubmitEndpoint: vi
        .fn()
        .mockResolvedValue("https://api.vivd.studio/plugins/contact/v1/submit"),
      inferSourceHosts: vi.fn().mockResolvedValue([]),
      async listVerifiedOrganizationMemberEmails() {
        const members = await organizationMemberFindManyMock();
        return members
          .filter((member: any) => member.user.emailVerified)
          .map((member: any) => member.user.email);
      },
      syncProjectTurnstileWidget: syncProjectTurnstileWidgetMock,
    });

  beforeEach(() => {
    findFirstMock.mockReset();
    organizationMemberFindManyMock.mockReset();
    contactFormRecipientVerificationFindManyMock.mockReset();
    listVerifiedExternalRecipientEmailSetMock.mockReset();
    markRecipientVerifiedMock.mockReset();
    syncProjectTurnstileWidgetMock.mockReset();
    insertMock.mockClear();
    insertValuesMock.mockClear();
    insertReturningMock.mockReset();
    updateMock.mockClear();
    updateSetMock.mockClear();
    updateWhereMock.mockClear();
    updateReturningMock.mockReset();
    organizationMemberFindManyMock.mockResolvedValue([
      {
        user: {
          email: "verified@example.com",
          emailVerified: true,
        },
      },
    ]);
    listVerifiedExternalRecipientEmailSetMock.mockResolvedValue(new Set());
    markRecipientVerifiedMock.mockResolvedValue({
      email: "person@example.com",
      status: "marked_verified",
      cooldownRemainingSeconds: 0,
    });
  });

  it("returns existing enabled instances idempotently", async () => {
    const contactFormPluginService = buildService();
    const existing = makeRow({ status: "enabled" });
    findFirstMock.mockResolvedValueOnce(existing);

    const result = await contactFormPluginService.ensureContactFormPlugin({
      organizationId: "org-1",
      projectSlug: "site-1",
    });

    expect(result.created).toBe(false);
    expect(result.instanceId).toBe(existing.id);
    expect(result.status).toBe("enabled");
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("re-enables existing disabled instances instead of creating duplicates", async () => {
    const contactFormPluginService = buildService();
    const existingDisabled = makeRow({ status: "disabled" });
    const updatedEnabled = makeRow({
      status: "enabled",
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    findFirstMock.mockResolvedValueOnce(existingDisabled);
    updateReturningMock.mockResolvedValueOnce([updatedEnabled]);

    const result = await contactFormPluginService.ensureContactFormPlugin({
      organizationId: "org-1",
      projectSlug: "site-1",
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(false);
    expect(result.status).toBe("enabled");
    expect(result.instanceId).toBe(updatedEnabled.id);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("recovers from unique conflicts by loading the concurrently-created row", async () => {
    const contactFormPluginService = buildService();
    const concurrentRow = makeRow({
      id: "ppi-concurrent",
      publicToken: "ppi-concurrent.token",
    });
    findFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentRow);
    insertReturningMock.mockRejectedValueOnce({ code: "23505" });

    const result = await contactFormPluginService.ensureContactFormPlugin({
      organizationId: "org-1",
      projectSlug: "site-1",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(false);
    expect(result.instanceId).toBe("ppi-concurrent");
  });

  it("persists config when recipient emails are verified", async () => {
    const contactFormPluginService = buildService();
    const existing = makeRow({ status: "enabled" });
    const updated = makeRow({
      configJson: {
        recipientEmails: ["verified@example.com"],
      },
    });

    findFirstMock.mockResolvedValueOnce(existing);
    updateReturningMock.mockResolvedValueOnce([updated]);

    const result = await contactFormPluginService.updateContactFormConfig({
      organizationId: "org-1",
      projectSlug: "site-1",
      config: {
        recipientEmails: ["verified@example.com"],
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
    });

    expect(result.config.recipientEmails).toEqual(["verified@example.com"]);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("rejects recipient emails that are not verified in the organization", async () => {
    const contactFormPluginService = buildService();
    await expect(
      contactFormPluginService.updateContactFormConfig({
        organizationId: "org-1",
        projectSlug: "site-1",
        config: {
          recipientEmails: ["unverified@example.com", "VERIFIED@example.com"],
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
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ContactFormRecipientVerificationError",
        recipientEmails: ["unverified@example.com"],
      }),
    );

    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects saves when recipient email list is empty", async () => {
    const contactFormPluginService = buildService();
    await expect(
      contactFormPluginService.updateContactFormConfig({
        organizationId: "org-1",
        projectSlug: "site-1",
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
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ContactFormRecipientRequiredError",
        message: "At least one verified recipient email is required",
      }),
    );

    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects manually marking a recipient verified when the plugin is not enabled", async () => {
    const contactFormPluginService = buildService();
    findFirstMock.mockResolvedValueOnce(makeRow({ status: "disabled" }));

    await expect(
      contactFormPluginService.markRecipientVerified({
        organizationId: "org-1",
        projectSlug: "site-1",
        email: "person@example.com",
        requestedByUserId: "user-1",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ContactFormPluginNotEnabledError",
        message: "Contact Form plugin is not enabled for this project",
      }),
    );
  });
});
