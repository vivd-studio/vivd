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

  it("swallows session-title update errors to avoid breaking callers", async () => {
    whereMock.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(
      usageService.updateSessionTitle(
        "org-1",
        "session-1",
        "Landing page copy",
        "project-a",
      ),
    ).resolves.toBeUndefined();
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

  it("stores OpenRouter events with flow type and generation idempotency key", async () => {
    txReturningMock.mockResolvedValueOnce([]);

    await usageService.recordOpenRouterCost(
      "org-1",
      0.42,
      "gen-123",
      "flow_scrape",
      "project-a",
    );

    expect(txValuesMock).toHaveBeenCalledTimes(1);
    expect(txValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        eventType: "flow_scrape",
        cost: "0.42",
        projectSlug: "project-a",
        idempotencyKey: "openrouter:gen-123",
      }),
    );
  });

  it("records image generation events with timestamped idempotency key", async () => {
    txReturningMock.mockResolvedValueOnce([]);

    await usageService.recordImageGeneration("org-1", "project-a");

    expect(txValuesMock).toHaveBeenCalledTimes(1);
    const payload = txValuesMock.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      organizationId: "org-1",
      eventType: "image_gen",
      cost: "0",
      projectSlug: "project-a",
    });
    expect(String(payload?.idempotencyKey)).toMatch(/^image_gen:project-a:\d+$/);
  });

  it("uses explicit idempotency keys for image generation events", async () => {
    txReturningMock.mockResolvedValueOnce([]);

    await usageService.recordImageGeneration(
      "org-1",
      "project-a",
      "studio_image_gen:gen-123",
    );

    expect(txValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        eventType: "image_gen",
        idempotencyKey: "studio_image_gen:gen-123",
      }),
    );
  });
});
