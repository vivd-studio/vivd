import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPreviewRepairPrompt,
  PreviewDevServerErrorPanel,
} from "./PreviewDevServerErrorPanel";

const mocks = vi.hoisted(() => ({
  handleNewSessionMock: vi.fn(),
  setInputMock: vi.fn(),
  copyTextWithFallbackMock: vi.fn(() => Promise.resolve()),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  setChatOpenMock: vi.fn(),
  chatContext: {
    input: "",
    handleNewSession: vi.fn(),
    setInput: vi.fn(),
  } as {
    input: string;
    handleNewSession: ReturnType<typeof vi.fn>;
    setInput: ReturnType<typeof vi.fn>;
  } | null,
}));

vi.mock("../chat/ChatContext", () => ({
  useOptionalChatContext: () => mocks.chatContext,
}));

vi.mock("@/lib/browserActions", () => ({
  copyTextWithFallback: mocks.copyTextWithFallbackMock,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccessMock,
    error: mocks.toastErrorMock,
    info: mocks.toastInfoMock,
  },
}));

function renderPanel() {
  return render(
    <PreviewDevServerErrorPanel
      projectSlug="demo"
      version={3}
      devServerError={"npm error code ERESOLVE\npeer astro@^5"}
      restartPending={false}
      setChatOpen={mocks.setChatOpenMock}
      onRestart={vi.fn()}
      onCleanReinstall={vi.fn()}
    />,
  );
}

describe("PreviewDevServerErrorPanel", () => {
  beforeEach(() => {
    mocks.handleNewSessionMock.mockReset();
    mocks.setInputMock.mockReset();
    mocks.copyTextWithFallbackMock.mockReset();
    mocks.copyTextWithFallbackMock.mockResolvedValue(undefined);
    mocks.toastSuccessMock.mockReset();
    mocks.toastErrorMock.mockReset();
    mocks.toastInfoMock.mockReset();
    mocks.setChatOpenMock.mockReset();
    mocks.chatContext = {
      input: "",
      handleNewSession: mocks.handleNewSessionMock,
      setInput: mocks.setInputMock,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("builds a repair prompt with project scope and runtime error details", () => {
    expect(
      buildPreviewRepairPrompt({
        projectSlug: "demo",
        version: 3,
        devServerError: "npm error code ERESOLVE",
      }),
    ).toContain("Project: demo (v3)");

    expect(
      buildPreviewRepairPrompt({
        projectSlug: "demo",
        version: 3,
        devServerError: "npm error code ERESOLVE",
      }),
    ).toContain("Runtime error:\n\nnpm error code ERESOLVE");
  });

  it("opens a clean agent composer with a repair prompt when no draft is present", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Ask agent to fix it" }));

    await waitFor(() => {
      expect(mocks.setChatOpenMock).toHaveBeenCalledWith(true);
      expect(mocks.handleNewSessionMock).toHaveBeenCalledOnce();
      expect(mocks.setInputMock).toHaveBeenCalledWith(
        expect.stringContaining("The Studio preview failed to start"),
      );
      expect(mocks.copyTextWithFallbackMock).not.toHaveBeenCalled();
      expect(mocks.toastSuccessMock).toHaveBeenCalledWith(
        "Opened the agent with a repair prompt",
      );
    });
  });

  it("copies the prompt instead of overwriting an existing chat draft", async () => {
    mocks.chatContext = {
      input: "keep this draft",
      handleNewSession: mocks.handleNewSessionMock,
      setInput: mocks.setInputMock,
    };

    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Ask agent to fix it" }));

    await waitFor(() => {
      expect(mocks.setChatOpenMock).toHaveBeenCalledWith(true);
      expect(mocks.copyTextWithFallbackMock).toHaveBeenCalledWith(
        expect.stringContaining("Project: demo (v3)"),
      );
      expect(mocks.handleNewSessionMock).not.toHaveBeenCalled();
      expect(mocks.setInputMock).not.toHaveBeenCalled();
      expect(mocks.toastInfoMock).toHaveBeenCalledWith(
        "Opened the agent and copied the repair prompt so your existing draft stays intact.",
      );
    });
  });

  it("copies the prompt manually from the dedicated action", async () => {
    renderPanel();

    expect(screen.queryByText("npm error code ERESOLVE")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show technical details" }));
    expect(screen.getByText(/npm error code ERESOLVE/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy message for agent" }));

    await waitFor(() => {
      expect(mocks.copyTextWithFallbackMock).toHaveBeenCalledWith(
        expect.stringContaining("Runtime error:"),
      );
      expect(mocks.toastSuccessMock).toHaveBeenCalledWith(
        "Copied prompt for agent",
      );
    });
  });
});
