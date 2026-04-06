import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { StudioStartupLoading } from "./StudioStartupLoading";

describe("StudioStartupLoading", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders a studio-shaped loading shell", () => {
    render(<StudioStartupLoading />);

    expect(
      screen.getByRole("status", { name: "Loading studio" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("studio-startup-chat-panel")).toBeInTheDocument();
    expect(screen.getByTestId("studio-startup-preview-panel")).toBeInTheDocument();
    expect(screen.getByText("Starting studio")).toBeInTheDocument();
    expect(
      screen.getByText("This can take a little longer on first startup."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("studio-startup-spinner")).not.toHaveClass(
      "rounded-full",
      "border",
    );
  });

  it("renders a provided header using existing host chrome", () => {
    render(<StudioStartupLoading header={<div>Projects / site-1</div>} />);

    expect(screen.getByTestId("studio-startup-header")).toBeInTheDocument();
    expect(screen.getByText("Projects / site-1")).toBeInTheDocument();
  });

  it("reuses a stored chat panel width when available", () => {
    window.localStorage.setItem("previewModal.chatPanelWidth", "520");

    render(<StudioStartupLoading />);

    expect(screen.getByTestId("studio-startup-chat-panel")).toHaveStyle({
      width: "520px",
    });
  });

  it("clamps invalid stored chat widths back into the real panel range", () => {
    window.localStorage.setItem("previewModal.chatPanelWidth", "999");

    render(<StudioStartupLoading />);

    expect(screen.getByTestId("studio-startup-chat-panel")).toHaveStyle({
      width: "600px",
    });
  });

  it("supports fullscreen sizing", () => {
    render(<StudioStartupLoading fullScreen />);

    expect(screen.getByTestId("studio-startup-shell")).toHaveClass(
      "h-dvh",
      "w-screen",
    );
  });
});
