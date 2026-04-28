import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";

vi.mock("@/components/projects", () => ({
  ProjectsList: () => <div data-testid="projects-list" />,
}));

describe("Dashboard", () => {
  it("uses the framed viewport without owning sidebar state", () => {
    render(<Dashboard />);

    expect(
      screen.getByRole("heading", { name: "Your Projects" }),
    ).toBeInTheDocument();

    const projectsList = screen.getByTestId("projects-list");
    expect(projectsList).toBeInTheDocument();
    expect(projectsList.parentElement).toHaveClass(
      "overflow-auto",
      "px-4",
      "py-3",
    );
    expect(projectsList.parentElement?.parentElement).toHaveClass(
      "rounded-[10px]",
      "border-0",
      "shadow-none",
      "dark:shadow-none",
    );
  });
});
