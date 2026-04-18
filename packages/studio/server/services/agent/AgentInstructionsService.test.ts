import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isConnectedModeMock,
  getConnectedBackendAuthConfigMock,
} = vi.hoisted(() => ({
  isConnectedModeMock: vi.fn(),
  getConnectedBackendAuthConfigMock: vi.fn(),
}));

vi.mock("@vivd/shared", () => ({
  isConnectedMode: isConnectedModeMock,
}));

vi.mock("../../lib/connectedBackendAuth.js", () => ({
  buildConnectedBackendHeaders: vi.fn(),
  getConnectedBackendAuthConfig: getConnectedBackendAuthConfigMock,
}));

import { agentInstructionsService } from "./AgentInstructionsService.js";

describe("studio AgentInstructionsService fallback", () => {
  beforeEach(() => {
    isConnectedModeMock.mockReset();
    getConnectedBackendAuthConfigMock.mockReset();
    isConnectedModeMock.mockReturnValue(false);
    getConnectedBackendAuthConfigMock.mockReturnValue(null);
    delete process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL;
    delete process.env.VIVD_ENABLED_PLUGINS;
  });

  it("reuses the shared default prompt shape for fallback mode", async () => {
    process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL = "support@vivd.studio";
    process.env.VIVD_ENABLED_PLUGINS = "newsletter";
    const prompt = await agentInstructionsService.getSystemPromptForSessionStart({
      projectSlug: "demo-project",
      projectVersion: 1,
    });

    expect(prompt).toContain("Non-technical users");
    expect(prompt).toContain(
      "Before starting meaningful work, resolve material uncertainty with focused clarifying questions.",
    );
    expect(prompt).toContain(
      "Prefer using the question tool over guessing, and when in doubt, ask rather than assume.",
    );
    expect(prompt).toContain("Proper error handling");
    expect(prompt).toContain("Multi-language support");
    expect(prompt).toContain(".vivd/uploads/");
    expect(prompt).toContain(".vivd/dropped-images/");
    expect(prompt).toContain("Treat both as working material");
    expect(prompt).toContain("`src/content/media/` by default");
    expect(prompt).toContain("Use `public/` only for passthrough files");
    expect(prompt).toContain("Structured CMS content");
    expect(prompt).toContain("src/content.config.ts");
    expect(prompt).toContain("Do not invent or reintroduce a parallel Vivd YAML schema contract");
    expect(prompt).toContain("Vivd adapts to Astro Content Collections internally");
    expect(prompt).toContain("default to Astro's `Image` component");
    expect(prompt).toContain("does not create CMS preview ownership");
    expect(prompt).toContain("Derived or reformatted render points");
    expect(prompt).toContain("src={entry.data.image}");
    expect(prompt).toContain("Astro-relative path such as `../media/...`");
    expect(prompt).toContain("explicit emoji fallbacks such as `Apple Color Emoji`");
    expect(prompt).toContain("Before finishing a CMS-heavy generation or refactor");
    expect(prompt).toContain("Do not point page markup at raw filesystem-like `src/content/media/...` paths");
    expect(prompt).toContain("vivd cms validate");
    expect(prompt).toContain("Redirects for migrated URLs");
    expect(prompt).toContain("Tool Usage Contract");
    expect(prompt).toContain(
      "Never print pseudo tool-call text such as `[tool_call: ...]`",
    );
    expect(prompt).toContain(
      "If the user drops an image or preview screenshot and you need to inspect its visual content, you must use the read tool on that path first; otherwise you have not actually seen the image.",
    );
    expect(prompt).toContain("User messages may contain `<vivd-internal ... />`");
    expect(prompt).toContain(
      "the tag and path alone do not put the attachment into model context",
    );
    expect(prompt).toContain("Prefer plugin-backed solutions over custom implementations");
    expect(prompt).toContain("Plugin-specific notes");
    expect(prompt).toContain(
      "Newsletter / Waitlist: Set `mode=waitlist` before generating snippets when the user asked for a waitlist.",
    );
    expect(prompt).toContain("vivd support request ...");
    expect(prompt).toContain(
      "You must ask for explicit user permission before using the support command or contacting Vivd support on the user's behalf.",
    );
  });

  it("falls back to shared CLI instructions when connected mode is available but backend fetch fails", async () => {
    process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL = "support@vivd.studio";
    isConnectedModeMock.mockReturnValue(true);
    getConnectedBackendAuthConfigMock.mockReturnValue({
      backendUrl: "https://backend.example.test",
      studioId: "studio_1",
      studioAccessToken: "token_1",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network failed")) as unknown as typeof fetch,
    );

    try {
      const prompt = await agentInstructionsService.getSystemPromptForSessionStart({
        projectSlug: "demo-project",
        projectVersion: 1,
      });

      expect(prompt).toContain("Start CLI discovery with `vivd --help`.");
      expect(prompt).toContain("USAGE");
      expect(prompt).toContain("DISCOVER MORE");
      expect(prompt).toContain("vivd plugins catalog");
      expect(prompt).toContain("vivd plugins snippets <pluginId> [snippetName]");
      expect(prompt).toContain("vivd publish targets");
      expect(prompt).toContain("vivd publish prepare");
      expect(prompt).toContain("vivd publish checklist show");
      expect(prompt).toContain("vivd support request <summary...>");
      expect(prompt).toContain(
        "Treat preview/runtime, plugin, publish/checklist, and other platform-state requests as `vivd` CLI work first, not file-search work.",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps support-command guidance when fallback mode resolves support contact from the backend", async () => {
    isConnectedModeMock.mockReturnValue(true);
    getConnectedBackendAuthConfigMock.mockReturnValue({
      backendUrl: "https://backend.example.test",
      studioId: "studio_1",
      studioAccessToken: "token_1",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                supportEmail: "support@vivd.studio",
              },
            },
          },
        }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const prompt = await agentInstructionsService.getSystemPromptForSessionStart({
        projectSlug: "demo-project",
        projectVersion: 1,
      });

      expect(prompt).toContain("vivd support request <summary...>");
      expect(prompt).toContain(
        "You must ask for explicit user permission before using the support command or contacting Vivd support on the user's behalf.",
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://backend.example.test/api/trpc/studioApi.getSupportContact?input=%7B%22studioId%22%3A%22studio_1%22%7D",
        expect.objectContaining({
          method: "GET",
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits support-command guidance when support email is not configured", async () => {
    const prompt = await agentInstructionsService.getSystemPromptForSessionStart({
      projectSlug: "demo-project",
      projectVersion: 1,
    });

    expect(prompt).not.toContain("vivd support request");
    expect(prompt).not.toContain(
      "contacting Vivd support on the user's behalf",
    );
  });
});
