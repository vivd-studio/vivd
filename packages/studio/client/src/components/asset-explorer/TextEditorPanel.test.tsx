import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme";
import { TextEditorPanel } from "./TextEditorPanel";

const codeMirrorMock = vi.fn(
  ({
    theme,
    value,
  }: {
    theme: string;
    value: string;
  }) => (
    <div data-testid="code-editor" data-theme={theme}>
      {value}
    </div>
  )
);

vi.mock("@/lib/trpc", () => ({
  trpc: {
    assets: {
      readTextFile: {
        useQuery: () => ({
          data: { content: "<h1>Hello</h1>" },
          isLoading: false,
          error: null,
        }),
      },
      saveTextFile: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("@/components/chat/ChatContext", () => ({
  useOptionalChatContext: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@uiw/react-codemirror", () => ({
  default: (props: { theme: string; value: string }) => codeMirrorMock(props),
}));

describe("TextEditorPanel", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.className = "";
    codeMirrorMock.mockClear();
  });

  it("uses the resolved light theme for the assets editor", () => {
    render(
      <ThemeProvider defaultTheme="light">
        <TextEditorPanel
          projectSlug="demo-project"
          version={1}
          filePath="src/index.html"
          onClose={vi.fn()}
        />
      </ThemeProvider>
    );

    expect(screen.getByTestId("code-editor")).toHaveAttribute(
      "data-theme",
      "light"
    );
    expect(
      codeMirrorMock.mock.calls.some(([props]) => props.theme === "light")
    ).toBe(true);
  });
});
