import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  projectPluginAccessRequestFindFirstMock,
  projectPluginAccessRequestFindManyMock,
  organizationFindFirstMock,
  projectMetaFindFirstMock,
  insertMock,
  insertValuesMock,
  insertOnConflictDoUpdateMock,
  insertReturningMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
} = vi.hoisted(() => {
  const projectPluginAccessRequestFindFirstMock = vi.fn();
  const projectPluginAccessRequestFindManyMock = vi.fn();
  const organizationFindFirstMock = vi.fn();
  const projectMetaFindFirstMock = vi.fn();

  const insertReturningMock = vi.fn();
  const insertOnConflictDoUpdateMock = vi.fn(() => ({
    returning: insertReturningMock,
  }));
  const insertValuesMock = vi.fn(() => ({
    onConflictDoUpdate: insertOnConflictDoUpdateMock,
  }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    projectPluginAccessRequestFindFirstMock,
    projectPluginAccessRequestFindManyMock,
    organizationFindFirstMock,
    projectMetaFindFirstMock,
    insertMock,
    insertValuesMock,
    insertOnConflictDoUpdateMock,
    insertReturningMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
  };
});

const { getResolvedBrandingMock } = vi.hoisted(() => ({
  getResolvedBrandingMock: vi.fn(),
}));

const { sendEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
}));

vi.mock("../src/db", () => ({
  db: {
    query: {
      projectPluginAccessRequest: {
        findFirst: projectPluginAccessRequestFindFirstMock,
        findMany: projectPluginAccessRequestFindManyMock,
      },
      organization: {
        findFirst: organizationFindFirstMock,
      },
      projectMeta: {
        findFirst: projectMetaFindFirstMock,
      },
    },
    insert: insertMock,
    update: updateMock,
  },
}));

vi.mock("../src/services/email/templateBranding", () => ({
  emailTemplateBrandingService: {
    getResolvedBranding: getResolvedBrandingMock,
  },
}));

vi.mock("../src/services/integrations/EmailDeliveryService", () => ({
  getEmailDeliveryService: () => ({
    send: sendEmailMock,
  }),
}));

import { pluginAccessRequestService } from "../src/services/plugins/PluginAccessRequestService";

describe("pluginAccessRequestService", () => {
  beforeEach(() => {
    projectPluginAccessRequestFindFirstMock.mockReset();
    projectPluginAccessRequestFindManyMock.mockReset();
    organizationFindFirstMock.mockReset();
    projectMetaFindFirstMock.mockReset();
    insertMock.mockClear();
    insertValuesMock.mockClear();
    insertOnConflictDoUpdateMock.mockClear();
    insertReturningMock.mockReset();
    updateMock.mockClear();
    updateSetMock.mockClear();
    updateWhereMock.mockReset();
    getResolvedBrandingMock.mockReset();
    sendEmailMock.mockReset();

    organizationFindFirstMock.mockResolvedValue({
      name: "Default",
      slug: "default",
    });
    projectMetaFindFirstMock.mockResolvedValue({
      title: "Nudels without Pesto",
      slug: "nudels-without-pesto",
    });
    getResolvedBrandingMock.mockResolvedValue({
      supportEmail: "support@vivd.studio",
    });
    sendEmailMock.mockResolvedValue({
      accepted: true,
      provider: "noop",
      messageId: "message-1",
    });
    updateWhereMock.mockResolvedValue([]);
  });

  it("returns an empty map when the access request table is not readable yet", async () => {
    projectPluginAccessRequestFindManyMock.mockRejectedValueOnce(
      new Error(
        'Failed query: select ... from "project_plugin_access_request" where ("projectPluginAccessRequest"."organization_id" = $1)',
      ),
    );

    await expect(
      pluginAccessRequestService.listRequestStates({
        organizationId: "default",
        projectSlug: "nudels-without-pesto",
        pluginIds: ["contact_form", "analytics"],
      }),
    ).resolves.toEqual(new Map());
  });

  it("returns not_requested when the access request table is missing", async () => {
    projectPluginAccessRequestFindFirstMock.mockRejectedValueOnce({
      message: 'relation "project_plugin_access_request" does not exist',
      code: "42P01",
    });

    await expect(
      pluginAccessRequestService.getRequestState({
        organizationId: "default",
        projectSlug: "nudels-without-pesto",
        pluginId: "contact_form",
      }),
    ).resolves.toEqual({
      status: "not_requested",
      requestedAt: null,
      requestedByUserId: null,
      requesterEmail: null,
    });
  });

  it("still sends the request email and returns pending when storage is behind", async () => {
    projectPluginAccessRequestFindFirstMock.mockResolvedValueOnce(null);
    insertReturningMock.mockRejectedValueOnce({
      message: 'column "requested_by_user_id" does not exist',
      code: "42703",
    });

    await expect(
      pluginAccessRequestService.requestAccess({
        organizationId: "default",
        projectSlug: "nudels-without-pesto",
        pluginId: "contact_form",
        requestedByUserId: "user-1",
        requesterEmail: "user@example.com",
        requesterName: "User",
      }),
    ).resolves.toEqual({
      status: "pending",
      requestedAt: expect.any(String),
      requestedByUserId: "user-1",
      requesterEmail: "user@example.com",
    });

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["support@vivd.studio"],
        metadata: expect.objectContaining({
          plugin_id: "contact_form",
          organization_id: "default",
          project_slug: "nudels-without-pesto",
        }),
      }),
    );
  });
});
