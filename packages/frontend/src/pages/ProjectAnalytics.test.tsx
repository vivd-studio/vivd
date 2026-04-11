import { fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  analyticsEnsureMutateMock,
  useParamsMock,
  analyticsEnsureUseMutationMock,
  analyticsInfoUseQueryMock,
  pluginReadUseQueryMock,
  catalogInvalidateMock,
  infoInvalidateMock,
  projectListUseQueryMock,
  useUtilsMock,
} = vi.hoisted(() => ({
  analyticsEnsureMutateMock: vi.fn(),
  useParamsMock: vi.fn(),
  analyticsEnsureUseMutationMock: vi.fn(),
  analyticsInfoUseQueryMock: vi.fn(),
  pluginReadUseQueryMock: vi.fn(),
  catalogInvalidateMock: vi.fn(),
  infoInvalidateMock: vi.fn(),
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
      ensure: {
        useMutation: analyticsEnsureUseMutationMock,
      },
      info: {
        useQuery: analyticsInfoUseQueryMock,
      },
      read: {
        useQuery: pluginReadUseQueryMock,
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
    countries: [
      {
        countryCode: "DE",
        pageviews: 222,
        uniqueVisitors: 180,
        uniqueSessions: 190,
        share: 33.3,
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
    pathAnalysis: {
      sessionsWithPageviews: 120,
      totalTransitions: 140,
      topEntryPages: [
        {
          path: "/",
          sessions: 80,
          share: 66.7,
        },
      ],
      topExitPages: [
        {
          path: "/contact",
          sessions: 45,
          share: 37.5,
        },
      ],
      topTransitions: [
        {
          fromPath: "/",
          toPath: "/pricing",
          transitions: 22,
          uniqueSessions: 20,
          share: 15.7,
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
    pluginReadUseQueryMock.mockReset();
    catalogInvalidateMock.mockReset();
    infoInvalidateMock.mockReset();
    projectListUseQueryMock.mockReset();
    useUtilsMock.mockReset();
    useSessionMock.mockReset();

    useParamsMock.mockReturnValue({ projectSlug: "leonord" });
    analyticsEnsureUseMutationMock.mockReturnValue({
      mutate: analyticsEnsureMutateMock,
      isPending: false,
    });
    analyticsInfoUseQueryMock.mockReturnValue({
      data: {
        enabled: true,
        entitled: true,
        instanceId: "ppi-analytics-1",
        catalog: {
          name: "Analytics",
          description: "Track page traffic and visitor behavior for your project.",
        },
      },
      error: null,
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    pluginReadUseQueryMock.mockReturnValue({
      data: {
        pluginId: "analytics",
        readId: "summary",
        result: makeSummary(),
      },
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
        catalog: {
          invalidate: catalogInvalidateMock.mockResolvedValue(undefined),
        },
        info: {
          invalidate: infoInvalidateMock.mockResolvedValue(undefined),
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

  it("renders analytics tabs and switches between focused views", () => {
    render(
      <MemoryRouter>
        <ProjectAnalytics />
      </MemoryRouter>,
    );

    const openTab = (name: string) => {
      const tab = screen.getByRole("tab", { name });
      fireEvent.mouseDown(tab, { button: 0 });
      fireEvent.click(tab);
    };

    expect(screen.getByRole("heading", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getAllByText("Pageviews").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unique visitors").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sessions").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Contact submissions").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Traffic" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Behavior" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Attribution" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Leads" })).toBeInTheDocument();
    expect(screen.getByText("Period comparison")).toBeInTheDocument();
    expect(screen.queryByText("Top pages")).not.toBeInTheDocument();

    openTab("Traffic");
    expect(screen.getByText("Top pages")).toBeInTheDocument();
    expect(screen.getByText("Country breakdown")).toBeInTheDocument();
    expect(screen.queryByText("Period comparison")).not.toBeInTheDocument();

    const countriesSection = screen.getByText("Country breakdown").closest("section");
    expect(countriesSection).not.toBeNull();
    const countries = within(countriesSection!);
    expect(countries.getByText("DE")).toBeInTheDocument();
    expect(countries.getByText("222")).toBeInTheDocument();

    openTab("Behavior");
    expect(screen.getByText("Visitor paths")).toBeInTheDocument();
    const pathsSection = screen.getByText("Visitor paths").closest("section");
    expect(pathsSection).not.toBeNull();
    const paths = within(pathsSection!);
    expect(paths.getByText("/pricing")).toBeInTheDocument();
    expect(paths.getByText("/contact")).toBeInTheDocument();

    openTab("Attribution");
    const campaignsSection = screen.getByText("UTM campaign attribution").closest("section");
    expect(campaignsSection).not.toBeNull();
    const campaigns = within(campaignsSection!);
    expect(campaigns.getByText("google")).toBeInTheDocument();
    expect(campaigns.getByText("spring_launch")).toBeInTheDocument();

    const sourcesSection = screen.getByText("Top UTM sources").closest("section");
    expect(sourcesSection).not.toBeNull();
    const sources = within(sourcesSection!);
    expect(sources.getAllByText("google")[0]).toBeInTheDocument();

    openTab("Leads");
    expect(screen.getByText("Lead sources")).toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });
});
