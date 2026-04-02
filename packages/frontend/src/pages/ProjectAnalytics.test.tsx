import { render, screen, within } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  analyticsEnsureMutateMock,
  useParamsMock,
  analyticsEnsureUseMutationMock,
  analyticsInfoUseQueryMock,
  analyticsSummaryUseQueryMock,
  projectListUseQueryMock,
  useUtilsMock,
} =
  vi.hoisted(() => ({
    analyticsEnsureMutateMock: vi.fn(),
    useParamsMock: vi.fn(),
    analyticsEnsureUseMutationMock: vi.fn(),
    analyticsInfoUseQueryMock: vi.fn(),
    analyticsSummaryUseQueryMock: vi.fn(),
    projectListUseQueryMock: vi.fn(),
    useUtilsMock: vi.fn(),
  }));
const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
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
    useUtils: useUtilsMock,
    plugins: {
      analyticsEnsure: {
        useMutation: analyticsEnsureUseMutationMock,
      },
      analyticsInfo: {
        useQuery: analyticsInfoUseQueryMock,
      },
      analyticsSummary: {
        useQuery: analyticsSummaryUseQueryMock,
      },
    },
    project: {
      list: {
        useQuery: projectListUseQueryMock,
      },
    },
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: useSessionMock,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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
    comparison: {
      previousRangeStart: "2026-01-02",
      previousRangeEnd: "2026-01-31",
      totals: {
        pageviews: { current: 666, previous: 333, delta: 333, deltaPct: 100 },
        uniqueVisitors: { current: 444, previous: 222, delta: 222, deltaPct: 100 },
        uniqueSessions: { current: 555, previous: 278, delta: 277, deltaPct: 99.6 },
        submissions: { current: 10, previous: 5, delta: 5, deltaPct: 100 },
        conversionRatePct: { current: 1, previous: 0.8, delta: 0.2, deltaPct: 25 },
      },
    },
    funnel: {
      pageviews: 666,
      formViews: 120,
      formStarts: 55,
      submissions: 10,
      steps: [
        {
          key: "pageviews",
          label: "Pageviews",
          count: 666,
          conversionFromPreviousPct: 100,
          conversionFromFirstPct: 100,
        },
        {
          key: "formViews",
          label: "Form views",
          count: 120,
          conversionFromPreviousPct: 18,
          conversionFromFirstPct: 18,
        },
        {
          key: "formStarts",
          label: "Form starts",
          count: 55,
          conversionFromPreviousPct: 45.8,
          conversionFromFirstPct: 8.2,
        },
        {
          key: "submissions",
          label: "Submissions",
          count: 10,
          conversionFromPreviousPct: 18.2,
          conversionFromFirstPct: 1.5,
        },
      ],
    },
    attribution: {
      campaigns: [
        {
          utmSource: "google",
          utmMedium: "cpc",
          utmCampaign: "spring_launch",
          pageviews: 80,
          submissions: 4,
          submissionRatePct: 5,
        },
      ],
      sources: [
        {
          utmSource: "google",
          pageviews: 80,
          submissions: 4,
          submissionRatePct: 5,
        },
      ],
    },
  };
}

describe("ProjectAnalytics", () => {
  beforeEach(() => {
    analyticsEnsureMutateMock.mockReset();
    useParamsMock.mockReset();
    analyticsEnsureUseMutationMock.mockReset();
    analyticsInfoUseQueryMock.mockReset();
    analyticsSummaryUseQueryMock.mockReset();
    projectListUseQueryMock.mockReset();
    useUtilsMock.mockReset();
    useSessionMock.mockReset();

    useParamsMock.mockReturnValue({ projectSlug: "leonord" });
    analyticsEnsureUseMutationMock.mockReturnValue({
      mutate: analyticsEnsureMutateMock,
      isPending: false,
    });
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
    projectListUseQueryMock.mockReturnValue({
      data: {
        projects: [{ slug: "leonord", title: "Leonord" }],
      },
    });
    useUtilsMock.mockReturnValue({
      plugins: {
        analyticsInfo: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: "super_admin",
        },
      },
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
    expect(screen.getByText("Period comparison")).toBeInTheDocument();
    expect(screen.getByText("Conversion funnel")).toBeInTheDocument();
    expect(screen.getByText("UTM campaign attribution")).toBeInTheDocument();
    expect(screen.getByText("Daily performance")).toBeInTheDocument();
    expect(screen.getByText("Top pages")).toBeInTheDocument();
    expect(screen.getByText("Lead sources")).toBeInTheDocument();
  });

  it("offers project enablement when analytics is entitled but not initialized yet", () => {
    analyticsInfoUseQueryMock.mockReturnValueOnce({
      data: {
        entitled: true,
        enabled: false,
        instanceId: null,
      },
      error: null,
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <MemoryRouter>
        <ProjectAnalytics />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "Analytics is available for this instance but has not been enabled for this project yet.",
      ),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "Enable for this project" }).click();
    expect(analyticsEnsureMutateMock).toHaveBeenCalledWith({ slug: "leonord" });
    expect(
      screen.queryByText("Analytics is disabled for this instance. Open Instance Settings -> Plugins to enable it."),
    ).not.toBeInTheDocument();
  });
});
