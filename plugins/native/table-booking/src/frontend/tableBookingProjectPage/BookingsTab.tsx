import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BOOKING_STATUS_OPTIONS,
  SOURCE_CHANNEL_FILTER_OPTIONS,
} from "./constants";
import { BookingRow, SectionCard } from "./shared";
import type {
  TableBookingBookingsPayload,
  TableBookingSourceChannel,
  TableBookingStatus,
} from "./types";
type BookingsTabProps = {
  timezone: string;
  bookingStatus: "all" | TableBookingStatus;
  setBookingStatus: Dispatch<SetStateAction<"all" | TableBookingStatus>>;
  bookingSourceChannel: "all" | TableBookingSourceChannel;
  setBookingSourceChannel: Dispatch<
    SetStateAction<"all" | TableBookingSourceChannel>
  >;
  bookingSearch: string;
  setBookingSearch: Dispatch<SetStateAction<string>>;
  startDate: string;
  setStartDate: Dispatch<SetStateAction<string>>;
  endDate: string;
  setEndDate: Dispatch<SetStateAction<string>>;
  bookings: TableBookingBookingsPayload | undefined;
  bookingsQuery: {
    isLoading: boolean;
    error: { message: string } | null;
  };
  bookingsRows: TableBookingBookingsPayload["rows"];
  bookingRangeStart: number;
  bookingRangeEnd: number;
  canLoadPreviousBookings: boolean;
  canLoadMoreBookings: boolean;
  setBookingOffset: Dispatch<SetStateAction<number>>;
  limit: number;
  exportBookings: () => void;
  exportPending: boolean;
  actionPending: boolean;
  runBookingAction: (actionId: string, bookingId: string) => void;
  onEditBooking: (booking: TableBookingBookingsPayload["rows"][number]) => void;
};

export function TableBookingBookingsTab({
  timezone,
  bookingStatus,
  setBookingStatus,
  bookingSourceChannel,
  setBookingSourceChannel,
  bookingSearch,
  setBookingSearch,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  bookings,
  bookingsQuery,
  bookingsRows,
  bookingRangeStart,
  bookingRangeEnd,
  canLoadPreviousBookings,
  canLoadMoreBookings,
  setBookingOffset,
  limit,
  exportBookings,
  exportPending,
  actionPending,
  runBookingAction,
  onEditBooking,
}: BookingsTabProps) {
  return (
    <SectionCard
      title="Booking search"
      description="Search across bookings when you need more than the calendar day view."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select
            value={bookingStatus}
            onValueChange={(value) =>
              setBookingStatus(value as "all" | TableBookingStatus)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOOKING_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Source</Label>
          <Select
            value={bookingSourceChannel}
            onValueChange={(value) =>
              setBookingSourceChannel(
                value as "all" | TableBookingSourceChannel,
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_CHANNEL_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Search</Label>
          <Input
            value={bookingSearch}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setBookingSearch(event.target.value)
            }
            placeholder="Name, email, phone"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Start date</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setStartDate(event.target.value)
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label>End date</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setEndDate(event.target.value)
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {bookings?.total
            ? `Showing ${bookingRangeStart}-${bookingRangeEnd} of ${bookings.total} bookings`
            : "No bookings found"}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={exportPending}
            onClick={exportBookings}
          >
            {exportPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Exporting...
              </>
            ) : (
              "Export CSV"
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canLoadPreviousBookings}
            onClick={() =>
              setBookingOffset((current) => Math.max(0, current - limit))
            }
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canLoadMoreBookings}
            onClick={() => setBookingOffset((current) => current + limit)}
          >
            Next
          </Button>
        </div>
      </div>

      {bookingsQuery.isLoading && !bookings ? (
        <p className="text-sm text-muted-foreground">Loading bookings...</p>
      ) : null}
      {bookingsQuery.error ? (
        <p className="text-sm text-destructive">
          Could not load bookings: {bookingsQuery.error.message}
        </p>
      ) : null}
      {!bookingsQuery.isLoading && !bookingsQuery.error && bookingsRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No bookings match the current filters.
        </p>
      ) : (
        <div className="space-y-3">
          {bookingsRows.map((booking) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              timeZone={timezone}
              actionPending={actionPending}
              onEdit={() => onEditBooking(booking)}
              onCancel={() => runBookingAction("cancel_booking", booking.id)}
              onMarkNoShow={() => runBookingAction("mark_no_show", booking.id)}
              onMarkCompleted={() =>
                runBookingAction("mark_completed", booking.id)
              }
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
