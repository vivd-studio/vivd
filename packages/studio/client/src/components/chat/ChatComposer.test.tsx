import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachedImage } from "./chatTypes";
import { ChatComposer } from "./ChatComposer";

const { chatContextState, toastInfoMock } = vi.hoisted(() => ({
  chatContextState: {
    input: "",
    setInput: vi.fn(),
    handleSend: vi.fn(),
    handleStopGeneration: vi.fn(),
    attachedElement: null,
    setAttachedElement: vi.fn(),
    attachedImages: [] as AttachedImage[],
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
  toastInfoMock: vi.fn(),
}));

vi.mock("./ChatContext", () => ({
  useChatContext: () => chatContextState,
}));

vi.mock("sonner", () => ({
  toast: {
    info: toastInfoMock,
  },
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
    toastInfoMock.mockReset();
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

  it("limits newly queued dropped files to the shared chat attachment cap", () => {
    chatContextState.attachedImages = Array.from({ length: 8 }, (_, index) => ({
      file: new File([`existing-${index}`], `existing-${index}.txt`, {
        type: "text/plain",
      }),
      previewUrl: "",
      tempId: `existing-${index}`,
    }));

    render(<ChatComposer />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (!input) {
      throw new Error("Expected hidden file input");
    }

    const files = Array.from({ length: 5 }, (_, index) =>
      new File([`new-${index}`], `new-${index}.txt`, { type: "text/plain" }),
    );

    fireEvent.change(input, { target: { files } });

    expect(chatContextState.addAttachedImages).toHaveBeenCalledTimes(1);
    const attachedBatch = (
      chatContextState.addAttachedImages as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    expect(attachedBatch).toHaveLength(2);
    expect(attachedBatch[0]).toEqual(expect.objectContaining({ file: files[0] }));
    expect(attachedBatch[1]).toEqual(expect.objectContaining({ file: files[1] }));
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
  });
});
