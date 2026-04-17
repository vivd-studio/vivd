import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import type { TableBookingRecord, TableBookingSourceChannel } from "./types";
import { formatTimeInputValue } from "./utils";

export type TableBookingReservationEditorState = {
  editingBookingId: string | null;
  reservationDate: string;
  setReservationDate: Dispatch<SetStateAction<string>>;
  reservationTime: string;
  setReservationTime: Dispatch<SetStateAction<string>>;
  reservationPartySize: string;
  setReservationPartySize: Dispatch<SetStateAction<string>>;
  reservationName: string;
  setReservationName: Dispatch<SetStateAction<string>>;
  reservationEmail: string;
  setReservationEmail: Dispatch<SetStateAction<string>>;
  reservationPhone: string;
  setReservationPhone: Dispatch<SetStateAction<string>>;
  reservationNotes: string;
  setReservationNotes: Dispatch<SetStateAction<string>>;
  reservationSourceChannel: TableBookingSourceChannel;
  setReservationSourceChannel: Dispatch<
    SetStateAction<TableBookingSourceChannel>
  >;
  sendGuestNotification: boolean;
  setSendGuestNotification: Dispatch<SetStateAction<boolean>>;
  resetReservationEditor: (date?: string) => void;
  startEditingReservation: (booking: TableBookingRecord) => void;
};

export function useTableBookingReservationEditor(options: {
  selectedDate: string;
  timezone: string;
  setSelectedDate: Dispatch<SetStateAction<string>>;
  setVisibleMonth: Dispatch<SetStateAction<string>>;
  setActiveTab: Dispatch<
    SetStateAction<"calendar" | "bookings" | "setup" | "install">
  >;
}): TableBookingReservationEditorState {
  const {
    selectedDate,
    timezone,
    setSelectedDate,
    setVisibleMonth,
    setActiveTab,
  } = options;
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [reservationDate, setReservationDate] = useState(selectedDate);
  const [reservationTime, setReservationTime] = useState("17:00");
  const [reservationPartySize, setReservationPartySize] = useState("2");
  const [reservationName, setReservationName] = useState("");
  const [reservationEmail, setReservationEmail] = useState("");
  const [reservationPhone, setReservationPhone] = useState("");
  const [reservationNotes, setReservationNotes] = useState("");
  const [reservationSourceChannel, setReservationSourceChannel] =
    useState<TableBookingSourceChannel>("phone");
  const [sendGuestNotification, setSendGuestNotification] = useState(false);

  useEffect(() => {
    setReservationDate(selectedDate);
    if (!editingBookingId) {
      setReservationTime("17:00");
    }
  }, [selectedDate, editingBookingId]);

  const resetReservationEditor = (date = selectedDate) => {
    setEditingBookingId(null);
    setReservationDate(date);
    setReservationTime("17:00");
    setReservationPartySize("2");
    setReservationName("");
    setReservationEmail("");
    setReservationPhone("");
    setReservationNotes("");
    setReservationSourceChannel("phone");
    setSendGuestNotification(false);
  };

  const startEditingReservation = (booking: TableBookingRecord) => {
    setEditingBookingId(booking.id);
    setReservationDate(booking.serviceDate);
    setReservationTime(formatTimeInputValue(booking.serviceStartAt, timezone));
    setReservationPartySize(String(booking.partySize));
    setReservationName(booking.guestName);
    setReservationEmail(booking.guestEmail);
    setReservationPhone(booking.guestPhone);
    setReservationNotes(booking.notes ?? "");
    setReservationSourceChannel(booking.sourceChannel);
    setSendGuestNotification(false);
    setSelectedDate(booking.serviceDate);
    setVisibleMonth(booking.serviceDate.slice(0, 7));
    setActiveTab("calendar");
  };

  return {
    editingBookingId,
    reservationDate,
    setReservationDate,
    reservationTime,
    setReservationTime,
    reservationPartySize,
    setReservationPartySize,
    reservationName,
    setReservationName,
    reservationEmail,
    setReservationEmail,
    reservationPhone,
    setReservationPhone,
    reservationNotes,
    setReservationNotes,
    reservationSourceChannel,
    setReservationSourceChannel,
    sendGuestNotification,
    setSendGuestNotification,
    resetReservationEditor,
    startEditingReservation,
  };
}
