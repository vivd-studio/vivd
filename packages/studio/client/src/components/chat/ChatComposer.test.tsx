import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatComposer } from "./ChatComposer";

const { chatContextState } = vi.hoisted(() => ({
  chatContextState: {
    input: "",
    setInput: vi.fn(),
    handleSend: vi.fn(),
    handleStopGeneration: vi.fn(),
    attachedElement: null,
    setAttachedElement: vi.fn(),
    attachedImages: [],
    addAttachedImages: vi.fn(),
    removeAttachedImage: vi.fn(),
    attachedFiles: [],
    removeAttachedFile: vi.fn(),
    followupBehavior: "queue" as const,
    setFollowupBehavior: vi.fn(),
    showSteerButton: false,
    selectorMode: false,
    setSelectorMode: vi.fn(),
    isLoading: false,
    isThinking: true,
    isUsageBlocked: false,
    selectorModeAvailable: false,
    availableModels: [],
    selectedModel: null,
    setSelectedModel: vi.fn(),
    handleSteerSend: vi.fn(),
  },
}));

vi.mock("./ChatContext", () => ({
  useChatContext: () => chatContextState,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuRadioGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuRadioItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
  DropdownMenuShortcut: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./SelectedElementPill", () => ({
  SelectedElementPill: () => null,
  AttachedFilePill: () => null,
}));

vi.mock("./ImagePreviewPill", () => ({
  ImagePreviewPill: () => null,
}));

vi.mock("./ModelSelector", () => ({
  ModelSelector: () => null,
}));

describe("ChatComposer", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    chatContextState.input = "";
    chatContextState.setInput = vi.fn();
    chatContextState.handleSend = vi.fn();
    chatContextState.handleStopGeneration = vi.fn();
    chatContextState.attachedElement = null;
    chatContextState.setAttachedElement = vi.fn();
    chatContextState.attachedImages = [];
    chatContextState.addAttachedImages = vi.fn();
    chatContextState.removeAttachedImage = vi.fn();
    chatContextState.attachedFiles = [];
    chatContextState.removeAttachedFile = vi.fn();
    chatContextState.followupBehavior = "queue";
    chatContextState.setFollowupBehavior = vi.fn();
    chatContextState.showSteerButton = false;
    chatContextState.selectorMode = false;
    chatContextState.setSelectorMode = vi.fn();
    chatContextState.isLoading = false;
    chatContextState.isThinking = true;
    chatContextState.isUsageBlocked = false;
    chatContextState.selectorModeAvailable = false;
    chatContextState.availableModels = [];
    chatContextState.selectedModel = null;
    chatContextState.setSelectedModel = vi.fn();
    chatContextState.handleSteerSend = vi.fn();
  });

  it("exposes an accessible stop-generation control while the agent is running", () => {
    render(<ChatComposer />);

    expect(screen.getByRole("button", { name: "Stop generation" })).toBeTruthy();
  });

  it("uses Cmd+Enter to steer an in-flight session", () => {
    chatContextState.input = "Polish the headline";
    chatContextState.showSteerButton = true;

    render(<ChatComposer />);

    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      metaKey: true,
    });

    expect(chatContextState.handleSteerSend).toHaveBeenCalledOnce();
    expect(chatContextState.handleSend).not.toHaveBeenCalled();
  });

  it("keeps Enter on the regular send path when steer is unavailable", () => {
    chatContextState.input = "Polish the headline";

    render(<ChatComposer />);

    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
    });

    expect(chatContextState.handleSend).toHaveBeenCalledOnce();
    expect(chatContextState.handleSteerSend).not.toHaveBeenCalled();
  });
});
