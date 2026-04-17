import type {
  TableBookingCapacityMode,
  TableBookingSourceChannel,
  TableBookingStatus,
} from "./types";

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const WEEKDAY_LABELS: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

export const WEEKDAY_SHORT_LABELS: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

export const STATUS_LABELS: Record<TableBookingStatus, string> = {
  confirmed: "Confirmed",
  cancelled_by_guest: "Cancelled by guest",
  cancelled_by_staff: "Cancelled by staff",
  no_show: "No-show",
  completed: "Completed",
};

export const SOURCE_CHANNEL_LABELS: Record<TableBookingSourceChannel, string> = {
  online: "Online",
  phone: "Phone",
  walk_in: "Walk-in",
  staff_manual: "Staff",
};

export const CAPACITY_MODE_LABELS: Record<TableBookingCapacityMode, string> = {
  cover_holdback: "Cover holdback",
  effective_capacity_override: "Effective capacity",
  closed: "Closed window",
};

export const BOOKING_STATUS_OPTIONS: Array<{
  value: "all" | TableBookingStatus;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled_by_guest", label: "Cancelled by guest" },
  { value: "cancelled_by_staff", label: "Cancelled by staff" },
  { value: "no_show", label: "No-show" },
  { value: "completed", label: "Completed" },
];

export const SOURCE_CHANNEL_OPTIONS: Array<{
  value: TableBookingSourceChannel;
  label: string;
}> = [
  { value: "online", label: "Online" },
  { value: "phone", label: "Phone" },
  { value: "walk_in", label: "Walk-in" },
  { value: "staff_manual", label: "Staff" },
];

export const SOURCE_CHANNEL_FILTER_OPTIONS: Array<{
  value: "all" | TableBookingSourceChannel;
  label: string;
}> = [
  { value: "all", label: "All" },
  ...SOURCE_CHANNEL_OPTIONS,
];

export const CAPACITY_MODE_OPTIONS: Array<{
  value: TableBookingCapacityMode;
  label: string;
}> = [
  { value: "cover_holdback", label: "Cover holdback" },
  {
    value: "effective_capacity_override",
    label: "Effective capacity",
  },
  { value: "closed", label: "Closed window" },
];

export const PLUGIN_READ_REFETCH_INTERVAL_MS = 30_000;
