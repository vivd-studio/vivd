import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionList } from "./SessionList";

const mockUseOpencodeSessionActivity = vi.fn();

vi.mock("@/features/opencodeChat", () => ({
  useOpencodeSessionActivity: () => mockUseOpencodeSessionActivity(),
}));

describe("SessionList", () => {
  beforeEach(() => {
    mockUseOpencodeSessionActivity.mockReset();
    mockUseOpencodeSessionActivity.mockReturnValue({
      selectedSessionId: "session-1",
      activeSessionIds: [],
      selectedSessionIsActive: false,
      otherActiveSessionIds: [],
      otherActiveSessionCount: 0,
      hasAnyActiveSession: false,
      hasOtherActiveSessions: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a subtle activity indicator only on active sessions", () => {
    mockUseOpencodeSessionActivity.mockReturnValue({
      selectedSessionId: "session-1",
      activeSessionIds: ["session-1"],
      selectedSessionIsActive: true,
      otherActiveSessionIds: [],
      otherActiveSessionCount: 0,
      hasAnyActiveSession: true,
      hasOtherActiveSessions: false,
    });

    render(
      <SessionList
        sessions={[
          {
            id: "session-1",
            title: "Refresh hero",
            time: { updated: Date.UTC(2026, 2, 19, 16, 45) },
          },
          {
            id: "session-2",
            title: "Tune mobile layout",
            time: { updated: Date.UTC(2026, 2, 19, 15, 20) },
          },
        ]}
        sessionsLoading={false}
        selectedSessionId="session-1"
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("session-activity-indicator-session-1"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("session-row-session-1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("session-activity-indicator-session-2"),
    ).not.toBeInTheDocument();
  });

  it("keeps the existing selected styling when the selected session is active", () => {
    mockUseOpencodeSessionActivity.mockReturnValue({
      selectedSessionId: "session-1",
      activeSessionIds: ["session-1"],
      selectedSessionIsActive: true,
      otherActiveSessionIds: [],
      otherActiveSessionCount: 0,
      hasAnyActiveSession: true,
      hasOtherActiveSessions: false,
    });

    render(
      <SessionList
        sessions={[
          {
            id: "session-1",
            title: "Refresh hero",
            time: { updated: Date.UTC(2026, 2, 19, 16, 45) },
          },
        ]}
        sessionsLoading={false}
        selectedSessionId="session-1"
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Refresh hero (session-1)")).toHaveClass(
      "border-primary/25",
      "bg-primary/8",
    );
    expect(
      screen.getByTestId("session-activity-indicator-session-1"),
    ).toBeInTheDocument();
  });
});
