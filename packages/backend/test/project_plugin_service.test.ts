import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findFirstMock,
  organizationMemberFindManyMock,
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
    insertMock,
    insertValuesMock,
    insertReturningMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    updateReturningMock,
  };
});

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
    },
    insert: insertMock,
    update: updateMock,
  },
}));

import { projectPluginService } from "../src/services/plugins/ProjectPluginService";

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

describe("ProjectPluginService.ensureContactFormPlugin", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    organizationMemberFindManyMock.mockReset();
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
  });

  it("returns existing enabled instances idempotently", async () => {
    const existing = makeRow({ status: "enabled" });
    findFirstMock.mockResolvedValueOnce(existing);

    const result = await projectPluginService.ensureContactFormPlugin({
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
    const existingDisabled = makeRow({ status: "disabled" });
    const updatedEnabled = makeRow({
      status: "enabled",
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    findFirstMock.mockResolvedValueOnce(existingDisabled);
    updateReturningMock.mockResolvedValueOnce([updatedEnabled]);

    const result = await projectPluginService.ensureContactFormPlugin({
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
    const concurrentRow = makeRow({
      id: "ppi-concurrent",
      publicToken: "ppi-concurrent.token",
    });
    findFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentRow);
    insertReturningMock.mockRejectedValueOnce({ code: "23505" });

    const result = await projectPluginService.ensureContactFormPlugin({
      organizationId: "org-1",
      projectSlug: "site-1",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(false);
    expect(result.instanceId).toBe("ppi-concurrent");
    expect(result.publicToken).toBe("ppi-concurrent.token");
  });

  it("persists config when recipient emails are verified", async () => {
    const existing = makeRow({ status: "enabled" });
    const updated = makeRow({
      configJson: {
        recipientEmails: ["verified@example.com"],
      },
    });

    findFirstMock.mockResolvedValueOnce(existing);
    updateReturningMock.mockResolvedValueOnce([updated]);

    const result = await projectPluginService.updateContactFormConfig({
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
    await expect(
      projectPluginService.updateContactFormConfig({
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
    await expect(
      projectPluginService.updateContactFormConfig({
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
});
