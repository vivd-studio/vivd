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
    expect(prompt).toContain("Redirects for migrated URLs");
    expect(prompt).toContain("User messages may contain `<vivd-internal ... />`");
    expect(prompt).toContain("Prefer plugin-backed solutions over custom implementations");
  });
});
