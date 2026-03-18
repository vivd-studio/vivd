import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserBar } from "./BrowserBar";

describe("BrowserBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("submits route changes through the browser bar input", () => {
    const onNavigatePath = vi.fn();

    render(
      <BrowserBar
        viewportMode="desktop"
        setViewportMode={vi.fn()}
        currentPreviewPath="/login"
        onNavigatePath={onNavigatePath}
        onRefresh={vi.fn()}
      />,
    );

    const input = screen.getByDisplayValue("/login");
    fireEvent.change(input, { target: { value: "settings?tab=billing" } });
    fireEvent.submit(input.closest("form")!);

    expect(onNavigatePath).toHaveBeenCalledWith("settings?tab=billing");
  });

  it("updates viewport mode, refreshes the current route, and rehydrates the input from route changes", () => {
    const setViewportMode = vi.fn();
    const onRefresh = vi.fn();
    const { rerender } = render(
      <BrowserBar
        viewportMode="desktop"
        setViewportMode={setViewportMode}
        currentPreviewPath="/"
        onNavigatePath={vi.fn()}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /switch viewport/i }));
    fireEvent.click(screen.getByRole("button", { name: /refresh preview/i }));

    expect(setViewportMode).toHaveBeenCalledWith("tablet");
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <BrowserBar
        viewportMode="desktop"
        setViewportMode={setViewportMode}
        currentPreviewPath="/pricing?annual=1"
        onNavigatePath={vi.fn()}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByDisplayValue("/pricing?annual=1")).toBeInTheDocument();
  });
});
