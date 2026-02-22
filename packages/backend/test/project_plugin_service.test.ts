import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findFirstMock,
  insertMock,
  insertValuesMock,
  insertReturningMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
} = vi.hoisted(() => {
  const findFirstMock = vi.fn();

  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn();
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    findFirstMock,
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
    insertMock.mockClear();
    insertValuesMock.mockClear();
    insertReturningMock.mockReset();
    updateMock.mockClear();
    updateSetMock.mockClear();
    updateWhereMock.mockClear();
    updateReturningMock.mockReset();
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
});
