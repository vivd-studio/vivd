import { fireEvent, render, screen } from "@testing-library/react";
import { createContext, useContext, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TableBookingProjectPage from "@vivd/plugin-table-booking/frontend/TableBookingProjectPage";
import {
  TABLE_BOOKING_BOOKINGS_READ_ID,
  TABLE_BOOKING_SUMMARY_READ_ID,
  type TableBookingBookingsPayload,
  type TableBookingSummaryPayload,
} from "@vivd/plugin-table-booking/shared/summary";

const {
  ensureUseMutationMock,
  infoUseQueryMock,
  actionUseMutationMock,
  dayCapacityUseQueryMock,
  deleteCapacityAdjustmentUseMutationMock,
  exportBookingsUseMutationMock,
  projectListUseQueryMock,
  readUseQueryMock,
  requestAccessUseMutationMock,
  saveCapacityAdjustmentUseMutationMock,
  saveReservationUseMutationMock,
  updateConfigUseMutationMock,
  useUtilsMock,
} = vi.hoisted(() => ({
  ensureUseMutationMock: vi.fn(),
  infoUseQueryMock: vi.fn(),
  actionUseMutationMock: vi.fn(),
  dayCapacityUseQueryMock: vi.fn(),
  deleteCapacityAdjustmentUseMutationMock: vi.fn(),
  exportBookingsUseMutationMock: vi.fn(),
  projectListUseQueryMock: vi.fn(),
  readUseQueryMock: vi.fn(),
  requestAccessUseMutationMock: vi.fn(),
  saveCapacityAdjustmentUseMutationMock: vi.fn(),
  saveReservationUseMutationMock: vi.fn(),
  updateConfigUseMutationMock: vi.fn(),
  useUtilsMock: vi.fn(),
}));

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
}));

