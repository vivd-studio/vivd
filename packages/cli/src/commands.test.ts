import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const originalPreviewScreenshotFlag = process.env.VIVD_CLI_PREVIEW_SCREENSHOT_ENABLED;

const { resolveCliRuntimeMock } = vi.hoisted(() => ({
  resolveCliRuntimeMock: vi.fn(),
}));

vi.mock("./backend.js", () => ({
  resolveCliRuntime: resolveCliRuntimeMock,
}));

vi.mock("@vivd/shared/studio", async () => {
  const actual = await vi.importActual<typeof import("@vivd/shared/studio")>("@vivd/shared/studio");
  return {
    ...actual,
    validateConnectedStudioBackendClientConfig: vi.fn(() => ({
      ok: true,
      missing: [],
    })),
  };
});

import { dispatchCli } from "./commands.js";
import { parseCliArgs, resolveHelpTopic } from "./args.js";

function createRuntimeMock() {
  const query = vi.fn();
  const mutation = vi.fn();
  return {
    config: {
      backendUrl: "https://backend.example.test",
      studioId: "studio_1",
      organizationId: "org_1",
      studioAccessToken: "token_1",
      projectSlug: "demo",
      projectVersion: 7,
    },
    client: {
      query,
      mutation,
    },
    projectSlug: "demo",
    projectVersion: 7,
  };
}

