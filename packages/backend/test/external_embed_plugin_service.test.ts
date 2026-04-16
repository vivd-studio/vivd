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

const { resolveEffectiveEntitlementMock } = vi.hoisted(() => ({
  resolveEffectiveEntitlementMock: vi.fn(),
}));

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

vi.mock("../src/services/plugins/PluginEntitlementService", () => ({
  pluginEntitlementService: {
    resolveEffectiveEntitlement: resolveEffectiveEntitlementMock,
  },
}));

import { googleMapsPluginManifest } from "@vivd/plugin-google-maps/manifest";
import { externalEmbedPluginService } from "../src/services/plugins/externalEmbed/service";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ppi-google-maps-1",
    organizationId: "org-1",
    projectSlug: "site-1",
    pluginId: "google_maps",
    status: "enabled",
    configJson: {},
    publicToken: "ppi-google-maps-1.public-token",
    createdAt: new Date("2026-04-17T10:00:00.000Z"),
    updatedAt: new Date("2026-04-17T10:00:00.000Z"),
    ...overrides,
  };
}

describe("externalEmbedPluginService", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    insertMock.mockClear();
    insertValuesMock.mockClear();
    insertReturningMock.mockReset();
    updateMock.mockClear();
    updateSetMock.mockClear();
    updateWhereMock.mockClear();
    updateReturningMock.mockReset();
    resolveEffectiveEntitlementMock.mockReset();

    resolveEffectiveEntitlementMock.mockResolvedValue({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "google_maps",
      scope: "project",
      state: "enabled",
      managedBy: "manual_superadmin",
      monthlyEventLimit: null,
      hardStop: false,
      turnstileEnabled: false,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
      notes: "",
      changedByUserId: null,
      updatedAt: new Date("2026-04-17T10:00:00.000Z"),
    });
  });

  it("returns manifest-driven instructions without snippets until the config is valid", async () => {
    findFirstMock.mockResolvedValueOnce(makeRow({ configJson: {} }));

    const result = await externalEmbedPluginService.getInfoPayload({
      organizationId: "org-1",
      projectSlug: "site-1",
      manifest: googleMapsPluginManifest,
    });

    expect(result.enabled).toBe(true);
    expect(result.snippets).toBeNull();
    expect(result.usage).toMatchObject({
      provider: "Google Maps",
      renderReady: false,
    });
    expect(result.instructions.join("\n")).toContain(
      "Complete the config JSON with a valid provider embed URL",
    );
  });

  it("persists valid config and returns rendered snippets", async () => {
    findFirstMock.mockResolvedValueOnce(makeRow({ configJson: {} }));
    updateReturningMock.mockResolvedValueOnce([
      makeRow({
        configJson: {
          embedUrl:
            "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3153.019756290745!2d-122.4194!3d37.7749",
          title: "Office map",
          height: 480,
          loading: "lazy",
          referrerPolicy: "no-referrer-when-downgrade",
        },
      }),
    ]);

    const result = await externalEmbedPluginService.updateConfig({
      organizationId: "org-1",
      projectSlug: "site-1",
      manifest: googleMapsPluginManifest,
      config: {
        embedUrl:
          "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3153.019756290745!2d-122.4194!3d37.7749",
        title: "Office map",
        height: 480,
        loading: "lazy",
        referrerPolicy: "no-referrer-when-downgrade",
      },
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(result.snippets?.html).toContain("<iframe");
    expect(result.snippets?.html).toContain("Office map");
    expect(result.snippets?.html).toContain("https://www.google.com/maps/embed?");
    expect(result.usage).toMatchObject({
      renderReady: true,
    });
  });

  it("rejects invalid provider URLs", async () => {
    findFirstMock.mockResolvedValueOnce(makeRow({ configJson: {} }));

    await expect(
      externalEmbedPluginService.updateConfig({
        organizationId: "org-1",
        projectSlug: "site-1",
        manifest: googleMapsPluginManifest,
        config: {
          embedUrl: "https://example.com/not-google-maps",
          title: "Office map",
          height: 480,
          loading: "lazy",
          referrerPolicy: "no-referrer-when-downgrade",
        },
      }),
    ).rejects.toMatchObject({
      name: "ZodError",
    });

    expect(updateMock).not.toHaveBeenCalled();
  });
});
