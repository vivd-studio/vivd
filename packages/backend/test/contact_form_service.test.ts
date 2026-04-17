import { describe, expect, it, vi } from "vitest";
import { createContactFormPluginService } from "@vivd/plugin-contact-form/backend/service";

function createServiceDeps(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-04-17T12:00:00.000Z");
  const ensurePluginInstance = vi.fn().mockResolvedValue({
    row: {
      id: "plugin-1",
      organizationId: "org-1",
      projectSlug: "site-1",
      status: "enabled",
      configJson: {
        recipientEmails: ["owner@example.com"],
        sourceHosts: ["old.example.com"],
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
      publicToken: "public-token",
      createdAt: now,
      updatedAt: now,
    },
    created: false,
  });
  const updatePluginInstance = vi.fn().mockResolvedValue({
    id: "plugin-1",
    organizationId: "org-1",
    projectSlug: "site-1",
    status: "enabled",
    configJson: {
      recipientEmails: ["owner@example.com"],
      sourceHosts: ["preview.example.com:3100", "live.example.com"],
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
    publicToken: "public-token",
    createdAt: now,
    updatedAt: now,
  });
  const getPluginInstance = vi.fn().mockResolvedValue({
    id: "plugin-1",
    organizationId: "org-1",
    projectSlug: "site-1",
    status: "enabled",
    configJson: {
      recipientEmails: ["owner@example.com"],
      sourceHosts: ["preview.example.com:3100", "live.example.com"],
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
    publicToken: "public-token",
    createdAt: now,
    updatedAt: now,
  });
  const syncProjectTurnstileWidget = vi.fn().mockResolvedValue(undefined);

  const deps = {
    projectPluginInstanceService: {
      ensurePluginInstance,
      getPluginInstance,
      updatePluginInstance,
    },
    pluginEntitlementService: {
      resolveEffectiveEntitlement: vi.fn().mockResolvedValue({
        state: "enabled",
        scope: "project",
        monthlyEventLimit: null,
        hardStop: true,
        turnstileEnabled: true,
        turnstileSiteKey: "sitekey-1",
        turnstileSecretKey: "secret-1",
      }),
    },
    recipientVerificationService: {
      listRecipientDirectory: vi.fn().mockResolvedValue({
        options: [],
        pending: [],
      }),
      listVerifiedExternalRecipientEmailSet: vi.fn().mockResolvedValue(new Set<string>()),
    },
    getContactFormSubmitEndpoint: vi
      .fn()
      .mockResolvedValue("https://api.example.test/plugins/contact/v1/submit"),
    inferSourceHosts: vi
      .fn()
      .mockResolvedValue(["published.example.com", "studio.example.com:3100"]),
    listVerifiedOrganizationMemberEmails: vi
      .fn()
      .mockResolvedValue(["owner@example.com"]),
    syncProjectTurnstileWidget,
    ...overrides,
  } as any;

  return {
    service: createContactFormPluginService(deps),
    mocks: {
      ensurePluginInstance,
      getPluginInstance,
      updatePluginInstance,
      syncProjectTurnstileWidget,
      resolveEffectiveEntitlement:
        deps.pluginEntitlementService.resolveEffectiveEntitlement,
    },
  };
}

describe("contact form plugin service", () => {
  it("resyncs the Turnstile widget when source hosts change", async () => {
    const { service, mocks } = createServiceDeps();

    await service.updateContactFormConfig({
      organizationId: "org-1",
      projectSlug: "site-1",
      config: {
        recipientEmails: ["owner@example.com"],
        sourceHosts: ["preview.example.com:3100", "live.example.com"],
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

    expect(mocks.syncProjectTurnstileWidget).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
    });
  });

  it("reports effective source hosts and expected Turnstile domains", async () => {
    const { service } = createServiceDeps({
      projectPluginInstanceService: {
        ensurePluginInstance: vi.fn(),
        updatePluginInstance: vi.fn(),
        getPluginInstance: vi.fn().mockResolvedValue({
          id: "plugin-1",
          organizationId: "org-1",
          projectSlug: "site-1",
          status: "enabled",
          configJson: {
            recipientEmails: ["owner@example.com"],
            sourceHosts: ["Preview.Example.com:3100", "custom.example.com"],
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
          publicToken: "public-token",
          createdAt: new Date("2026-04-17T12:00:00.000Z"),
          updatedAt: new Date("2026-04-17T12:00:00.000Z"),
        }),
      },
      inferSourceHosts: vi
        .fn()
        .mockResolvedValue(["published.example.com", "studio.example.com:3100"]),
    });

    const info = await service.getContactFormInfo({
      organizationId: "org-1",
      projectSlug: "site-1",
    });

    expect(info.usage.configuredSourceHosts).toEqual([
      "Preview.Example.com:3100",
      "custom.example.com",
    ]);
    expect(info.usage.effectiveSourceHosts).toEqual([
      "preview.example.com:3100",
      "custom.example.com",
    ]);
    expect(info.usage.turnstileExpectedDomains).toEqual([
      "preview.example.com",
      "custom.example.com",
    ]);
    expect(info.instructions).toContain(
      "Leave source hosts empty unless you explicitly need a manual allowlist. Setting values there overrides Vivd's auto-detected published, tenant, and Studio preview hosts.",
    );
  });
});