vi.mock("@/components/settings/SettingsPageShell", () => ({
  SettingsPageShell: ({
    title,
    description,
    children,
    actions,
  }: {
    title: string;
    description: string;
    children: ReactNode;
    actions?: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="mock-select"
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean;
    onCheckedChange?: (value: boolean) => void;
  }) => (
    <input
      aria-label="mock-checkbox"
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock("@/components/ui/tabs", () => {
  const TabsContext = createContext<{
    value: string;
    onValueChange?: (value: string) => void;
  } | null>(null);

  return {
    Tabs: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange?: (value: string) => void;
      children: ReactNode;
    }) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </TabsContext.Provider>
    ),
    TabsList: ({ children }: { children: ReactNode }) => (
      <div role="tablist">{children}</div>
    ),
    TabsTrigger: ({
      value,
      children,
    }: {
      value: string;
      children: ReactNode;
    }) => {
      const context = useContext(TabsContext);
      return (
        <button
          role="tab"
          aria-selected={context?.value === value}
          onClick={() => context?.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({
      value,
      children,
    }: {
      value: string;
      children: ReactNode;
    }) => {
      const context = useContext(TabsContext);
      if (context?.value !== value) return null;
      return <div role="tabpanel">{children}</div>;
    },
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    plugins: {
      info: {
        useQuery: infoUseQueryMock,
      },
      read: {
        useQuery: readUseQueryMock,
      },
      action: {
        useMutation: actionUseMutationMock,
      },
      ensure: {
        useMutation: ensureUseMutationMock,
      },
      requestAccess: {
        useMutation: requestAccessUseMutationMock,
      },
      updateConfig: {
        useMutation: updateConfigUseMutationMock,
      },
      tableBooking: {
        dayCapacity: {
          useQuery: dayCapacityUseQueryMock,
        },
        saveReservation: {
          useMutation: saveReservationUseMutationMock,
        },
        saveCapacityAdjustment: {
          useMutation: saveCapacityAdjustmentUseMutationMock,
        },
        deleteCapacityAdjustment: {
          useMutation: deleteCapacityAdjustmentUseMutationMock,
        },
        exportBookings: {
          useMutation: exportBookingsUseMutationMock,
        },
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

const summaryPayload: TableBookingSummaryPayload = {
  pluginId: "table_booking",
  enabled: true,
  rangeDays: 7,
  counts: {
    bookingsToday: 0,
    coversToday: 0,
    upcomingBookings: 2,
    upcomingCovers: 4,
    cancelled: 0,
    noShow: 0,
    completed: 0,
  },
  recent: {
    booked: 2,
    cancelled: 0,
    noShow: 0,
    completed: 0,
  },
};

const bookingsPayload: TableBookingBookingsPayload = {
  pluginId: "table_booking",
  enabled: true,
  status: "all",
  sourceChannel: "all",
  search: "",
  startDate: null,
  endDate: null,
  total: 2,
  limit: 100,
  offset: 0,
  rows: [
    {
      id: "booking-1",
      status: "confirmed",
      sourceChannel: "staff_manual",
      serviceDate: "2026-04-17",
      serviceStartAt: "2026-04-17T17:30:00.000Z",
      serviceEndAt: "2026-04-17T19:00:00.000Z",
      partySize: 2,
      guestName: "Felix Pahlke",
      guestEmail: "felix@example.com",
      guestPhone: "+4912345",
      notes: "Window seat",
      sourceHost: "test2.localhost",
      sourcePath: "/",
      createdAt: "2026-04-16T19:18:23.613Z",
      cancelledAt: null,
      completedAt: null,
      noShowAt: null,
      canGuestCancel: true,
    },
    {
      id: "booking-2",
      status: "confirmed",
      sourceChannel: "online",
      serviceDate: "2026-04-17",
      serviceStartAt: "2026-04-17T19:00:00.000Z",
      serviceEndAt: "2026-04-17T20:30:00.000Z",
      partySize: 2,
      guestName: "Felix Pahlke",
      guestEmail: "felix@example.com",
      guestPhone: "+4912345",
      notes: "Allergic to pesto",
      sourceHost: "test2.localhost",
      sourcePath: "/",
      createdAt: "2026-04-16T19:15:54.973Z",
      cancelledAt: null,
      completedAt: null,
      noShowAt: null,
      canGuestCancel: true,
    },
  ],
};

const dayCapacityPayload = {
  pluginId: "table_booking",
  enabled: true,
  serviceDate: "2026-04-16",
  timeZone: "Europe/Berlin",
  windows: [
    {
      key: "2026-04-16-17:00-21:00-0",
      startTime: "17:00",
      endTime: "21:00",
      slotIntervalMinutes: 30,
      durationMinutes: 90,
      baseCapacity: 28,
      effectiveCapacity: 24,
      bookedCovers: 6,
      remainingCovers: 18,
      isClosed: false,
      adjustments: [],
    },
  ],
  adjustments: [],
};

function createMutationResult() {
  return {
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  };
}

describe("TableBookingProjectPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));

    useSessionMock.mockReset();
    infoUseQueryMock.mockReset();
    readUseQueryMock.mockReset();
    actionUseMutationMock.mockReset();
    dayCapacityUseQueryMock.mockReset();
    deleteCapacityAdjustmentUseMutationMock.mockReset();
    ensureUseMutationMock.mockReset();
    exportBookingsUseMutationMock.mockReset();
    requestAccessUseMutationMock.mockReset();
    saveCapacityAdjustmentUseMutationMock.mockReset();
    saveReservationUseMutationMock.mockReset();
    updateConfigUseMutationMock.mockReset();
    projectListUseQueryMock.mockReset();
    useUtilsMock.mockReset();

    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: "super_admin",
        },
      },
    });

    useUtilsMock.mockReturnValue({
      plugins: {
        catalog: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
        info: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
        read: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
        tableBooking: {
          dayCapacity: {
            invalidate: vi.fn().mockResolvedValue(undefined),
          },
        },
      },
    });

    projectListUseQueryMock.mockReturnValue({
      data: {
        projects: [{ slug: "nudels-without-pesto", title: "Nudels without Pesto" }],
      },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    infoUseQueryMock.mockReturnValue({
      data: {
        pluginId: "table_booking",
        entitled: true,
        enabled: true,
        instanceId: "plugin-1",
        status: "enabled",
        config: {
          timezone: "Europe/Berlin",
          sourceHosts: [],
          redirectHostAllowlist: [],
          notificationRecipientEmails: [],
          partySize: { min: 1, max: 8 },
          leadTimeMinutes: 120,
          bookingHorizonDays: 60,
          defaultDurationMinutes: 90,
          cancellationCutoffMinutes: 120,
          collectNotes: true,
          weeklySchedule: [],
          dateOverrides: [],
        },
        usage: {
          availabilityEndpoint: "https://api.example.com/plugins/table-booking/v1/availability",
          bookEndpoint: "https://api.example.com/plugins/table-booking/v1/book",
          cancelEndpoint: "https://api.example.com/plugins/table-booking/v1/cancel",
          expectedFields: ["date", "partySize", "time", "name", "email", "phone"],
          optionalFields: ["notes"],
          inferredAutoSourceHosts: ["test2.localhost"],
        },
        snippets: {
          html: "<form></form>",
          astro: "<form></form>",
        },
        details: {
          counts: {
            bookingsToday: 0,
            upcomingBookings: 2,
            upcomingCovers: 4,
          },
          notificationRecipients: [],
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    actionUseMutationMock.mockReturnValue(createMutationResult());
    dayCapacityUseQueryMock.mockReturnValue({
      data: dayCapacityPayload,
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    deleteCapacityAdjustmentUseMutationMock.mockReturnValue(createMutationResult());
    ensureUseMutationMock.mockReturnValue(createMutationResult());
    exportBookingsUseMutationMock.mockReturnValue(createMutationResult());
    requestAccessUseMutationMock.mockReturnValue(createMutationResult());
    saveCapacityAdjustmentUseMutationMock.mockReturnValue(createMutationResult());
    saveReservationUseMutationMock.mockReturnValue(createMutationResult());
    updateConfigUseMutationMock.mockReturnValue(createMutationResult());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the calendar workspace and keeps the monthly read live", () => {
    readUseQueryMock.mockImplementation(
      ({
        readId,
        input,
      }: {
        readId: string;
        input?: {
          startDate?: string;
          endDate?: string;
        };
      }) => {
        if (readId === TABLE_BOOKING_SUMMARY_READ_ID) {
          return {
            data: { result: summaryPayload },
            error: null,
            isLoading: false,
            refetch: vi.fn().mockResolvedValue(undefined),
          };
        }
        if (
          input?.startDate === "2026-04-01" &&
          input?.endDate === "2026-04-30"
        ) {
          return {
            data: { result: bookingsPayload },
            error: null,
            isLoading: false,
            refetch: vi.fn().mockResolvedValue(undefined),
          };
        }
        return {
          data: {
            result: {
              ...bookingsPayload,
              total: 0,
              startDate: input?.startDate ?? null,
              endDate: input?.endDate ?? null,
              rows: [],
            },
          },
          error: null,
          isLoading: false,
          refetch: vi.fn().mockResolvedValue(undefined),
        };
      },
    );

    render(
      <TableBookingProjectPage
        projectSlug="nudels-without-pesto"
        isEmbedded={true}
      />,
    );

    expect(screen.getByText("Schedule calendar")).toBeInTheDocument();
    expect(screen.getByText("Service-window capacity")).toBeInTheDocument();
    expect(screen.getByText("2 bookings · 4 covers")).toBeInTheDocument();

    const monthCall = readUseQueryMock.mock.calls.find(
      (call) =>
        call[0]?.readId === TABLE_BOOKING_BOOKINGS_READ_ID &&
        call[0]?.input?.startDate === "2026-04-01" &&
        call[0]?.input?.endDate === "2026-04-30",
    );
    expect(monthCall?.[1]).toMatchObject({
      enabled: true,
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
    });
  });

  it("surfaces booking-search read errors without falling back to an empty state", () => {
    readUseQueryMock.mockImplementation(
      ({
        readId,
        input,
      }: {
        readId: string;
        input?: {
          startDate?: string;
          endDate?: string;
        };
      }) => {
        if (readId === TABLE_BOOKING_BOOKINGS_READ_ID) {
          if (
            input?.startDate === "2026-04-01" &&
            input?.endDate === "2026-04-30"
          ) {
            return {
              data: { result: bookingsPayload },
              error: null,
              isLoading: false,
              refetch: vi.fn().mockResolvedValue(undefined),
            };
          }
          if (
            input?.startDate === "2026-04-16" &&
            input?.endDate === "2026-04-16"
          ) {
            return {
              data: {
                result: {
                  ...bookingsPayload,
                  total: 0,
                  startDate: "2026-04-16",
                  endDate: "2026-04-16",
                  rows: [],
                },
              },
              error: null,
              isLoading: false,
              refetch: vi.fn().mockResolvedValue(undefined),
            };
          }
          return {
            data: undefined,
            error: { message: "bookings exploded" },
            isLoading: false,
            refetch: vi.fn().mockResolvedValue(undefined),
          };
        }
        if (readId === TABLE_BOOKING_SUMMARY_READ_ID) {
          return {
            data: { result: summaryPayload },
            error: null,
            isLoading: false,
            refetch: vi.fn().mockResolvedValue(undefined),
          };
        }
      },
    );

    render(
      <TableBookingProjectPage
        projectSlug="nudels-without-pesto"
        isEmbedded={true}
      />,
    );

    expect(
      screen.getByText(
        "Some booking data could not load. Booking search: bookings exploded",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No bookings found")).not.toBeInTheDocument();
  });

  it("exposes booking export and source-channel badges in booking search", () => {
    const exportMutate = vi.fn();
    exportBookingsUseMutationMock.mockReturnValue({
      mutate: exportMutate,
      isPending: false,
      variables: undefined,
    });

    readUseQueryMock.mockImplementation(
      ({
        readId,
        input,
      }: {
        readId: string;
        input?: {
          startDate?: string;
          endDate?: string;
          sourceChannel?: string;
        };
      }) => {
        if (readId === TABLE_BOOKING_SUMMARY_READ_ID) {
          return {
            data: { result: summaryPayload },
            error: null,
            isLoading: false,
            refetch: vi.fn().mockResolvedValue(undefined),
          };
        }
        if (
          input?.startDate === "2026-04-01" &&
          input?.endDate === "2026-04-30"
        ) {
          return {
            data: { result: bookingsPayload },
            error: null,
            isLoading: false,
            refetch: vi.fn().mockResolvedValue(undefined),
          };
        }
        return {
          data: { result: bookingsPayload },
          error: null,
          isLoading: false,
          refetch: vi.fn().mockResolvedValue(undefined),
        };
      },
    );

    render(
      <TableBookingProjectPage
        projectSlug="nudels-without-pesto"
        isEmbedded={true}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Booking search" }));

    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
    expect(screen.getAllByText("Staff")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(exportMutate).toHaveBeenCalledWith({
      slug: "nudels-without-pesto",
      status: "all",
      sourceChannel: "all",
      search: "",
      startDate: undefined,
      endDate: undefined,
    });
  });
});