describe("dispatchCli", () => {
  let runtime: ReturnType<typeof createRuntimeMock>;

  beforeEach(() => {
    runtime = createRuntimeMock();
    resolveCliRuntimeMock.mockReset();
    resolveCliRuntimeMock.mockReturnValue(runtime);
    delete process.env.VIVD_CLI_PREVIEW_SCREENSHOT_ENABLED;
    delete process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL;
  });

  it("shows project info with enabled plugins", async () => {
    runtime.client.query.mockResolvedValue({
      project: {
        slug: "demo",
        title: "Demo site",
        source: "url",
        currentVersion: 7,
        requestedVersion: 7,
      },
      enabledPluginIds: ["contact_form", "analytics"],
    });

    const result = await dispatchCli(["project", "info"]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectInfo", {
      studioId: "studio_1",
      slug: "demo",
      version: 7,
    });
    expect(result.human).toContain("Project: Demo site");
    expect(result.human).toContain("Plugins: contact_form, analytics");
  });

  it("captures a preview screenshot and saves it under .vivd/dropped-images by default", async () => {
    process.env.VIVD_CLI_PREVIEW_SCREENSHOT_ENABLED = "true";
    runtime.client.mutation.mockResolvedValue({
      path: "/pricing",
      capturedUrl: "https://preview.example.test/pricing",
      filename: "preview-pricing-1600x1000-x0-y1200.png",
      mimeType: "image/png",
      format: "png",
      width: 1600,
      height: 1000,
      scrollX: 0,
      scrollY: 1200,
      imageBase64: Buffer.from("png-bytes").toString("base64"),
    });

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-cli-preview-"));
    const result = await dispatchCli(
      [
        "preview",
        "screenshot",
        "/pricing",
        "--width",
        "1600",
        "--height",
        "1000",
        "--scroll-y",
        "1200",
      ],
      tempDir,
    );

    expect(runtime.client.mutation).toHaveBeenCalledWith(
      "studioApi.capturePreviewScreenshot",
      {
        studioId: "studio_1",
        slug: "demo",
        version: 7,
        path: "/pricing",
        width: 1600,
        height: 1000,
        scrollX: undefined,
        scrollY: 1200,
        waitMs: undefined,
        format: "png",
      },
    );

    const savedPath = path.join(
      tempDir,
      ".vivd",
      "dropped-images",
      "preview-pricing-1600x1000-x0-y1200.png",
    );
    expect(await fs.readFile(savedPath, "utf8")).toBe("png-bytes");
    expect(result.human).toContain("Preview screenshot saved:");
    expect(result.human).toContain(savedPath);
    expect(result.human).toContain("Viewport: 1600x1000");
  });

  it("keeps preview screenshot commands hidden unless the feature flag is enabled", async () => {
    const rootHelp = await dispatchCli(["help"]);
    const previewHelp = await dispatchCli(["preview", "help"]);

    expect(rootHelp.human).toContain("vivd preview help");
    expect(rootHelp.human).not.toContain("vivd preview screenshot [path]");
    expect(previewHelp.human).toContain("vivd preview status");
    expect(previewHelp.human).toContain("vivd preview logs [path]");
    expect(previewHelp.human).not.toContain("vivd preview screenshot [path]");
    await expect(dispatchCli(["preview", "screenshot", "/"])).rejects.toThrow(
      "Unknown preview command",
    );
  });

  it("shows preview/runtime debugging status including dev server state", async () => {
    runtime.client.query.mockResolvedValue({
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

    const result = await dispatchCli(["preview", "status"]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getPreviewStatus", {
      studioId: "studio_1",
      slug: "demo",
      version: 7,
    });
    expect(result.human).toContain("Preview status for debugging.");
    expect(result.human).toContain("Provider: fly");
    expect(result.human).toContain("Dev server: running");
  });

  it("captures preview logs through the stable preview CLI surface", async () => {
    runtime.client.mutation.mockResolvedValue({
      path: "/pricing",
      capturedUrl: "https://preview.example.test/pricing",
      waitMs: 1200,
      limit: 10,
      level: "warn",
      contains: "hydrate",
      entries: [
        {
          type: "error",
          text: "Hydration failed at <App>",
          timestamp: "2026-04-09T10:00:00.000Z",
          textTruncated: false,
          location: {
            url: "https://preview.example.test/assets/app.js",
            line: 18,
            column: 4,
          },
        },
      ],
      summary: {
        observed: 6,
        matched: 1,
        returned: 1,
        dropped: 0,
        truncatedMessages: 0,
      },
    });

    const result = await dispatchCli([
      "preview",
      "logs",
      "/pricing",
      "--wait-ms",
      "1200",
      "--limit",
      "10",
      "--level",
      "warn",
      "--contains",
      "hydrate",
    ]);

    expect(runtime.client.mutation).toHaveBeenCalledWith(
      "studioApi.capturePreviewLogs",
      {
        studioId: "studio_1",
        slug: "demo",
        version: 7,
        path: "/pricing",
        waitMs: 1200,
        limit: 10,
        level: "warn",
        contains: "hydrate",
      },
    );
    expect(result.human).toContain("Preview logs captured for debugging.");
    expect(result.human).toContain("Filters: level>=warn | limit=10 | wait=1200ms | contains=\"hydrate\"");
    expect(result.human).toContain("[error] Hydration failed at <App>");
  });

  it("shows the publish checklist with project version context", async () => {
    runtime.client.query.mockResolvedValue({
      checklist: {
        projectSlug: "demo",
        version: 7,
        runAt: "2026-03-29T09:00:00.000Z",
        snapshotCommitHash: "abc123",
        items: [
          { id: "seo", label: "SEO", status: "pass" },
          { id: "a11y", label: "Accessibility", status: "warning", note: "Review contrast" },
        ],
        summary: {
          passed: 1,
          failed: 0,
          warnings: 1,
          skipped: 0,
        },
      },
    });

    const result = await dispatchCli(["publish", "checklist", "show"]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getPublishChecklist", {
      studioId: "studio_1",
      slug: "demo",
      version: 7,
    });
    expect(result.human).toContain("Publish checklist for demo v7");
    expect(result.human).toContain("Summary: 1 passed, 0 failed, 1 warnings, 0 skipped");
    expect(result.human).toContain("- seo | pass | SEO");
    expect(result.human).toContain("- a11y | warning | Accessibility | note: Review contrast");
  });

  it("shows publish status from the local Studio surface", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                isPublished: true,
                domain: "demo.example.com",
                commitHash: "abc123",
                publishedAt: "2026-03-29T09:00:00.000Z",
                url: "https://demo.example.com",
                projectVersion: 7,
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                storageEnabled: true,
                readiness: "ready",
                sourceKind: "preview",
                framework: "astro",
                publishableCommitHash: "abc123",
                lastSyncedCommitHash: "abc123",
                builtAt: "2026-03-29T08:58:00.000Z",
                sourceBuiltAt: "2026-03-29T08:57:00.000Z",
                previewBuiltAt: "2026-03-29T08:58:00.000Z",
                error: null,
                studioRunning: true,
                studioStateAvailable: true,
                studioHasUnsavedChanges: false,
                studioHeadCommitHash: "abc123",
                studioWorkingCommitHash: "abc123",
                studioStateReportedAt: "2026-03-29T08:58:30.000Z",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                checklist: {
                  projectSlug: "demo",
                  version: 7,
                  runAt: "2026-03-29T09:00:00.000Z",
                  snapshotCommitHash: "abc123",
                  items: [],
                  summary: {
                    passed: 1,
                    failed: 0,
                    warnings: 0,
                    skipped: 0,
                  },
                },
                stale: false,
                reason: null,
              },
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const result = await dispatchCli(["publish", "status"]);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "http://127.0.0.1:3100/vivd-studio/api/trpc/project.publishStatus?input=%7B%22slug%22%3A%22demo%22%7D",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.human).toContain("Publish status for demo v7");
      expect(result.human).toContain("Published: yes");
      expect(result.human).toContain("Domain: demo.example.com");
      expect(result.human).toContain("Checklist: 1 passed, 0 failed, 0 warnings, 0 skipped (fresh)");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lists recommended publish targets from the local Studio surface", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          data: {
            json: {
              projectSlug: "demo",
              currentPublishedDomain: null,
              recommendedDomain: "tenant.vivd.studio",
              targets: [
                {
                  domain: "tenant.vivd.studio",
                  usage: "tenant_host",
                  type: "managed_subdomain",
                  status: "active",
                  current: false,
                  primaryHost: false,
                  available: true,
                  url: "https://tenant.vivd.studio",
                  recommended: true,
                },
                {
                  domain: "marketing.example.com",
                  usage: "publish_target",
                  type: "custom_domain",
                  status: "active",
                  current: false,
                  primaryHost: false,
                  available: false,
                  blockedReason: "Domain is already in use",
                  url: "https://marketing.example.com",
                  recommended: false,
                },
              ],
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const result = await dispatchCli(["publish", "targets"]);

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3100/vivd-studio/api/trpc/project.publishTargets?input=%7B%22slug%22%3A%22demo%22%7D",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.human).toContain("Publish targets for demo");
      expect(result.human).toContain("Recommended domain: tenant.vivd.studio");
      expect(result.human).toContain(
        "- tenant.vivd.studio | tenant_host | managed | recommended | https://tenant.vivd.studio",
      );
      expect(result.human).toContain(
        "- marketing.example.com | publish_target | reason: Domain is already in use",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("prepares the current saved snapshot before publish", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                storageEnabled: true,
                readiness: "ready",
                sourceKind: "preview",
                framework: "astro",
                publishableCommitHash: "abc123",
                lastSyncedCommitHash: "abc123",
                builtAt: "2026-03-29T08:58:00.000Z",
                sourceBuiltAt: "2026-03-29T08:57:00.000Z",
                previewBuiltAt: "2026-03-29T08:58:00.000Z",
                error: null,
                studioRunning: true,
                studioStateAvailable: true,
                studioHasUnsavedChanges: true,
                studioHeadCommitHash: "abc123",
                studioWorkingCommitHash: "abc123",
                studioStateReportedAt: "2026-03-29T08:58:30.000Z",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                success: true,
                hash: "def456",
                noChanges: false,
                github: {
                  attempted: false,
                  success: true,
                },
                message: "Saved version with commit def456",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                storageEnabled: true,
                readiness: "ready",
                sourceKind: "preview",
                framework: "astro",
                publishableCommitHash: "def456",
                lastSyncedCommitHash: "def456",
                builtAt: "2026-03-29T08:59:00.000Z",
                sourceBuiltAt: "2026-03-29T08:58:30.000Z",
                previewBuiltAt: "2026-03-29T08:59:00.000Z",
                error: null,
                studioRunning: true,
                studioStateAvailable: true,
                studioHasUnsavedChanges: false,
                studioHeadCommitHash: "def456",
                studioWorkingCommitHash: "def456",
                studioStateReportedAt: "2026-03-29T08:59:10.000Z",
              },
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const result = await dispatchCli(["publish", "prepare"]);

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "http://127.0.0.1:3100/vivd-studio/api/trpc/project.gitSave",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            slug: "demo",
            version: 7,
            message: "Prepare publish artifacts",
          }),
        }),
      );
      expect(result.human).toContain("Publish prepare for demo v7");
      expect(result.human).toContain("Action: saved current changes and prepared artifacts");
      expect(result.human).toContain("Prepared commit: def456");
      expect(result.human).toContain("Ready to publish: yes");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("re-requests artifact preparation when the prepared snapshot lags the saved head commit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                storageEnabled: true,
                readiness: "ready",
                sourceKind: "preview",
                framework: "astro",
                publishableCommitHash: "prepared123",
                lastSyncedCommitHash: "head789",
                builtAt: "2026-03-29T08:58:00.000Z",
                sourceBuiltAt: "2026-03-29T08:57:00.000Z",
                previewBuiltAt: "2026-03-29T08:58:00.000Z",
                error: null,
                studioRunning: true,
                studioStateAvailable: true,
                studioHasUnsavedChanges: false,
                studioHeadCommitHash: "head789",
                studioWorkingCommitHash: "head789",
                studioStateReportedAt: "2026-03-29T08:58:30.000Z",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                success: true,
                hash: "",
                noChanges: true,
                github: {
                  attempted: false,
                  success: true,
                },
                message: "No changes to save. Preparing artifacts for head789",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                storageEnabled: true,
                readiness: "ready",
                sourceKind: "preview",
                framework: "astro",
                publishableCommitHash: "head789",
                lastSyncedCommitHash: "head789",
                builtAt: "2026-03-29T08:59:30.000Z",
                sourceBuiltAt: "2026-03-29T08:58:45.000Z",
                previewBuiltAt: "2026-03-29T08:59:30.000Z",
                error: null,
                studioRunning: true,
                studioStateAvailable: true,
                studioHasUnsavedChanges: false,
                studioHeadCommitHash: "head789",
                studioWorkingCommitHash: "head789",
                studioStateReportedAt: "2026-03-29T08:59:35.000Z",
              },
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const result = await dispatchCli(["publish", "prepare"]);

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "http://127.0.0.1:3100/vivd-studio/api/trpc/project.gitSave",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            slug: "demo",
            version: 7,
            message: "Prepare publish artifacts",
          }),
        }),
      );
      expect(result.human).toContain(
        "Action: requested artifact preparation for the current saved snapshot",
      );
      expect(result.human).toContain("Prepared commit: head789");
      expect(result.human).toContain("Ready to publish: yes");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deploys through the local Studio surface and validates the target domain", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                projectSlug: "demo",
                currentPublishedDomain: null,
                recommendedDomain: "launch.example.com",
                targets: [
                  {
                    domain: "launch.example.com",
                    usage: "publish_target",
                    type: "custom_domain",
                    status: "active",
                    current: false,
                    primaryHost: false,
                    available: true,
                    url: "https://launch.example.com",
                    recommended: true,
                  },
                ],
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                storageEnabled: true,
                readiness: "ready",
                sourceKind: "preview",
                framework: "astro",
                publishableCommitHash: "def456",
                lastSyncedCommitHash: "def456",
                builtAt: "2026-03-29T08:58:00.000Z",
                sourceBuiltAt: "2026-03-29T08:57:00.000Z",
                previewBuiltAt: "2026-03-29T08:58:00.000Z",
                error: null,
                studioRunning: true,
                studioStateAvailable: true,
                studioHasUnsavedChanges: false,
                studioHeadCommitHash: "def456",
                studioWorkingCommitHash: "def456",
                studioStateReportedAt: "2026-03-29T08:58:30.000Z",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                available: true,
                normalizedDomain: "launch.example.com",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                success: true,
                domain: "launch.example.com",
                commitHash: "def456",
                url: "https://launch.example.com",
                message: "Published successfully",
              },
            },
          },
        }),
      });
    const originalToken = process.env.STUDIO_ACCESS_TOKEN;
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    process.env.STUDIO_ACCESS_TOKEN = "token_1";

    try {
      const result = await dispatchCli([
        "publish",
        "deploy",
        "--domain",
        "Launch.Example.com",
      ]);

      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "http://127.0.0.1:3100/vivd-studio/api/trpc/project.publish",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-vivd-studio-token": "token_1",
          }),
          body: JSON.stringify({
            slug: "demo",
            version: 7,
            domain: "launch.example.com",
            expectedCommitHash: "def456",
          }),
        }),
      );
      expect(result.human).toContain("Site published successfully.");
      expect(result.human).toContain("Domain: launch.example.com");
      expect(result.human).toContain("Commit: def456");
    } finally {
      if (originalToken == null) {
        delete process.env.STUDIO_ACCESS_TOKEN;
      } else {
        process.env.STUDIO_ACCESS_TOKEN = originalToken;
      }
      vi.unstubAllGlobals();
    }
  });

  it("reuses the existing published domain when deploy runs without --domain", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                projectSlug: "demo",
                currentPublishedDomain: "demo.example.com",
                recommendedDomain: "demo.example.com",
                targets: [
                  {
                    domain: "demo.example.com",
                    usage: "publish_target",
                    type: "custom_domain",
                    status: "active",
                    current: true,
                    primaryHost: false,
                    available: true,
                    url: "https://demo.example.com",
                    recommended: true,
                  },
                  {
                    domain: "alt.example.com",
                    usage: "publish_target",
                    type: "custom_domain",
                    status: "active",
                    current: false,
                    primaryHost: false,
                    available: true,
                    url: "https://alt.example.com",
                    recommended: false,
                  },
                ],
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                storageEnabled: true,
                readiness: "ready",
                sourceKind: "preview",
                framework: "astro",
                publishableCommitHash: "xyz789",
                lastSyncedCommitHash: "xyz789",
                builtAt: "2026-03-29T08:58:00.000Z",
                sourceBuiltAt: "2026-03-29T08:57:00.000Z",
                previewBuiltAt: "2026-03-29T08:58:00.000Z",
                error: null,
                studioRunning: false,
                studioStateAvailable: true,
                studioHasUnsavedChanges: false,
                studioHeadCommitHash: null,
                studioWorkingCommitHash: null,
                studioStateReportedAt: "2026-03-29T08:58:30.000Z",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                success: true,
                domain: "demo.example.com",
                commitHash: "xyz789",
                url: "https://demo.example.com",
                message: "Published successfully",
              },
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      await dispatchCli(["publish", "deploy"]);

      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "http://127.0.0.1:3100/vivd-studio/api/trpc/project.publish",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            slug: "demo",
            version: 7,
            domain: "demo.example.com",
            expectedCommitHash: "xyz789",
          }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires --domain when multiple first-publish targets are available", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                projectSlug: "demo",
                currentPublishedDomain: null,
                recommendedDomain: "tenant.vivd.studio",
                targets: [
                  {
                    domain: "tenant.vivd.studio",
                    usage: "tenant_host",
                    type: "managed_subdomain",
                    status: "active",
                    current: false,
                    primaryHost: false,
                    available: true,
                    url: "https://tenant.vivd.studio",
                    recommended: true,
                  },
                  {
                    domain: "marketing.example.com",
                    usage: "publish_target",
                    type: "custom_domain",
                    status: "active",
                    current: false,
                    primaryHost: false,
                    available: true,
                    url: "https://marketing.example.com",
                    recommended: false,
                  },
                ],
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                storageEnabled: true,
                readiness: "ready",
                sourceKind: "preview",
                framework: "astro",
                publishableCommitHash: "def456",
                lastSyncedCommitHash: "def456",
                builtAt: "2026-03-29T08:58:00.000Z",
                sourceBuiltAt: "2026-03-29T08:57:00.000Z",
                previewBuiltAt: "2026-03-29T08:58:00.000Z",
                error: null,
                studioRunning: true,
                studioStateAvailable: true,
                studioHasUnsavedChanges: false,
                studioHeadCommitHash: "def456",
                studioWorkingCommitHash: "def456",
                studioStateReportedAt: "2026-03-29T08:58:30.000Z",
              },
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      await expect(dispatchCli(["publish", "deploy"])).rejects.toThrow(
        "Multiple publish targets are available. Run `vivd publish targets` and pass --domain <domain>.",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("unpublishes through the local Studio surface", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                isPublished: true,
                domain: "demo.example.com",
                commitHash: "abc123",
                publishedAt: "2026-03-29T09:00:00.000Z",
                url: "https://demo.example.com",
                projectVersion: 7,
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                success: true,
                message: "Site unpublished successfully",
              },
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const result = await dispatchCli(["publish", "unpublish"]);

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "http://127.0.0.1:3100/vivd-studio/api/trpc/project.unpublish",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            slug: "demo",
          }),
        }),
      );
      expect(result.human).toContain("Site unpublished.");
      expect(result.human).toContain("Domain: demo.example.com");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("suggests running the checklist when no saved checklist exists yet", async () => {
    runtime.client.query.mockResolvedValue({
      checklist: null,
    });

    const result = await dispatchCli(["publish", "checklist", "show"]);

    expect(result.human).toContain("Publish checklist: none");
    expect(result.human).toContain("vivd publish checklist run");
    expect(result.human).toContain("only if the user explicitly asked");
  });

  it("runs the publish checklist through the local Studio runtime", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          data: {
            json: {
              success: true,
              sessionId: "sess-checklist",
              checklist: {
                projectSlug: "demo",
                version: 7,
                runAt: "2026-03-29T09:00:00.000Z",
                snapshotCommitHash: "abc123",
                items: [
                  { id: "seo", label: "SEO", status: "pass" },
                ],
                summary: {
                  passed: 1,
                  failed: 0,
                  warnings: 0,
                  skipped: 0,
                },
              },
            },
          },
        },
      }),
    });
    const originalToken = process.env.STUDIO_ACCESS_TOKEN;
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    process.env.STUDIO_ACCESS_TOKEN = "token_1";

    try {
      const result = await dispatchCli(["publish", "checklist", "run"]);

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3100/vivd-studio/api/trpc/agent.runPrePublishChecklist",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-vivd-studio-token": "token_1",
          }),
          body: JSON.stringify({
            projectSlug: "demo",
            version: 7,
          }),
        }),
      );
      expect(result.human).toContain("Publish checklist run completed.");
      expect(result.human).toContain("Session: sess-checklist");
      expect(result.human).toContain("Publish checklist for demo v7");
    } finally {
      if (originalToken == null) {
        delete process.env.STUDIO_ACCESS_TOKEN;
      } else {
        process.env.STUDIO_ACCESS_TOKEN = originalToken;
      }
      vi.unstubAllGlobals();
    }
  });

  it("updates a publish checklist item with status and note", async () => {
    runtime.client.mutation.mockResolvedValue({
      checklist: {
        projectSlug: "demo",
        version: 7,
        summary: {
          passed: 2,
          failed: 0,
          warnings: 0,
          skipped: 0,
        },
      },
      item: {
        id: "seo",
        label: "SEO",
        status: "pass",
        note: "done",
      },
    });

    const result = await dispatchCli([
      "publish",
      "checklist",
      "update",
      "seo",
      "--status",
      "pass",
      "--note",
      "done",
    ]);

    expect(runtime.client.mutation).toHaveBeenCalledWith("studioApi.updatePublishChecklistItem", {
      studioId: "studio_1",
      slug: "demo",
      version: 7,
      itemId: "seo",
      status: "pass",
      note: "done",
    });
    expect(result.human).toContain("Updated item: seo");
    expect(result.human).toContain("Status: pass");
    expect(result.human).toContain("Note: done");
  });

  it.each(["verify", "resend"] as const)(
    "requests contact recipient verification via %s",
    async (mode) => {
      runtime.client.mutation.mockResolvedValue({
        pluginId: "contact_form",
        actionId: mode === "resend" ? "resend_recipient" : "verify_recipient",
        summary:
          mode === "resend"
            ? "Resent recipient verification request."
            : "Requested recipient verification.",
        result: {
          email: "person@example.com",
          status: "verification_sent",
          cooldownRemainingSeconds: 0,
        },
      });

      const result = await dispatchCli([
        "plugins",
        "contact",
        "recipients",
        mode,
        "person@example.com",
      ]);

      expect(runtime.client.mutation).toHaveBeenCalledWith(
        "studioApi.runProjectPluginAction",
        {
          studioId: "studio_1",
          slug: "demo",
          pluginId: "contact_form",
          actionId: mode === "resend" ? "resend_recipient" : "verify_recipient",
          args: ["person@example.com"],
        },
      );
      expect(result.human).toContain("Recipient: person@example.com");
      expect(result.human).toContain("verification email sent");
      if (mode === "resend") {
        expect(result.human).toContain("Resent recipient verification request.");
      }
    },
  );

  it("marks a contact recipient verified via the contact alias", async () => {
    runtime.client.mutation.mockResolvedValue({
      pluginId: "contact_form",
      actionId: "mark_recipient_verified",
      summary: "Marked recipient email as verified.",
      result: {
        email: "person@example.com",
        status: "marked_verified",
        cooldownRemainingSeconds: 0,
      },
    });

    const result = await dispatchCli([
      "plugins",
      "contact",
      "recipients",
      "mark-verified",
      "person@example.com",
    ]);

    expect(runtime.client.mutation).toHaveBeenCalledWith(
      "studioApi.runProjectPluginAction",
      {
        studioId: "studio_1",
        slug: "demo",
        pluginId: "contact_form",
        actionId: "mark_recipient_verified",
        args: ["person@example.com"],
      },
    );
    expect(result.human).toContain("Marked recipient email as verified.");
    expect(result.human).toContain("Recipient: person@example.com");
    expect(result.human).toContain("manually marked verified");
  });

  it("shows generic plugin info through the capability contract", async () => {
    runtime.client.query.mockResolvedValue({
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
              description: "Send verification email",
              arguments: [{ name: "email", type: "email", required: true }],
            },
            {
              actionId: "mark_recipient_verified",
              title: "Mark recipient verified",
              description: "Manually mark recipient verified",
              arguments: [{ name: "email", type: "email", required: true }],
            },
          ],
        },
      },
      entitled: true,
      entitlementState: "enabled",
      enabled: true,
      instanceId: "plugin_1",
      status: "enabled",
      publicToken: "public_1",
      config: {
        recipientEmails: ["owner@example.com"],
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

    const result = await dispatchCli(["plugins", "info", "contact_form"]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectPluginInfo", {
      studioId: "studio_1",
      slug: "demo",
      pluginId: "contact_form",
    });
    expect(result.human).toContain("Plugin: Contact Form");
    expect(result.human).toContain("Plugin ID: contact_form");
    expect(result.human).toContain("Config support: show, template, apply");
    expect(result.human).toContain("- verify_recipient <email> - Verify recipient");
    expect(result.human).toContain(
      "- mark_recipient_verified <email> - Mark recipient verified",
    );
  });

  it.each([
    ["plugins", "info", "contact"],
    ["plugins", "contact", "info"],
  ])("shows contact info with recipient and field configuration via %j", async (...argv) => {
    runtime.client.query.mockResolvedValue({
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
      instanceId: "plugin_1",
      status: "enabled",
      publicToken: "public_1",
      config: {
        recipientEmails: ["owner@example.com"],
        sourceHosts: ["example.com"],
        redirectHostAllowlist: ["example.com"],
        formFields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "message", label: "Message", type: "textarea", required: true },
        ],
      },
      usage: {
        submitEndpoint: "https://api.example.test/plugins/contact",
        expectedFields: ["token", "name", "message"],
        optionalFields: ["_redirect"],
        inferredAutoSourceHosts: ["example.com"],
        turnstileEnabled: false,
        turnstileConfigured: false,
      },
      defaultConfig: {
        recipientEmails: ["team@example.com"],
      },
      snippets: {
        html: "<form></form>",
      },
      details: {
        recipients: {
          options: [
            { email: "owner@example.com", isVerified: true, isPending: false },
            { email: "pending@example.com", isVerified: false, isPending: true },
          ],
          pending: [{ email: "pending@example.com", lastSentAt: "2026-03-29T08:00:00.000Z" }],
        },
      },
      instructions: ["Insert the snippet", "Verify with a test submit"],
    });

    const result = await dispatchCli(argv);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectPluginInfo", {
      studioId: "studio_1",
      slug: "demo",
      pluginId: "contact_form",
    });
    expect(result.human).toContain("Submit endpoint: https://api.example.test/plugins/contact");
    expect(result.human).toContain("Configured recipients: owner@example.com");
    expect(result.human).toContain("Form fields: name, message");
    expect(result.human).toContain("- owner@example.com [verified]");
    expect(result.human).toContain("- pending@example.com [pending, last sent 2026-03-29T08:00:00.000Z]");
  });

  it("shows the saved contact config", async () => {
    runtime.client.query.mockResolvedValue({
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
      instanceId: "plugin_1",
      status: "enabled",
      publicToken: "public_1",
      config: {
        recipientEmails: ["team@example.com"],
        sourceHosts: ["example.com"],
        redirectHostAllowlist: ["example.com"],
        formFields: [
          { key: "name", label: "Name", type: "text", required: true, placeholder: "" },
          { key: "message", label: "Message", type: "textarea", required: true, placeholder: "", rows: 5 },
        ],
      },
      usage: {
        submitEndpoint: "https://api.example.test/plugins/contact",
        expectedFields: ["token", "name", "message"],
        optionalFields: ["_redirect"],
        inferredAutoSourceHosts: ["example.com"],
        turnstileEnabled: false,
        turnstileConfigured: false,
      },
      defaultConfig: {
        recipientEmails: ["team@example.com"],
      },
      snippets: {
        html: "<form></form>",
      },
      details: {
        recipients: {
          options: [],
          pending: [],
        },
      },
      instructions: [],
    });

    const result = await dispatchCli(["plugins", "contact", "config", "show"]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectPluginInfo", {
      studioId: "studio_1",
      slug: "demo",
      pluginId: "contact_form",
    });
    expect(result.data).toEqual({
      recipientEmails: ["team@example.com"],
      sourceHosts: ["example.com"],
      redirectHostAllowlist: ["example.com"],
      formFields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "" },
        { key: "message", label: "Message", type: "textarea", required: true, placeholder: "", rows: 5 },
      ],
    });
    expect(result.human).toContain("Contact config for demo");
    expect(result.human).toContain("\"recipientEmails\": [");
    expect(result.human).toContain("vivd plugins contact config apply --file -");
  });

  it.each([
    ["plugins", "info", "analytics"],
    ["plugins", "analytics", "info"],
  ])("shows analytics info through the plugin CLI module via %j", async (...argv) => {
    runtime.client.query.mockResolvedValue({
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
      instanceId: "plugin_analytics",
      status: "enabled",
      publicToken: "analytics_public",
      config: {
        respectDoNotTrack: true,
        captureQueryString: false,
      },
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
      instructions: ["Insert the analytics script snippet once per page."],
    });

    const result = await dispatchCli(argv);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectPluginInfo", {
      studioId: "studio_1",
      slug: "demo",
      pluginId: "analytics",
    });
    expect(result.data).toEqual({
      pluginId: "analytics",
      entitled: true,
      entitlementState: "enabled",
      enabled: true,
      instanceId: "plugin_analytics",
      status: "enabled",
      publicToken: "analytics_public",
      usage: {
        scriptEndpoint: "https://api.example.test/plugins/analytics/script.js",
        trackEndpoint: "https://api.example.test/plugins/analytics/track",
        eventTypes: ["pageview", "custom"],
        respectDoNotTrack: true,
        captureQueryString: false,
        enableClientTracking: true,
      },
      instructions: ["Insert the analytics script snippet once per page."],
    });
    expect(result.human).toContain(
      "Script endpoint: https://api.example.test/plugins/analytics/script.js",
    );
    expect(result.human).toContain("Track endpoint: https://api.example.test/plugins/analytics/track");
    expect(result.human).toContain("Event types: pageview, custom");
  });

  it("reads generic plugin data through the shared plugin contract", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-cli-plugin-read-"));
    const inputPath = path.join(tmpDir, "analytics-read.json");
    await fs.writeFile(
      inputPath,
      JSON.stringify({
        days: 30,
      }),
    );
    runtime.client.query.mockResolvedValue({
      pluginId: "analytics",
      readId: "summary",
      result: {
        totalVisitors: 123,
        pageviews: 456,
      },
    });

    const result = await dispatchCli(
      ["plugins", "read", "analytics", "summary", "--file", inputPath],
      tmpDir,
    );

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectPluginRead", {
      studioId: "studio_1",
      slug: "demo",
      pluginId: "analytics",
      readId: "summary",
      input: {
        days: 30,
      },
    });
    expect(result.data).toEqual({
      pluginId: "analytics",
      readId: "summary",
      result: {
        totalVisitors: 123,
        pageviews: 456,
      },
    });
    expect(result.human).toContain("Plugin: analytics");
    expect(result.human).toContain("Read: summary");
    expect(result.human).toContain("\"totalVisitors\": 123");
  });

  it("prints full plugin snippets through the generic snippets command", async () => {
    runtime.client.query.mockResolvedValue({
      pluginId: "newsletter",
      catalog: {
        pluginId: "newsletter",
        name: "Newsletter / Waitlist",
        description: "Capture newsletter subscribers and waitlist signups.",
        capabilities: {
          supportsInfo: true,
          config: {
            supportsShow: true,
            supportsApply: true,
            supportsTemplate: true,
          },
          actions: [],
          reads: [],
        },
      },
      entitled: true,
      entitlementState: "enabled",
      enabled: true,
      instanceId: "plugin_newsletter",
      status: "enabled",
      publicToken: "newsletter_public",
      config: {
        mode: "newsletter",
      },
      defaultConfig: {
        mode: "newsletter",
      },
      snippets: {
        html: "<form>newsletter-html</form>",
        astro: "<NewsletterForm />",
      },
      usage: {
        subscribeEndpoint: "https://api.example.test/plugins/newsletter/subscribe",
      },
      details: null,
      instructions: ["Install the generated snippet."],
    });

    const result = await dispatchCli(["plugins", "snippets", "newsletter", "html"]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectPluginInfo", {
      studioId: "studio_1",
      slug: "demo",
      pluginId: "newsletter",
    });
    expect(result.data).toEqual({
      pluginId: "newsletter",
      pluginName: "Newsletter / Waitlist",
      snippetName: "html",
      snippet: "<form>newsletter-html</form>",
      availableSnippetNames: ["html", "astro"],
    });
    expect(result.human).toContain("Newsletter / Waitlist snippet");
    expect(result.human).toContain("Snippet: html");
    expect(result.human).toContain("<form>newsletter-html</form>");
  });

  it("treats legacy snippet reads as a compatibility path", async () => {
    runtime.client.query.mockResolvedValue({
      pluginId: "newsletter",
      catalog: {
        pluginId: "newsletter",
        name: "Newsletter / Waitlist",
        description: "Capture newsletter subscribers and waitlist signups.",
        capabilities: {
          supportsInfo: true,
          config: {
            supportsShow: true,
            supportsApply: true,
            supportsTemplate: true,
          },
          actions: [],
          reads: [],
        },
      },
      entitled: true,
      entitlementState: "enabled",
      enabled: true,
      instanceId: "plugin_newsletter",
      status: "enabled",
      publicToken: "newsletter_public",
      config: {
        mode: "newsletter",
      },
      defaultConfig: {
        mode: "newsletter",
      },
      snippets: {
        html: "<form>newsletter-html</form>",
        astro: "<NewsletterForm />",
      },
      usage: {
        subscribeEndpoint: "https://api.example.test/plugins/newsletter/subscribe",
      },
      details: null,
      instructions: ["Install the generated snippet."],
    });

    const result = await dispatchCli(["plugins", "read", "newsletter", "snippet"]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectPluginInfo", {
      studioId: "studio_1",
      slug: "demo",
      pluginId: "newsletter",
    });
    expect(result.human).toContain("Newsletter / Waitlist snippets");
    expect(result.human).toContain("[html]");
    expect(result.human).toContain("[astro]");
  });

  it("shows generic plugin config and template", async () => {
    runtime.client.query.mockResolvedValue({
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
      instanceId: "plugin_analytics",
      status: "enabled",
      publicToken: "analytics_public",
      config: {
        respectDoNotTrack: true,
        captureQueryString: false,
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
      instructions: [],
    });

    const showResult = await dispatchCli(["plugins", "config", "show", "analytics"]);
    const templateResult = await dispatchCli([
      "plugins",
      "config",
      "template",
      "analytics",
    ]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectPluginInfo", {
      studioId: "studio_1",
      slug: "demo",
      pluginId: "analytics",
    });
    expect(showResult.human).toContain("Analytics config for demo");
    expect(showResult.human).toContain("\"respectDoNotTrack\": true");
    expect(templateResult.human).toContain("Analytics config template");
    expect(templateResult.human).toContain(
      "vivd plugins config apply analytics --file -",
    );
  });

  it("prints a contact config template", async () => {
    const result = await dispatchCli(["plugins", "contact", "config", "template"]);

    expect(result.data).toEqual({
      recipientEmails: ["team@example.com"],
      sourceHosts: ["example.com"],
      redirectHostAllowlist: ["example.com"],
      formFields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "" },
        { key: "email", label: "Email", type: "email", required: true, placeholder: "" },
        {
          key: "message",
          label: "Message",
          type: "textarea",
          required: true,
          placeholder: "",
          rows: 5,
        },
      ],
    });
    expect(result.human).toContain("Contact config template");
    expect(result.human).toContain("\"recipientEmails\": [");
    expect(result.human).toContain("vivd plugins contact config apply --file -");
  });

  it.each([
    ["plugins", "configure", "contact"],
    ["plugins", "contact", "config", "apply"],
  ])("updates contact plugin config from a json file via %j", async (...command) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-cli-"));
    const configPath = path.join(tmpDir, "contact.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        recipientEmails: ["team@example.com"],
        sourceHosts: ["example.com"],
        redirectHostAllowlist: ["example.com"],
        formFields: [
          { key: "name", label: "Name", type: "text", required: true, placeholder: "" },
        ],
      }),
    );
    runtime.client.mutation.mockResolvedValue({ success: true });

    const result = await dispatchCli([...command, "--file", configPath], tmpDir);

    expect(runtime.client.mutation).toHaveBeenCalledWith(
      "studioApi.updateProjectPluginConfig",
      {
        studioId: "studio_1",
        slug: "demo",
        pluginId: "contact_form",
        config: {
          recipientEmails: ["team@example.com"],
          sourceHosts: ["example.com"],
          redirectHostAllowlist: ["example.com"],
          formFields: [
            { key: "name", label: "Name", type: "text", required: true, placeholder: "" },
          ],
        },
      },
    );
    expect(result.human).toContain("Contact plugin config updated for demo");
    expect(result.human).toContain("vivd plugins contact config show");
  });

  it("updates plugin config through the generic capability contract", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-cli-"));
    const configPath = path.join(tmpDir, "analytics.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        respectDoNotTrack: true,
        captureQueryString: false,
      }),
    );
    runtime.client.mutation.mockResolvedValue({
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
      instanceId: "plugin_analytics",
      status: "enabled",
      publicToken: "analytics_public",
      config: {
        respectDoNotTrack: true,
        captureQueryString: false,
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
      instructions: [],
    });

    const result = await dispatchCli(
      ["plugins", "config", "apply", "analytics", "--file", configPath],
      tmpDir,
    );

    expect(runtime.client.mutation).toHaveBeenCalledWith(
      "studioApi.updateProjectPluginConfig",
      {
        studioId: "studio_1",
        slug: "demo",
        pluginId: "analytics",
        config: {
          respectDoNotTrack: true,
          captureQueryString: false,
        },
      },
    );
    expect(result.human).toContain("Analytics config updated for demo");
    expect(result.human).toContain("vivd plugins config show analytics");
  });

  it("updates contact plugin config from stdin when --file - is used", async () => {
    runtime.client.mutation.mockResolvedValue({ success: true });

    const handlers = new Map<string, (chunk?: string) => void>();
    const setEncodingSpy = vi
      .spyOn(process.stdin, "setEncoding")
      .mockImplementation(() => process.stdin);
    const onSpy = vi.spyOn(process.stdin, "on").mockImplementation((event, handler: any) => {
      handlers.set(event, handler);
      return process.stdin;
    });

    try {
      const resultPromise = dispatchCli(["plugins", "contact", "config", "apply", "--file", "-"]);
      handlers.get("data")?.(
        JSON.stringify({
          recipientEmails: ["stdin@example.com"],
          sourceHosts: ["example.com"],
          redirectHostAllowlist: ["example.com"],
          formFields: [
            { key: "email", label: "Email", type: "email", required: true, placeholder: "" },
          ],
        }),
      );
      handlers.get("end")?.();

      const result = await resultPromise;

      expect(setEncodingSpy).toHaveBeenCalledWith("utf8");
      expect(runtime.client.mutation).toHaveBeenCalledWith(
        "studioApi.updateProjectPluginConfig",
        {
          studioId: "studio_1",
          slug: "demo",
          pluginId: "contact_form",
          config: {
            recipientEmails: ["stdin@example.com"],
            sourceHosts: ["example.com"],
            redirectHostAllowlist: ["example.com"],
            formFields: [
              { key: "email", label: "Email", type: "email", required: true, placeholder: "" },
            ],
          },
        },
      );
      expect(result.human).toContain("Contact plugin config updated for demo");
    } finally {
      onSpy.mockRestore();
      setEncodingSpy.mockRestore();
    }
  });

  it("runs generic plugin actions", async () => {
    runtime.client.mutation.mockResolvedValue({
      pluginId: "contact_form",
      actionId: "mark_recipient_verified",
      summary: "Marked recipient email as verified.",
      result: {
        email: "person@example.com",
        status: "marked_verified",
        cooldownRemainingSeconds: 0,
      },
    });

    const result = await dispatchCli([
      "plugins",
      "action",
      "contact_form",
      "mark_recipient_verified",
      "person@example.com",
    ]);

    expect(runtime.client.mutation).toHaveBeenCalledWith(
      "studioApi.runProjectPluginAction",
      {
        studioId: "studio_1",
        slug: "demo",
        pluginId: "contact_form",
        actionId: "mark_recipient_verified",
        args: ["person@example.com"],
      },
    );
    expect(result.human).toContain("Marked recipient email as verified.");
    expect(result.human).toContain("Action: mark_recipient_verified");
    expect(result.human).toContain("\"email\": \"person@example.com\"");
  });

  it("drafts a support request with project context and consent reminder", async () => {
    process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL = "support@vivd.studio";
    runtime.client.query.mockResolvedValue({
      project: {
        slug: "demo",
        title: "Demo site",
        source: "url",
        currentVersion: 7,
        requestedVersion: 7,
      },
      enabledPluginIds: ["analytics"],
    });

    const result = await dispatchCli([
      "support",
      "request",
      "enable",
      "contact_form",
      "for",
      "this",
      "project",
      "--note",
      "Customer approved contacting support",
    ]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectInfo", {
      studioId: "studio_1",
      slug: "demo",
      version: 7,
    });
    expect(result.human).toContain("Support email draft prepared.");
    expect(result.human).toContain(
      "Permission required: ask the user explicitly before contacting support on their behalf.",
    );
    expect(result.human).toContain("Recipient: support@vivd.studio");
    expect(result.human).toContain("Project: demo");
    expect(result.human).toContain("Version: 7");
    expect(result.human).toContain("Enabled plugins: analytics");
    expect(result.human).toContain("Customer approved contacting support");
    expect(result.human).toContain("mailto:support@vivd.studio");
    expect(result.human).toContain("Hello Vivd support,");
  });

  it("requires a support request summary", async () => {
    process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL = "support@vivd.studio";
    await expect(dispatchCli(["support", "request"])).rejects.toThrow(
      "support request requires a summary",
    );
  });

  it("rejects support requests when no support email is configured", async () => {
    await expect(
      dispatchCli(["support", "request", "enable", "analytics", "for", "this", "project"]),
    ).rejects.toThrow("Support contact is not configured for this runtime.");
  });

  it("shows help with CMS commands", async () => {
    process.env.VIVD_CLI_PREVIEW_SCREENSHOT_ENABLED = "true";
    process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL = "support@vivd.studio";
    const rootHelp = await dispatchCli(["help"]);
    const cmsHelp = await dispatchCli(["cms", "help"]);
    const previewHelp = await dispatchCli(["preview", "help"]);
    const pluginsHelp = await dispatchCli(["plugins", "help"]);
    const publishHelp = await dispatchCli(["publish", "help"]);
    const supportHelp = await dispatchCli(["support", "help"]);
    const contactHelp = await dispatchCli(["plugins", "contact", "help"]);
    const analyticsHelp = await dispatchCli(["plugins", "analytics", "help"]);

    expect(rootHelp.human).toContain("USAGE");
    expect(rootHelp.human).toContain("CONNECTION & CONTEXT");
    expect(rootHelp.human).toContain("PREVIEW & DEBUGGING");
    expect(rootHelp.human).toContain("PLUGINS");
    expect(rootHelp.human).toContain("LOCAL CMS");
    expect(rootHelp.human).toContain("PUBLISH");
    expect(rootHelp.human).toContain("SUPPORT");
    expect(rootHelp.human).toContain("GLOBAL FLAGS");
    expect(rootHelp.human).toContain("EXAMPLES");
    expect(rootHelp.human).toContain("vivd preview status");
    expect(rootHelp.human).toContain("vivd preview screenshot [path]");
    expect(rootHelp.human).toContain("vivd plugins snippets <pluginId> [snippetName]");
    expect(rootHelp.human).toContain("vivd plugins read <pluginId> <readId> [--file <json>]");
    expect(rootHelp.human).toContain("vivd plugins action <pluginId> <actionId> [args...]");
    expect(rootHelp.human).toContain("vivd plugins help");
    expect(rootHelp.human).not.toContain("PLUGIN SHORTCUTS");
    expect(rootHelp.human).toContain("MAIN_BACKEND_URL, STUDIO_ID, and STUDIO_ACCESS_TOKEN");
    expect(rootHelp.human).toContain("vivd cms help");
    expect(rootHelp.human).toContain("vivd publish help");
    expect(rootHelp.human).toContain("vivd cms helper status");
    expect(rootHelp.human).toContain("vivd publish status");
    expect(rootHelp.human).toContain("vivd publish targets");
    expect(rootHelp.human).toContain("vivd publish prepare");
    expect(rootHelp.human).toContain("vivd publish deploy [--domain <domain>]");
    expect(rootHelp.human).toContain("vivd support request <summary...>");
    expect(rootHelp.human).toContain("DISCOVER MORE");
    expect(cmsHelp.human).toContain("vivd cms helper status");
    expect(cmsHelp.human).toContain("vivd cms helper install");
    expect(cmsHelp.human).not.toContain("vivd cms scaffold init");
    expect(cmsHelp.human).toContain("src/content/");
    expect(previewHelp.human).toContain("vivd preview status");
    expect(previewHelp.human).toContain("dev server is running");
    expect(previewHelp.human).toContain("vivd preview logs [path]");
    expect(previewHelp.human).toContain("for debugging");
    expect(previewHelp.human).toContain("vivd preview screenshot [path]");
    expect(previewHelp.human).toContain(".vivd/dropped-images/");
    expect(pluginsHelp.human).toContain("vivd plugins info <pluginId>");
    expect(pluginsHelp.human).toContain("vivd plugins snippets <pluginId> [snippetName]");
    expect(pluginsHelp.human).toContain("vivd plugins read <pluginId> <readId> [--file input.json]");
    expect(pluginsHelp.human).toContain("vivd plugins action <pluginId> <actionId> [args...]");
    expect(publishHelp.human).toContain("vivd publish status");
    expect(publishHelp.human).toContain("vivd publish targets");
    expect(publishHelp.human).toContain("vivd publish prepare");
    expect(publishHelp.human).toContain("vivd publish deploy [--domain <domain>]");
    expect(publishHelp.human).toContain("vivd publish unpublish");
    expect(publishHelp.human).toContain("vivd publish checklist run");
    expect(publishHelp.human).toContain("vivd publish checklist show");
    expect(publishHelp.human).toContain("explicit approval");
    expect(publishHelp.human).toContain("inspect or continue checklist items one by one");
    expect(publishHelp.human).toContain("current saved Studio snapshot");
    expect(publishHelp.human).toContain("current saved, prepared snapshot");
    expect(supportHelp.human).toContain("vivd support request <summary...>");
    expect(supportHelp.human).toContain("Always ask the user for explicit permission");
    expect(contactHelp.human).toContain("vivd plugins contact info");
    expect(contactHelp.human).toContain("vivd plugins info contact_form");
    expect(contactHelp.human).toContain("vivd plugins snippets contact_form [html|astro]");
    expect(contactHelp.human).toContain("vivd plugins contact config show");
    expect(contactHelp.human).toContain("vivd plugins contact recipients verify <email>");
    expect(contactHelp.human).toContain("vivd plugins contact recipients mark-verified <email>");
    expect(analyticsHelp.human).toContain("vivd plugins info analytics");
    expect(analyticsHelp.human).toContain("vivd plugins analytics info");
    expect(analyticsHelp.human).toContain("vivd plugins snippets analytics [html|astro]");
  });

  it("hides support help from the root surface when no support email is configured", async () => {
    const rootHelp = await dispatchCli(["help"]);
    const supportHelp = await dispatchCli(["support", "help"]);

    expect(rootHelp.human).not.toContain("SUPPORT");
    expect(rootHelp.human).not.toContain("vivd support request <summary...>");
    expect(supportHelp.human).toContain("Support contact is not configured for this runtime.");
  });

  it("scaffolds and validates local CMS content without a connected runtime", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-cli-cms-"));

    try {
      const modelResult = await dispatchCli(["cms", "scaffold", "model", "products"], tempDir);
      const entryResult = await dispatchCli(
        ["cms", "scaffold", "entry", "products", "alpine-boot"],
        tempDir,
      );
      const validateResult = await dispatchCli(["cms", "validate"], tempDir);

      expect(modelResult.human).toContain("CMS model scaffolded: products");
      expect(entryResult.human).toContain("CMS entry scaffolded: products/alpine-boot");
      expect(validateResult.human).toContain("CMS validate: ok");
      expect(runtime.client.query).not.toHaveBeenCalled();
      expect(runtime.client.mutation).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("installs the CMS binding helper without a connected runtime", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-cli-cms-helper-"));

    try {
      const result = await dispatchCli(["cms", "helper", "install"], tempDir);
      const helperPath = path.join(tempDir, "src", "lib", "cmsBindings.ts");
      const cmsTextPath = path.join(tempDir, "src", "lib", "cms", "CmsText.astro");

      expect(result.human).toContain("CMS preview toolkit installed.");
      await expect(fs.readFile(helperPath, "utf8")).resolves.toContain("data-cms-collection");
      await expect(fs.readFile(cmsTextPath, "utf8")).resolves.toContain("cmsTextBindingAttrs");
      expect(runtime.client.query).not.toHaveBeenCalled();
      expect(runtime.client.mutation).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reports CMS helper freshness without a connected runtime", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-cli-cms-helper-status-"));

    try {
      const missingResult = await dispatchCli(["cms", "helper", "status"], tempDir);

      expect(missingResult.human).toContain("CMS toolkit: missing");
      expect(missingResult.human).toContain("run `vivd cms helper install`");
      expect(missingResult.exitCode).toBe(1);

      await dispatchCli(["cms", "helper", "install"], tempDir);
      const currentResult = await dispatchCli(["cms", "helper", "status"], tempDir);

      expect(currentResult.human).toContain("CMS toolkit: current");
      expect(currentResult.human).toContain("cmsBindings: current");
      expect(currentResult.exitCode).toBe(0);
      expect(runtime.client.query).not.toHaveBeenCalled();
      expect(runtime.client.mutation).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

afterAll(() => {
  if (originalPreviewScreenshotFlag == null) {
    delete process.env.VIVD_CLI_PREVIEW_SCREENSHOT_ENABLED;
  } else {
    process.env.VIVD_CLI_PREVIEW_SCREENSHOT_ENABLED = originalPreviewScreenshotFlag;
  }
});

describe("cli args", () => {
  it("parses command and flags", () => {
    const parsed = parseCliArgs([
      "publish",
      "checklist",
      "update",
      "seo",
      "--json",
      "--slug",
      "demo",
      "--version=4",
      "--domain",
      "demo.example.com",
      "--width",
      "1440",
      "--height=900",
      "--scroll-y",
      "1200",
      "--wait-ms=600",
      "--limit",
      "25",
      "--format",
      "webp",
      "--level",
      "warn",
      "--contains=hydrate",
      "--output",
      ".vivd/dropped-images/preview.webp",
      "--status",
      "pass",
      "--note=ready to ship",
    ]);

    expect(parsed.tokens).toEqual(["publish", "checklist", "update", "seo"]);
    expect(parsed.flags.json).toBe(true);
    expect(parsed.flags.slug).toBe("demo");
    expect(parsed.flags.version).toBe(4);
    expect(parsed.flags.domain).toBe("demo.example.com");
    expect(parsed.flags.width).toBe(1440);
    expect(parsed.flags.height).toBe(900);
    expect(parsed.flags.scrollY).toBe(1200);
    expect(parsed.flags.waitMs).toBe(600);
    expect(parsed.flags.limit).toBe(25);
    expect(parsed.flags.format).toBe("webp");
    expect(parsed.flags.level).toBe("warn");
    expect(parsed.flags.contains).toBe("hydrate");
    expect(parsed.flags.output).toBe(".vivd/dropped-images/preview.webp");
    expect(parsed.flags.status).toBe("pass");
    expect(parsed.flags.note).toBe("ready to ship");
  });

  it("allows stdin as a file flag value", () => {
    const parsed = parseCliArgs(["plugins", "contact", "config", "apply", "--file", "-"]);

    expect(parsed.tokens).toEqual(["plugins", "contact", "config", "apply"]);
    expect(parsed.flags.file).toBe("-");
  });

  it("resolves help topics from leading or trailing help tokens", () => {
    expect(resolveHelpTopic(["help", "plugins", "catalog"])).toEqual(["plugins", "catalog"]);
    expect(resolveHelpTopic(["publish", "checklist", "help"])).toEqual(["publish", "checklist"]);
    expect(resolveHelpTopic(["plugins", "contact", "help"])).toEqual(["plugins", "contact"]);
  });
});
