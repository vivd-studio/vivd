import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  updateMock,
  setMock,
  whereMock,
  transactionMock,
  txInsertMock,
  txValuesMock,
  txOnConflictDoNothingMock,
  txReturningMock,
} = vi.hoisted(() => {
  const whereMock = vi.fn();
  const setMock = vi.fn(() => ({ where: whereMock }));
  const updateMock = vi.fn(() => ({ set: setMock }));

  const txReturningMock = vi.fn();
  const txOnConflictDoNothingMock = vi.fn(() => ({ returning: txReturningMock }));
  const txValuesMock = vi.fn(() => ({
    onConflictDoNothing: txOnConflictDoNothingMock,
  }));
  const txInsertMock = vi.fn(() => ({ values: txValuesMock }));

  const transactionMock = vi.fn(async (work: (tx: any) => Promise<unknown>) =>
    work({
      insert: txInsertMock,
    }),
  );

  return {
    updateMock,
    setMock,
    whereMock,
    transactionMock,
    txInsertMock,
    txValuesMock,
    txOnConflictDoNothingMock,
    txReturningMock,
  };
});

vi.mock("../src/db", () => ({
  db: {
    update: updateMock,
    transaction: transactionMock,
  },
}));

import { usageService } from "../src/services/usage/UsageService";

describe("UsageService", () => {
  beforeEach(() => {
    updateMock.mockClear();
    setMock.mockClear();
    whereMock.mockReset();
    whereMock.mockResolvedValue(undefined);

    transactionMock.mockClear();
    txInsertMock.mockClear();
    txValuesMock.mockClear();
    txOnConflictDoNothingMock.mockClear();
    txReturningMock.mockReset();
    txReturningMock.mockResolvedValue([]);
  });

  it("does not update session titles for placeholder names", async () => {
    await usageService.updateSessionTitle(
      "org-1",
      "session-1",
      "New Session",
      "project-a",
    );

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates session titles when a real title is provided", async () => {
    await usageService.updateSessionTitle(
      "org-1",
      "session-1",
      "  Landing page copy  ",
      "project-a",
    );

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({
      sessionTitle: "Landing page copy",
      projectSlug: "project-a",
    });
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it("skips aggregate writes on duplicate AI cost idempotency keys", async () => {
    txReturningMock.mockResolvedValueOnce([]);

    await usageService.recordAiCost(
      "org-1",
      0.25,
      undefined,
      "session-1",
      "Session title",
      "project-a",
      "part-1",
    );

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(txInsertMock).toHaveBeenCalledTimes(1);
  });
});
