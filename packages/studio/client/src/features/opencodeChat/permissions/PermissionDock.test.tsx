import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PermissionDock } from "./PermissionDock";

describe("PermissionDock", () => {
  it("shows a translated approval title and hides raw commands by default", () => {
    render(
      <PermissionDock
        request={{
          id: "perm-1",
          sessionID: "session-1",
          permission: "bash",
          patterns: ["vivd publish deploy --domain example.com"],
          always: [],
          metadata: {},
        }}
        onRespond={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("Deploy to example.com")).toBeInTheDocument();
    expect(
      screen.getByText("vivd publish deploy --domain example.com"),
    ).not.toBeVisible();

    fireEvent.click(screen.getByText("Technical details"));

    expect(
      screen.getByText("vivd publish deploy --domain example.com"),
    ).toBeVisible();
  });
});
