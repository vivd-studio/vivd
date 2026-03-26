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

  it("mentions explorer uploads and chat-dropped images under .vivd", async () => {
    const prompt = await agentInstructionsService.getSystemPromptForSessionStart({
      projectSlug: "demo-project",
      projectVersion: 1,
    });

    expect(prompt).toContain(".vivd/uploads/");
    expect(prompt).toContain(".vivd/dropped-images/");
    expect(prompt).toContain("Treat both as working material");
  });
});
