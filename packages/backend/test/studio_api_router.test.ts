import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  recordAiCostMock,
  recordImageGenerationMock,
  updateSessionTitleMock,
  checkLimitsMock,
  touchProjectUpdatedAtMock,
  getVersionDirMock,
  generateThumbnailMock,
  upsertPublishChecklistMock,
  getPublishChecklistMock,
  workspaceReportMock,
  getProjectMock,
  getProjectVersionMock,
  listCatalogForProjectMock,
  getPluginInfoContractMock,
  readPluginDataMock,
  updatePluginConfigByIdMock,
  runPluginActionMock,
  renderAgentInstructionsMock,
  reportAgentLeaseActiveMock,
  reportAgentLeaseIdleMock,
  touchStudioMachineMock,
  getPreviewStatusMock,
  capturePreviewLogsMock,
  capturePreviewScreenshotMock,
} = vi.hoisted(() => ({
  recordAiCostMock: vi.fn(),
  recordImageGenerationMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
  checkLimitsMock: vi.fn(),
  touchProjectUpdatedAtMock: vi.fn(),
  getVersionDirMock: vi.fn(),
  generateThumbnailMock: vi.fn(),
  upsertPublishChecklistMock: vi.fn(),
  getPublishChecklistMock: vi.fn(),
  workspaceReportMock: vi.fn(),
  getProjectMock: vi.fn(),
  getProjectVersionMock: vi.fn(),
  listCatalogForProjectMock: vi.fn(),
  getPluginInfoContractMock: vi.fn(),
  readPluginDataMock: vi.fn(),
  updatePluginConfigByIdMock: vi.fn(),
  runPluginActionMock: vi.fn(),
  renderAgentInstructionsMock: vi.fn(),
  reportAgentLeaseActiveMock: vi.fn(),
  reportAgentLeaseIdleMock: vi.fn(),
  touchStudioMachineMock: vi.fn(),
  getPreviewStatusMock: vi.fn(),
  capturePreviewLogsMock: vi.fn(),
  capturePreviewScreenshotMock: vi.fn(),
}));

vi.mock("../src/services/usage/UsageService", () => ({
  usageService: {
    recordAiCost: recordAiCostMock,
    recordImageGeneration: recordImageGenerationMock,
    updateSessionTitle: updateSessionTitleMock,
  },
}));

vi.mock("../src/services/usage/LimitsService", () => ({
  limitsService: {
    checkLimits: checkLimitsMock,
  },
}));

vi.mock("../src/generator/versionUtils", () => ({
  touchProjectUpdatedAt: touchProjectUpdatedAtMock,
  getVersionDir: getVersionDirMock,
}));

vi.mock("../src/services/project/ThumbnailService", () => ({
  thumbnailService: {
    generateThumbnail: generateThumbnailMock,
  },
}));

vi.mock("../src/services/project/PreviewScreenshotService", () => ({
  previewScreenshotService: {
    capture: capturePreviewScreenshotMock,
  },
}));

vi.mock("../src/services/project/PreviewStatusService", () => ({
  previewStatusService: {
    getStatus: getPreviewStatusMock,
  },
}));

vi.mock("../src/services/project/PreviewLogsService", () => ({
  previewLogsService: {
    capture: capturePreviewLogsMock,
  },
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    upsertPublishChecklist: upsertPublishChecklistMock,
    getPublishChecklist: getPublishChecklistMock,
    getProject: getProjectMock,
    getProjectVersion: getProjectVersionMock,
  },
}));

vi.mock("../src/services/project/StudioWorkspaceStateService", () => ({
  studioWorkspaceStateService: {
    report: workspaceReportMock,
  },
}));

vi.mock("../src/services/plugins/ProjectPluginService", () => ({
  projectPluginService: {
    listCatalogForProject: listCatalogForProjectMock,
    getPluginInfoContract: getPluginInfoContractMock,
    readPluginData: readPluginDataMock,
    updatePluginConfigById: updatePluginConfigByIdMock,
    runPluginAction: runPluginActionMock,
  },
}));

vi.mock("../src/services/agent/AgentInstructionsService", () => ({
  agentInstructionsService: {
    render: renderAgentInstructionsMock,
  },
}));

