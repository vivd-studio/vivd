import { render, screen, within } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useParamsMock, analyticsInfoUseQueryMock, analyticsSummaryUseQueryMock } =
  vi.hoisted(() => ({
    useParamsMock: vi.fn(),
    analyticsInfoUseQueryMock: vi.fn(),
    analyticsSummaryUseQueryMock: vi.fn(),
  }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useParams: useParamsMock,
  };
});

vi.mock("@/components/settings/SettingsPageShell", () => ({
  SettingsPageShell: ({
    title,
    description,
    actions,
    children,
  }: {
    title: string;
    description: string;
    actions: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    plugins: {
      analyticsInfo: {
        useQuery: analyticsInfoUseQueryMock,
      },
      analyticsSummary: {
        useQuery: analyticsSummaryUseQueryMock,
      },
    },
  },
}));

import ProjectAnalytics from "./ProjectAnalytics";

function makeSummary() {
  return {
    pluginId: "analytics",
    enabled: true,
    rangeDays: 30 as const,
    rangeStart: "2026-02-01",
    rangeEnd: "2026-02-22",
    totals: {
      events: 1111,
      pageviews: 666,
      uniqueVisitors: 444,
      uniqueSessions: 555,
      avgPagesPerSession: 1.2,
    },
    daily: [
      {
        date: "2026-02-20",
        events: 100,
        pageviews: 100,
        uniqueVisitors: 80,
        uniqueSessions: 90,
      },
      {
        date: "2026-02-21",
        events: 200,
        pageviews: 200,
        uniqueVisitors: 150,
        uniqueSessions: 170,
      },
      {
        date: "2026-02-22",
        events: 900,
        pageviews: 999,
        uniqueVisitors: 600,
        uniqueSessions: 650,
      },
    ],
    topPages: [
      {
        path: "/",
        pageviews: 222,
        uniqueVisitors: 180,
      },
    ],
    topReferrers: [
      {
        referrerHost: "google.com",
        events: 321,
      },
    ],
    devices: [
      {
        deviceType: "desktop",
        events: 700,
        share: 70,
      },
    ],
    contactForm: {
      enabled: true,
      submissions: 10,
      uniqueSourceHosts: 2,
      conversionRatePct: 1,
      daily: [
        { date: "2026-02-20", submissions: 1 },
        { date: "2026-02-21", submissions: 2 },
        { date: "2026-02-22", submissions: 7 },
      ],
      topSourceHosts: [
        {
          sourceHost: "example.com",
          submissions: 7,
        },
      ],
    },
  };
}

describe("ProjectAnalytics", () => {
  beforeEach(() => {
    useParamsMock.mockReset();
    analyticsInfoUseQueryMock.mockReset();
    analyticsSummaryUseQueryMock.mockReset();

    useParamsMock.mockReturnValue({ projectSlug: "leonord" });
    analyticsInfoUseQueryMock.mockReturnValue({
      data: { enabled: true },
      error: null,
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    analyticsSummaryUseQueryMock.mockReturnValue({
      data: makeSummary(),
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("shows latest day first in the daily performance table", () => {
    render(
      <MemoryRouter>
        <ProjectAnalytics />
      </MemoryRouter>,
    );

    const dailyTable = screen
      .getByRole("columnheader", { name: "Traffic vs peak" })
      .closest("table");
    expect(dailyTable).not.toBeNull();

    const rows = within(dailyTable as HTMLTableElement).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("999");
  });

  it("renders the reorganized analytics sections", () => {
    render(
      <MemoryRouter>
        <ProjectAnalytics />
      </MemoryRouter>,
    );

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Daily performance")).toBeInTheDocument();
    expect(screen.getByText("Top pages")).toBeInTheDocument();
    expect(screen.getByText("Lead sources")).toBeInTheDocument();
  });
});
