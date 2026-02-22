import { afterEach, describe, expect, it, vi } from "vitest";

const { deleteMock, whereMock, returningMock } = vi.hoisted(() => {
  const returningMock = vi.fn();
  const whereMock = vi.fn(() => ({ returning: returningMock }));
  const deleteMock = vi.fn(() => ({ where: whereMock }));

  return {
    deleteMock,
    whereMock,
    returningMock,
  };
});

vi.mock("../src/db", () => ({
  db: {
    delete: deleteMock,
  },
}));

import {
  getContactSubmissionRetentionCleanupIntervalMs,
  getContactSubmissionRetentionDays,
  purgeExpiredContactSubmissions,
} from "../src/services/plugins/contactForm/retention";

describe("ContactSubmissionRetentionService", () => {
  afterEach(() => {
    delete process.env.VIVD_CONTACT_FORM_RETENTION_DAYS;
    delete process.env.VIVD_CONTACT_FORM_RETENTION_CLEANUP_INTERVAL_MS;
    deleteMock.mockClear();
    whereMock.mockClear();
    returningMock.mockReset();
  });

  it("uses 30-day retention and 6h cleanup interval by default", () => {
    expect(getContactSubmissionRetentionDays()).toBe(30);
    expect(getContactSubmissionRetentionCleanupIntervalMs()).toBe(
      6 * 60 * 60 * 1000,
    );
  });

  it("supports disabling retention cleanup with zero days", async () => {
    process.env.VIVD_CONTACT_FORM_RETENTION_DAYS = "0";

    const deletedCount = await purgeExpiredContactSubmissions(
      new Date("2026-02-22T00:00:00.000Z"),
    );

    expect(deletedCount).toBe(0);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes expired contact submissions and returns deleted count", async () => {
    process.env.VIVD_CONTACT_FORM_RETENTION_DAYS = "30";
    returningMock.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);

    const deletedCount = await purgeExpiredContactSubmissions(
      new Date("2026-02-22T00:00:00.000Z"),
    );

    expect(deleteMock).toHaveBeenCalledOnce();
    expect(whereMock).toHaveBeenCalledOnce();
    expect(returningMock).toHaveBeenCalledOnce();
    expect(deletedCount).toBe(2);
  });
});