vi.mock("../src/services/project/StudioAgentLeaseService", () => ({
  studioAgentLeaseService: {
    reportActive: reportAgentLeaseActiveMock,
    reportIdle: reportAgentLeaseIdleMock,
  },
}));

vi.mock("../src/services/studioMachines", () => ({
  studioMachineProvider: {
    touch: touchStudioMachineMock,
  },
}));

import { studioApiRouter } from "../src/trpcRouters/studioApi";

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    req: {} as any,
    res: {} as any,
    session: {
      session: {
        id: "sess-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: "user-1",
        email: "admin@example.com",
        name: "Admin",
        role: "super_admin",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    requestHost: "app.vivd.local",
    requestDomain: "app.vivd.local",
    isSuperAdminHost: true,
    hostKind: "control_plane_host",
    hostOrganizationId: null,
    hostOrganizationSlug: null,
    canSelectOrganization: true,
    organizationId: "org-1",
    organizationRole: "owner",
    studioRuntimeAuth: null,
    ...overrides,
  };
}

describe("studioApi router", () => {
  beforeEach(() => {
    recordAiCostMock.mockReset();
    recordImageGenerationMock.mockReset();
    updateSessionTitleMock.mockReset();
    checkLimitsMock.mockReset();
    touchProjectUpdatedAtMock.mockReset();
    getVersionDirMock.mockReset();
    generateThumbnailMock.mockReset();
    upsertPublishChecklistMock.mockReset();
    getPublishChecklistMock.mockReset();
    workspaceReportMock.mockReset();
    getProjectMock.mockReset();
    getProjectVersionMock.mockReset();
    listCatalogForProjectMock.mockReset();
    getPluginInfoContractMock.mockReset();
    readPluginDataMock.mockReset();
    updatePluginConfigByIdMock.mockReset();
    runPluginActionMock.mockReset();
    renderAgentInstructionsMock.mockReset();
    reportAgentLeaseActiveMock.mockReset();
    reportAgentLeaseIdleMock.mockReset();
    touchStudioMachineMock.mockReset();
    getPreviewStatusMock.mockReset();
    capturePreviewLogsMock.mockReset();
    capturePreviewScreenshotMock.mockReset();

    recordAiCostMock.mockResolvedValue(undefined);
    recordImageGenerationMock.mockResolvedValue(undefined);
    updateSessionTitleMock.mockResolvedValue(undefined);
    checkLimitsMock.mockResolvedValue({ blocked: false });
    touchProjectUpdatedAtMock.mockResolvedValue(undefined);
    getVersionDirMock.mockReturnValue("/tmp/org-1/site-1/v1");
    generateThumbnailMock.mockResolvedValue(undefined);
    getPreviewStatusMock.mockResolvedValue({
      provider: "fly",
      runtime: {
        running: true,
        health: "ok",
        browserUrl: "https://preview.example.test",
        runtimeUrl: "https://runtime.example.test",
        compatibilityUrl: "https://app.example/_studio/runtime-1",
      },
      preview: {
        mode: "devserver",
        status: "ready",
      },
      devServer: {
        applicable: true,
        running: true,
        status: "ready",
      },
    });
    capturePreviewLogsMock.mockResolvedValue({
      path: "/",
      capturedUrl: "https://preview.example.test/",
      waitMs: 1500,
      limit: 50,
      level: "debug",
      entries: [],
      summary: {
        observed: 0,
        matched: 0,
        returned: 0,
        dropped: 0,
        truncatedMessages: 0,
      },
    });
    capturePreviewScreenshotMock.mockResolvedValue({
      path: "/",
      capturedUrl: "https://preview.example.test/",
      filename: "preview-home-1440x900.png",
      mimeType: "image/png",
      format: "png",
      width: 1440,
      height: 900,
      scrollX: 0,
      scrollY: 0,
      imageBase64: "base64-image",
    });
    upsertPublishChecklistMock.mockResolvedValue(undefined);
    getPublishChecklistMock.mockResolvedValue(null);
    getProjectMock.mockResolvedValue({
      organizationId: "org-1",
      slug: "site-1",
      source: "url",
      title: "Site 1",
      currentVersion: 3,
    });
    getProjectVersionMock.mockResolvedValue({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 3,
      source: "url",
      title: "Site 1 v3",
    });
    listCatalogForProjectMock.mockResolvedValue({
      project: { organizationId: "org-1", slug: "site-1" },
      available: [],
      instances: [
        { pluginId: "contact_form", status: "enabled" },
        { pluginId: "analytics", status: "disabled" },
      ],
    });
    getPluginInfoContractMock.mockImplementation(async ({ pluginId }) => {
      if (pluginId === "analytics") {
        return {
          pluginId: "analytics",
          catalog: {
            pluginId: "analytics",
            name: "Analytics",
            description: "Track page traffic and visitor behavior for your project.",
            capabilities: {
              supportsInfo: true,
              config: {
                supportsShow: true,
                supportsApply: true,
                supportsTemplate: true,
              },
              actions: [],
            },
          },
          entitled: true,
          entitlementState: "enabled",
          enabled: false,
          instanceId: null,
          status: null,
          publicToken: null,
          config: null,
          defaultConfig: {
            respectDoNotTrack: true,
            captureQueryString: false,
          },
          snippets: null,
          usage: {
            scriptEndpoint: "https://api.example.test/plugins/analytics/script.js",
            trackEndpoint: "https://api.example.test/plugins/analytics/track",
            eventTypes: ["pageview", "custom"],
            respectDoNotTrack: true,
            captureQueryString: false,
            enableClientTracking: true,
          },
          details: null,
          instructions: ["Keep the snippet in the page head."],
        };
      }

      return {
        pluginId: "contact_form",
        catalog: {
          pluginId: "contact_form",
          name: "Contact Form",
          description: "Collect visitor inquiries and store submissions in Vivd.",
          capabilities: {
            supportsInfo: true,
            config: {
              supportsShow: true,
              supportsApply: true,
              supportsTemplate: true,
            },
            actions: [
              {
                actionId: "verify_recipient",
                title: "Verify recipient",
                arguments: [{ name: "email", type: "email", required: true }],
              },
            ],
          },
        },
        entitled: true,
        entitlementState: "enabled",
        enabled: true,
        instanceId: "plugin-1",
        status: "enabled",
        publicToken: "public-token",
        config: {
          recipientEmails: ["owner@example.com"],
          sourceHosts: [],
          redirectHostAllowlist: [],
          formFields: [],
        },
        defaultConfig: {
          recipientEmails: ["team@example.com"],
        },
        snippets: {
          html: "<form></form>",
        },
        usage: {
          submitEndpoint: "https://api.example.test/plugins/contact",
          expectedFields: ["token", "name"],
          optionalFields: ["_redirect"],
          inferredAutoSourceHosts: [],
          turnstileEnabled: false,
          turnstileConfigured: false,
        },
        details: {
          recipients: {
            options: [],
            pending: [],
          },
        },
        instructions: ["Insert the snippet"],
      };
    });
    updatePluginConfigByIdMock.mockResolvedValue({
      pluginId: "analytics",
      catalog: {
        pluginId: "analytics",
        name: "Analytics",
        description: "Track page traffic and visitor behavior for your project.",
        capabilities: {
          supportsInfo: true,
          config: {
            supportsShow: true,
            supportsApply: true,
            supportsTemplate: true,
          },
          actions: [],
        },
      },
      entitled: true,
      entitlementState: "enabled",
      enabled: true,
      instanceId: "plugin-analytics-1",
      status: "enabled",
      publicToken: "analytics-token",
      config: {
        respectDoNotTrack: true,
      },
      defaultConfig: {
        respectDoNotTrack: true,
        captureQueryString: false,
      },
      snippets: null,
      usage: {
        scriptEndpoint: "https://api.example.test/plugins/analytics/script.js",
      },
      details: null,
      instructions: ["Keep the snippet in the page head."],
    });
    runPluginActionMock.mockResolvedValue({
      pluginId: "contact_form",
      actionId: "verify_recipient",
      summary: "Requested recipient verification.",
      result: {
        email: "owner@example.com",
        status: "verification_sent",
        cooldownRemainingSeconds: 0,
      },
    });
    readPluginDataMock.mockResolvedValue({
      pluginId: "analytics",
      readId: "summary",
      result: {
        enabled: true,
      },
    });
    renderAgentInstructionsMock.mockResolvedValue({
      instructions: "Use this prompt",
      instructionsHash: "hash-1",
      templateSource: "default",
    });
    reportAgentLeaseActiveMock.mockReturnValue({
      leaseState: "active",
      ageMs: 1_000,
      activeRuns: 1,
    });
    reportAgentLeaseIdleMock.mockReturnValue({ removed: true });
    touchStudioMachineMock.mockResolvedValue(undefined);
  });

  it("records each usage report with session/project linkage", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    const runAt = new Date().toISOString();

    const result = await caller.reportUsage({
      studioId: "studio-1",
      reports: [
        {
          sessionId: "session-1",
          sessionTitle: "Landing page edits",
          cost: 1.25,
          tokens: {
            input: 10,
            output: 20,
            reasoning: 3,
            cache: { read: 4, write: 5 },
          },
          partId: "part-1",
          projectPath: "site-1",
          timestamp: runAt,
        },
        {
          sessionId: "session-2",
          cost: 0.5,
          timestamp: runAt,
        },
      ],
    });

    expect(recordAiCostMock).toHaveBeenNthCalledWith(
      1,
      "org-1",
      1.25,
      {
        input: 10,
        output: 20,
        reasoning: 3,
        cache: { read: 4, write: 5 },
      },
      "session-1",
      "Landing page edits",
      "site-1",
      "part-1",
    );
    expect(recordAiCostMock).toHaveBeenNthCalledWith(
      2,
      "org-1",
      0.5,
      undefined,
      "session-2",
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual({ success: true, recorded: 2 });
  });

  it("updates session title with optional project scope", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    await caller.updateSessionTitle({
      studioId: "studio-1",
      sessionId: "session-1",
      sessionTitle: "New title",
      projectSlug: "site-1",
    });

    expect(updateSessionTitleMock).toHaveBeenCalledWith(
      "org-1",
      "session-1",
      "New title",
      "site-1",
    );
  });

  it("records image generation usage reports with project scope and idempotency key", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    const runAt = new Date().toISOString();

    const result = await caller.reportImageGeneration({
      studioId: "studio-1",
      report: {
        projectPath: "site-1",
        idempotencyKey: "studio_image_gen:gen-123",
        timestamp: runAt,
      },
    });

    expect(recordImageGenerationMock).toHaveBeenCalledWith(
      "org-1",
      "site-1",
      "studio_image_gen:gen-123",
    );
    expect(result).toEqual({ success: true });
  });

  it("returns current limit status for the active organization", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.getStatus({ studioId: "studio-1" });

    expect(checkLimitsMock).toHaveBeenCalledWith("org-1");
    expect(result).toEqual({ blocked: false });
  });

  it("allows getStatus with studio runtime auth when session is absent", async () => {
    const caller = studioApiRouter.createCaller(
      makeContext({
        session: null,
        organizationRole: null,
        studioRuntimeAuth: {
          studioId: "studio-1",
          organizationId: "org-1",
          projectSlug: "site-1",
          version: 3,
        },
      }),
    );

    const result = await caller.getStatus({ studioId: "studio-1" });

    expect(checkLimitsMock).toHaveBeenCalledWith("org-1");
    expect(result).toEqual({ blocked: false });
  });

  it("records usage for the runtime-auth organization on non-default tenant machines", async () => {
    const caller = studioApiRouter.createCaller(
      makeContext({
        session: null,
        organizationId: "org-tenant",
        organizationRole: null,
        hostKind: "control_plane_host",
        requestHost: "vivd.studio",
        requestDomain: "vivd.studio",
        studioRuntimeAuth: {
          studioId: "studio-tenant",
          organizationId: "org-tenant",
          projectSlug: "site-1",
          version: 3,
        },
      }),
    );
    const runAt = new Date().toISOString();

    const result = await caller.reportUsage({
      studioId: "studio-tenant",
      reports: [
        {
          sessionId: "session-tenant",
          sessionTitle: "Tenant edits",
          cost: 2.5,
          timestamp: runAt,
        },
      ],
    });

    expect(recordAiCostMock).toHaveBeenCalledWith(
      "org-tenant",
      2.5,
      undefined,
      "session-tenant",
      "Tenant edits",
      undefined,
      undefined,
    );
    expect(result).toEqual({ success: true, recorded: 1 });
  });

  it("returns rendered agent instructions for the requested project", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.getAgentInstructions({
      studioId: "studio-1",
      slug: "site-1",
    });

    expect(getProjectMock).toHaveBeenCalledWith("org-1", "site-1");
    expect(getProjectVersionMock).toHaveBeenCalledWith("org-1", "site-1", 3);
    expect(listCatalogForProjectMock).toHaveBeenCalledWith("org-1", "site-1");
    expect(renderAgentInstructionsMock).toHaveBeenCalledWith({
      projectName: "Site 1 v3",
      source: "url",
      enabledPlugins: ["contact_form"],
    });
    expect(result).toEqual(
      expect.objectContaining({
        slug: "site-1",
        version: 3,
        source: "url",
        projectName: "Site 1 v3",
        enabledPluginIds: ["contact_form"],
        instructions: "Use this prompt",
        instructionsHash: "hash-1",
        templateSource: "default",
      }),
    );
  });

  it("returns plugin catalog and plugin info through machine-scoped studio auth", async () => {
    const caller = studioApiRouter.createCaller(
      makeContext({
        session: null,
        organizationRole: null,
        studioRuntimeAuth: {
          studioId: "studio-1",
          organizationId: "org-1",
          projectSlug: "site-1",
          version: 3,
        },
      }),
    );

    await expect(
      caller.getProjectPluginsCatalog({
        studioId: "studio-1",
        slug: "site-1",
        version: 3,
      }),
    ).resolves.toEqual({
      project: { organizationId: "org-1", slug: "site-1" },
      available: [],
      instances: [
        { pluginId: "contact_form", status: "enabled" },
        { pluginId: "analytics", status: "disabled" },
      ],
    });

    await expect(
      caller.getProjectPluginInfo({
        studioId: "studio-1",
        slug: "site-1",
        pluginId: "contact_form",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        pluginId: "contact_form",
        enabled: true,
      }),
    );

    expect(listCatalogForProjectMock).toHaveBeenCalledWith("org-1", "site-1");
    expect(getPluginInfoContractMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
    });
  });

  it("returns project info with enabled plugin ids", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.getProjectInfo({
      studioId: "studio-1",
      slug: "site-1",
      version: 3,
    });

    expect(getProjectMock).toHaveBeenCalledWith("org-1", "site-1");
    expect(getProjectVersionMock).toHaveBeenCalledWith("org-1", "site-1", 3);
    expect(result).toEqual({
      project: {
        slug: "site-1",
        title: "Site 1 v3",
        source: "url",
        currentVersion: 3,
        requestedVersion: 3,
      },
      enabledPluginIds: ["contact_form"],
    });
  });

  it("updates plugin config for the project through the generic procedure", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    updatePluginConfigByIdMock.mockResolvedValueOnce({
      pluginId: "contact_form",
      catalog: {
        pluginId: "contact_form",
        name: "Contact Form",
        description: "Collect visitor inquiries and store submissions in Vivd.",
        capabilities: {
          supportsInfo: true,
          config: {
            supportsShow: true,
            supportsApply: true,
            supportsTemplate: true,
          },
          actions: [],
        },
      },
      entitled: true,
      entitlementState: "enabled",
      enabled: true,
      instanceId: "plugin-contact-1",
      status: "enabled",
      publicToken: "contact-token",
      config: {
        recipientEmails: ["owner@example.com"],
        sourceHosts: ["example.com"],
        redirectHostAllowlist: ["example.com"],
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
      defaultConfig: {
        recipientEmails: ["team@example.com"],
      },
      snippets: {
        html: "<form></form>",
      },
      usage: {
        submitEndpoint: "https://api.example.test/plugins/contact",
      },
      details: {
        recipients: {
          options: [],
          pending: [],
        },
      },
      instructions: ["Insert the snippet"],
    });

    const result = await caller.updateProjectPluginConfig({
      studioId: "studio-1",
      slug: "site-1",
      pluginId: "contact_form",
      config: {
        recipientEmails: ["owner@example.com"],
        sourceHosts: ["example.com"],
        redirectHostAllowlist: ["example.com"],
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

    expect(updatePluginConfigByIdMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
      config: {
        recipientEmails: ["owner@example.com"],
        sourceHosts: ["example.com"],
        redirectHostAllowlist: ["example.com"],
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
    expect(result).toEqual(
      expect.objectContaining({
        pluginId: "contact_form",
        config: {
          recipientEmails: ["owner@example.com"],
          sourceHosts: ["example.com"],
          redirectHostAllowlist: ["example.com"],
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
    );
  });

  it("updates generic plugin config for the project", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.updateProjectPluginConfig({
      studioId: "studio-1",
      slug: "site-1",
      pluginId: "analytics",
      config: {
        respectDoNotTrack: true,
      },
    });

    expect(updatePluginConfigByIdMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
      config: {
        respectDoNotTrack: true,
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        pluginId: "analytics",
        config: {
          respectDoNotTrack: true,
        },
      }),
    );
  });

  it("reads generic plugin data for the project", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    readPluginDataMock.mockResolvedValueOnce({
      pluginId: "analytics",
      readId: "summary",
      result: {
        enabled: true,
        scriptEndpoint: "https://api.example.test/plugins/analytics/script.js",
      },
    });

    const result = await caller.getProjectPluginRead({
      studioId: "studio-1",
      slug: "site-1",
      pluginId: "analytics",
      readId: "summary",
      input: {
        days: 30,
      },
    });

    expect(readPluginDataMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
      readId: "summary",
      input: {
        days: 30,
      },
    });
    expect(result).toEqual({
      pluginId: "analytics",
      readId: "summary",
      result: {
        enabled: true,
        scriptEndpoint: "https://api.example.test/plugins/analytics/script.js",
      },
    });
  });

  it("runs recipient verification through the generic plugin action procedure", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.runProjectPluginAction({
      studioId: "studio-1",
      slug: "site-1",
      pluginId: "contact_form",
      actionId: "verify_recipient",
      args: ["owner@example.com"],
    });

    expect(runPluginActionMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
      actionId: "verify_recipient",
      args: ["owner@example.com"],
      requestedByUserId: "user-1",
      requestHost: "app.vivd.local",
    });
    expect(result).toEqual({
      pluginId: "contact_form",
      actionId: "verify_recipient",
      summary: "Requested recipient verification.",
      result: {
        email: "owner@example.com",
        status: "verification_sent",
        cooldownRemainingSeconds: 0,
      },
    });
  });

  it("keeps generateThumbnail resilient when async side-effects fail", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    touchProjectUpdatedAtMock.mockRejectedValueOnce(new Error("touch failed"));
    getVersionDirMock.mockReturnValueOnce("/tmp/org-1/site-1/v2");
    generateThumbnailMock.mockRejectedValueOnce(new Error("thumbnail failed"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        caller.generateThumbnail({
          studioId: "studio-1",
          slug: "site-1",
          version: 2,
        }),
      ).resolves.toEqual({ success: true });

      expect(touchProjectUpdatedAtMock).toHaveBeenCalledWith("org-1", "site-1");
      expect(getVersionDirMock).toHaveBeenCalledWith("org-1", "site-1", 2);
      expect(generateThumbnailMock).toHaveBeenCalledWith(
        "/tmp/org-1/site-1/v2",
        "org-1",
        "site-1",
        2,
      );

      await new Promise((resolve) => setImmediate(resolve));
      const warningMessages = warnSpy.mock.calls.map((call) => String(call[0] ?? ""));
      expect(
        warningMessages.some((line) => line.includes("touchProjectUpdatedAt failed")),
      ).toBe(true);
      expect(
        warningMessages.some((line) =>
          line.includes("Thumbnail generation failed for site-1/v2"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("captures live preview screenshots through the preview screenshot service", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.capturePreviewScreenshot({
      studioId: "studio-1",
      slug: "site-1",
      version: 2,
      path: "/pricing?view=full",
      width: 1600,
      height: 1000,
      scrollY: 1400,
      waitMs: 900,
      format: "webp",
    });

    expect(capturePreviewScreenshotMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 2,
      path: "/pricing?view=full",
      width: 1600,
      height: 1000,
      scrollX: undefined,
      scrollY: 1400,
      waitMs: 900,
      format: "webp",
    });
    expect(result).toEqual({
      path: "/",
      capturedUrl: "https://preview.example.test/",
      filename: "preview-home-1440x900.png",
      mimeType: "image/png",
      format: "png",
      width: 1440,
      height: 900,
      scrollX: 0,
      scrollY: 0,
      imageBase64: "base64-image",
    });
  });

  it("captures live preview logs through the preview logs service", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.capturePreviewLogs({
      studioId: "studio-1",
      slug: "site-1",
      version: 2,
      path: "/pricing?view=full",
      waitMs: 1200,
      limit: 10,
      level: "warn",
      contains: "hydrate",
    });

    expect(capturePreviewLogsMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 2,
      path: "/pricing?view=full",
      waitMs: 1200,
      limit: 10,
      level: "warn",
      contains: "hydrate",
    });
    expect(result).toEqual({
      path: "/",
      capturedUrl: "https://preview.example.test/",
      waitMs: 1500,
      limit: 50,
      level: "debug",
      entries: [],
      summary: {
        observed: 0,
        matched: 0,
        returned: 0,
        dropped: 0,
        truncatedMessages: 0,
      },
    });
  });

  it("returns preview/runtime status through the preview status service", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.getPreviewStatus({
      studioId: "studio-1",
      slug: "site-1",
      version: 2,
    });

    expect(getPreviewStatusMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 2,
    });
    expect(result).toEqual({
      provider: "fly",
      runtime: {
        running: true,
        health: "ok",
        browserUrl: "https://preview.example.test",
        runtimeUrl: "https://runtime.example.test",
        compatibilityUrl: "https://app.example/_studio/runtime-1",
      },
      preview: {
        mode: "devserver",
        status: "ready",
      },
      devServer: {
        applicable: true,
        running: true,
        status: "ready",
      },
    });
  });

  it("normalizes missing workspace hashes to null", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    await caller.reportWorkspaceState({
      studioId: "studio-1",
      slug: "site-1",
      version: 3,
      hasUnsavedChanges: true,
    });

    expect(workspaceReportMock).toHaveBeenCalledWith({
      studioId: "studio-1",
      organizationId: "org-1",
      slug: "site-1",
      version: 3,
      hasUnsavedChanges: true,
      headCommitHash: null,
      workingCommitHash: null,
    });
  });

  it("allows workspace state reporting with studio runtime auth", async () => {
    const caller = studioApiRouter.createCaller(
      makeContext({
        session: null,
        organizationRole: null,
        studioRuntimeAuth: {
          studioId: "studio-1",
          organizationId: "org-1",
          projectSlug: "site-1",
          version: 3,
        },
      }),
    );

    await caller.reportWorkspaceState({
      studioId: "studio-1",
      slug: "site-1",
      version: 3,
      hasUnsavedChanges: false,
    });

    expect(workspaceReportMock).toHaveBeenCalledWith({
      studioId: "studio-1",
      organizationId: "org-1",
      slug: "site-1",
      version: 3,
      hasUnsavedChanges: false,
      headCommitHash: null,
      workingCommitHash: null,
    });
  });

  it("rejects workspace state reports for a mismatched studio runtime version", async () => {
    const caller = studioApiRouter.createCaller(
      makeContext({
        session: null,
        organizationRole: null,
        studioRuntimeAuth: {
          studioId: "studio-1",
          organizationId: "org-1",
          projectSlug: "site-1",
          version: 3,
        },
      }),
    );

    await expect(
      caller.reportWorkspaceState({
        studioId: "studio-1",
        slug: "site-1",
        version: 4,
        hasUnsavedChanges: false,
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("touches the studio machine when an active agent lease is accepted", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.reportAgentTaskLease({
      studioId: "studio-1",
      slug: "site-1",
      version: 3,
      sessionId: "sess-1",
      runId: "run-1",
      state: "active",
    });

    expect(reportAgentLeaseActiveMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "site-1",
      version: 3,
      studioId: "studio-1",
      sessionId: "sess-1",
      runId: "run-1",
    });
    expect(touchStudioMachineMock).toHaveBeenCalledWith("org-1", "site-1", 3);
    expect(result).toEqual({
      success: true,
      keepalive: true,
      leaseState: "active",
    });
  });

  it("does not touch machine when an agent lease exceeded max age", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    reportAgentLeaseActiveMock.mockReturnValueOnce({
      leaseState: "max_exceeded",
      ageMs: 9_999,
      activeRuns: 0,
    });

    const result = await caller.reportAgentTaskLease({
      studioId: "studio-1",
      slug: "site-1",
      version: 3,
      sessionId: "sess-1",
      runId: "run-1",
      state: "active",
    });

    expect(touchStudioMachineMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      keepalive: false,
      leaseState: "max_exceeded",
    });
  });

  it("clears lease run on idle reports", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.reportAgentTaskLease({
      studioId: "studio-1",
      slug: "site-1",
      version: 3,
      sessionId: "sess-1",
      runId: "run-1",
      state: "idle",
    });

    expect(reportAgentLeaseIdleMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "site-1",
      version: 3,
      runId: "run-1",
    });
    expect(touchStudioMachineMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      keepalive: false,
      leaseState: "idle",
    });
  });

  it("upserts checklist using slug/version from route input", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    const runAt = new Date().toISOString();

    await caller.upsertPublishChecklist({
      studioId: "studio-1",
      slug: "site-1",
      version: 2,
      checklist: {
        projectSlug: "wrong-slug",
        version: 99,
        runAt,
        snapshotCommitHash: "abc123",
        items: [
          {
            id: "lint",
            label: "Lint",
            status: "pass",
          },
        ],
        summary: {
          passed: 1,
          failed: 0,
          warnings: 0,
          skipped: 0,
        },
      },
    });

    expect(upsertPublishChecklistMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      checklist: expect.objectContaining({
        projectSlug: "site-1",
        version: 2,
        runAt,
      }),
    });
  });

  it("returns publish checklist from project metadata service", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    getPublishChecklistMock.mockResolvedValueOnce({
      projectSlug: "site-1",
      version: 2,
      runAt: new Date().toISOString(),
      items: [],
      summary: { passed: 0, failed: 0, warnings: 0, skipped: 0 },
    });

    const result = await caller.getPublishChecklist({
      studioId: "studio-1",
      slug: "site-1",
      version: 2,
    });

    expect(getPublishChecklistMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "site-1",
      version: 2,
    });
    expect(result).toEqual({
      checklist: expect.objectContaining({
        projectSlug: "site-1",
        version: 2,
      }),
    });
  });

  it("updates one publish checklist item and recomputes the summary", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    getPublishChecklistMock.mockResolvedValueOnce({
      projectSlug: "site-1",
      version: 2,
      runAt: new Date().toISOString(),
      items: [
        {
          id: "lint",
          label: "Lint",
          status: "fail",
          note: "Needs fixing",
        },
        {
          id: "links",
          label: "Links",
          status: "pass",
        },
      ],
      summary: { passed: 1, failed: 1, warnings: 0, skipped: 0 },
    });

    const result = await caller.updatePublishChecklistItem({
      studioId: "studio-1",
      slug: "site-1",
      version: 2,
      itemId: "lint",
      status: "fixed",
      note: "Resolved",
    });

    expect(upsertPublishChecklistMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      checklist: expect.objectContaining({
        projectSlug: "site-1",
        version: 2,
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "lint",
            status: "fixed",
            note: "Resolved",
          }),
        ]),
        summary: {
          passed: 1,
          failed: 0,
          warnings: 0,
          skipped: 0,
          fixed: 1,
        },
      }),
    });
    expect(result).toEqual({
      checklist: expect.objectContaining({
        projectSlug: "site-1",
        version: 2,
      }),
      item: expect.objectContaining({
        id: "lint",
        status: "fixed",
        note: "Resolved",
      }),
    });
  });

});
