import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./theme-provider";

type MatchMediaController = {
  setMatches: (matches: boolean) => void;
};

function installMatchMedia(initialMatches: boolean): MatchMediaController {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      get matches() {
        return matches;
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (
        _: string,
        listener: (event: MediaQueryListEvent) => void
      ) => {
        listeners.delete(listener);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => true,
    })),
  });

  return {
    setMatches(nextMatches) {
      matches = nextMatches;
      const event = { matches } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function ThemeProbe() {
  const { theme, resolvedTheme, colorTheme } = useTheme();

  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <span data-testid="color-theme">{colorTheme}</span>
    </div>
  );
}

describe("ThemeProvider", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-color-theme");
    window.history.replaceState({}, "", "/");
  });

  it("resolves system theme and reacts to system preference changes", () => {
    const matchMedia = installMatchMedia(false);

    render(
      <ThemeProvider defaultTheme="system">
        <ThemeProbe />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement).not.toHaveClass("dark");

    act(() => {
      matchMedia.setMatches(true);
    });

    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).not.toHaveClass("light");
  });

  it("normalizes deprecated color theme values from the URL back to vivd-sharp", () => {
    installMatchMedia(false);
    window.history.replaceState({}, "", "/?colorTheme=aurora");

    render(
      <ThemeProvider defaultTheme="light">
        <ThemeProbe />
      </ThemeProvider>
    );

    expect(screen.getByTestId("color-theme")).toHaveTextContent("vivd-sharp");
    expect(document.documentElement).toHaveAttribute("data-color-theme", "vivd-sharp");
    expect(localStorage.getItem("vite-ui-color-theme")).toBe("vivd-sharp");
  });
});
