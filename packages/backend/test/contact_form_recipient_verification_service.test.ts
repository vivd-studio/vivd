import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  projectPluginInstanceFindFirstMock,
  organizationMemberFindManyMock,
  contactFormRecipientVerificationFindFirstMock,
  dbTransactionMock,
  txInsertMock,
  txInsertValuesMock,
  txUpdateMock,
  txUpdateSetMock,
  txUpdateWhereMock,
} = vi.hoisted(() => {
  const projectPluginInstanceFindFirstMock = vi.fn();
  const organizationMemberFindManyMock = vi.fn();
  const contactFormRecipientVerificationFindFirstMock = vi.fn();

  const txInsertValuesMock = vi.fn().mockResolvedValue(undefined);
  const txInsertMock = vi.fn(() => ({ values: txInsertValuesMock }));

  const txUpdateWhereMock = vi.fn().mockResolvedValue(undefined);
  const txUpdateSetMock = vi.fn(() => ({ where: txUpdateWhereMock }));
  const txUpdateMock = vi.fn(() => ({ set: txUpdateSetMock }));

  const tx = {
    insert: txInsertMock,
    update: txUpdateMock,
  };

  const dbTransactionMock = vi.fn(async (callback: (tx: typeof tx) => Promise<void>) => {
    await callback(tx);
  });

  return {
    projectPluginInstanceFindFirstMock,
    organizationMemberFindManyMock,
    contactFormRecipientVerificationFindFirstMock,
    dbTransactionMock,
    txInsertMock,
    txInsertValuesMock,
    txUpdateMock,
    txUpdateSetMock,
    txUpdateWhereMock,
  };
});

vi.mock("../src/db", () => ({
  db: {
    query: {
      projectPluginInstance: {
        findFirst: projectPluginInstanceFindFirstMock,
      },
      organizationMember: {
        findMany: organizationMemberFindManyMock,
      },
      contactFormRecipientVerification: {
        findFirst: contactFormRecipientVerificationFindFirstMock,
      },
    },
    transaction: dbTransactionMock,
  },
}));

vi.mock("../src/services/email/templates", () => ({
  buildContactRecipientVerificationEmail: vi.fn(),
  buildContactSubmissionEmail: vi.fn(),
}));

vi.mock("../src/services/integrations/EmailDeliveryService", () => ({
  getEmailDeliveryService: vi.fn(),
}));

import { contactFormRecipientVerificationService } from "../src/services/plugins/contactForm/recipientVerification";

describe("contactFormRecipientVerificationService.markRecipientVerified", () => {
  beforeEach(() => {
    projectPluginInstanceFindFirstMock.mockReset();
    organizationMemberFindManyMock.mockReset();
    contactFormRecipientVerificationFindFirstMock.mockReset();
    dbTransactionMock.mockClear();
    txInsertMock.mockClear();
    txInsertValuesMock.mockClear();
    txUpdateMock.mockClear();
    txUpdateSetMock.mockClear();
    txUpdateWhereMock.mockClear();

    projectPluginInstanceFindFirstMock.mockResolvedValue({
      id: "ppi-1",
      configJson: {
        recipientEmails: [],
        sourceHosts: [],
        redirectHostAllowlist: [],
        formFields: [],
      },
    });
    organizationMemberFindManyMock.mockResolvedValue([]);
    contactFormRecipientVerificationFindFirstMock.mockResolvedValue(null);
  });

  it("marks an external recipient verified and adds it to the plugin config", async () => {
    const result = await contactFormRecipientVerificationService.markRecipientVerified({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginInstanceId: "ppi-1",
      email: " Person@example.com ",
      requestedByUserId: "user-1",
    });

    expect(result).toEqual({
      email: "person@example.com",
      status: "marked_verified",
      cooldownRemainingSeconds: 0,
    });
    expect(dbTransactionMock).toHaveBeenCalledTimes(1);
    expect(txInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectSlug: "site-1",
        pluginInstanceId: "ppi-1",
        email: "person@example.com",
        status: "verified",
        verificationTokenHash: null,
        verificationTokenExpiresAt: null,
        lastSentAt: null,
        verifiedAt: expect.any(Date),
        createdByUserId: "user-1",
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(txUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        configJson: expect.objectContaining({
          recipientEmails: ["person@example.com"],
        }),
        updatedAt: expect.any(Date),
      }),
    );
  });
});
