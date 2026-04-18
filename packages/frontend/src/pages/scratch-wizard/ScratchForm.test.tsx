import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@vivd/ui";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { useScratchWizardMock } = vi.hoisted(() => ({
  useScratchWizardMock: vi.fn(),
}));

vi.mock("./ScratchWizardContext", () => ({
  useScratchWizard: useScratchWizardMock,
}));

import { ScratchForm } from "./ScratchForm";

function createFormMock() {
  return {
    register: vi.fn((name: string) => ({
      name,
      onChange: vi.fn(),
      onBlur: vi.fn(),
      ref: vi.fn(),
    })),
    handleSubmit:
      (callback: (values: Record<string, unknown>) => Promise<void> | void) =>
      (event?: { preventDefault?: () => void }) => {
        event?.preventDefault?.();
        return callback({
          title: "Acme Studio",
          description: "A polished brand site for a creative studio.",
        });
      },
    formState: {
      errors: {},
    },
    watch: vi.fn(() => ""),
  };
}

describe("ScratchForm", () => {
  beforeEach(() => {
    useScratchWizardMock.mockReset();
    useScratchWizardMock.mockReturnValue({
      form: createFormMock(),
      assets: [],
      setAssets: vi.fn(),
      referenceImages: [],
      setReferenceImages: vi.fn(),
      started: undefined,
      statusData: undefined,
      isGenerating: false,
      progress: 0,
      uploadPhase: "idle",
      uploadProgress: {
        uploadedBytes: 0,
        totalBytes: 0,
        uploadedFiles: 0,
        totalFiles: 0,
      },
      validationError: null,
      availableModels: [
        {
          tier: "standard",
          provider: "openrouter",
          modelId: "openai/gpt-5.4-mini",
          label: "Standard",
        },
      ],
      selectedModel: {
        tier: "standard",
        provider: "openrouter",
        modelId: "openai/gpt-5.4-mini",
        label: "Standard",
      },
      setSelectedModel: vi.fn(),
      submit: vi.fn(),
    });
  });

  it("renders the prompt-first scratch flow with inline attachment controls", () => {
    render(<TooltipProvider><ScratchForm /></TooltipProvider>);

    expect(screen.getByText("Project name")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/describe the website you want to create/i),
    ).toBeInTheDocument();
    // Attachment menu button (paperclip)
    expect(
      screen.getByRole("button", { name: /attach files/i }),
    ).toBeInTheDocument();
    // Reference URLs toggle (link icon)
    expect(
      screen.getByRole("button", { name: /add reference urls/i }),
    ).toBeInTheDocument();
    // Model selector
    expect(
      screen.getByRole("button", { name: /select initial generation model/i }),
    ).toBeInTheDocument();

    // Old separate sections should NOT exist
    expect(screen.queryByText("Design references")).not.toBeInTheDocument();
    expect(screen.queryByText("Websites you like")).not.toBeInTheDocument();
    expect(screen.queryByText("Business type")).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("keeps the main heading dark-mode agnostic in markup", () => {
    render(<TooltipProvider><ScratchForm /></TooltipProvider>);

    expect(
      screen.getByRole("heading", { name: "What should we build?" }),
    ).toBeInTheDocument();
  });
});
