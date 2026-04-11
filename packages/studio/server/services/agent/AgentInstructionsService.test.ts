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
  });

  it("reuses the shared default prompt shape for fallback mode", async () => {
    const prompt = await agentInstructionsService.getSystemPromptForSessionStart({
      projectSlug: "demo-project",
      projectVersion: 1,
    });

    expect(prompt).toContain("Non-technical users");
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
    expect(prompt).toContain("Do not point page markup at raw filesystem-like `src/content/media/...` paths");
    expect(prompt).toContain("vivd cms validate");
    expect(prompt).toContain("Redirects for migrated URLs");
    expect(prompt).toContain("Tool Usage Contract");
    expect(prompt).toContain(
      "Never print pseudo tool-call text such as `[tool_call: ...]`",
    );
    expect(prompt).toContain("User messages may contain `<vivd-internal ... />`");
    expect(prompt).toContain("Prefer plugin-backed solutions over custom implementations");
    expect(prompt).toContain("vivd support request ...");
    expect(prompt).toContain(
      "You must ask for explicit user permission before using the support command or contacting Vivd support on the user's behalf.",
    );
  });

  it("falls back to shared CLI instructions when connected mode is available but backend fetch fails", async () => {
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
      expect(prompt).toContain("vivd publish checklist show");
      expect(prompt).toContain("vivd support request <summary...>");
      expect(prompt).toContain(
        "Treat preview/runtime, plugin, publish/checklist, and other platform-state requests as `vivd` CLI work first, not file-search work.",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
