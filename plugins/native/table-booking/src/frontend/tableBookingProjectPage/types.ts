import type { RouterOutputs } from "@/lib/trpc";
import type {
  TableBookingDateOverride,
  TableBookingPluginConfig,
  TableBookingSchedulePeriod,
  TableBookingWeeklyScheduleEntry,
} from "../../backend/config";
import type {
  TableBookingBookingsPayload,
  TableBookingRecord,
  TableBookingSummaryPayload,
} from "../../shared/summary";

export type TableBookingProjectPageProps = {
  projectSlug: string;
  isEmbedded?: boolean;
};

export type TableBookingStatus =
  TableBookingBookingsPayload["rows"][number]["status"];
export type TableBookingSourceChannel =
  TableBookingBookingsPayload["rows"][number]["sourceChannel"];
export type TableBookingDayCapacityPayload =
  RouterOutputs["plugins"]["tableBooking"]["dayCapacity"];
export type TableBookingCapacityAdjustmentRecord =
  TableBookingDayCapacityPayload["adjustments"][number];
export type TableBookingCapacityMode =
  TableBookingCapacityAdjustmentRecord["mode"];

export type SettingsTab = "calendar" | "bookings" | "setup" | "install";

export type DailyBookingSummary = {
  count: number;
  covers: number;
  confirmed: number;
  cancelled: number;
  noShow: number;
  completed: number;
};

export type TableBookingPluginInfo = RouterOutputs["plugins"]["info"] & {
  config: TableBookingPluginConfig | null;
  snippets: {
    html: string;
    astro: string;
  } | null;
  usage: {
    availabilityEndpoint: string;
    bookEndpoint: string;
    cancelEndpoint: string;
    expectedFields: string[];
    optionalFields: string[];
    inferredAutoSourceHosts: string[];
  } | null;
  details: {
    counts?: {
      bookingsToday: number;
      upcomingBookings: number;
      upcomingCovers: number;
    };
    notificationRecipients?: string[];
  } | null;
};

export type {
  TableBookingBookingsPayload,
  TableBookingDateOverride,
  TableBookingDayCapacityPayload as TableBookingCapacityPayload,
  TableBookingPluginConfig,
  TableBookingRecord,
  TableBookingSchedulePeriod,
  TableBookingSummaryPayload,
  TableBookingWeeklyScheduleEntry,
};
