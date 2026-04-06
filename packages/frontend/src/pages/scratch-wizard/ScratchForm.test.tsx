import { render, screen } from "@testing-library/react";
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
      submit: vi.fn(),
    });
  });

  it("renders the simplified brief-first scratch flow with a friendly optional reference-url prompt", () => {
    render(<ScratchForm />);

    expect(screen.getByText("Project name")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/describe the website you want to create/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Design references")).toBeInTheDocument();
    expect(screen.getByText("Brand assets")).toBeInTheDocument();
    expect(screen.getByText("Inspiration only")).toBeInTheDocument();
    expect(screen.getByText("Websites you like")).toBeInTheDocument();
    expect(
      screen.getByText(/paste a few urls with design ideas you want us to use as inspiration/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/files to be used on the page/i),
    ).toBeInTheDocument();

    expect(screen.queryByText("Business type")).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("keeps the main heading dark-mode agnostic in markup", () => {
    render(<ScratchForm />);

    expect(screen.getByRole("heading", { name: "What should we build?" })).toBeInTheDocument();
  });
});
