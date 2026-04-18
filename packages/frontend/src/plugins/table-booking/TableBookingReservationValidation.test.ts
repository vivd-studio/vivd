import { describe, expect, it } from "vitest";
import { validateReservationDraft } from "../../../../../plugins/native/table-booking/src/frontend/tableBookingProjectPage/utils";

describe("table booking reservation validation", () => {
  it("accepts phone-only reservations for operator saves", () => {
    const result = validateReservationDraft({
      date: "2026-04-18",
      time: "17:00",
      partySize: "2",
      name: "Felix Pahlke",
      email: "",
      phone: "+4912345",
      sendGuestNotification: false,
    });

    expect(result.partySize).toBe(2);
    expect(result.errors).toEqual({});
  });

  it("returns inline-friendly errors for missing guest details", () => {
    const result = validateReservationDraft({
      date: "",
      time: "",
      partySize: "0",
      name: "",
      email: "",
      phone: "",
      sendGuestNotification: false,
    });

    expect(result.errors).toMatchObject({
      date: "Choose a reservation date.",
      time: "Choose a reservation time.",
      partySize: "Party size must be between 1 and 50.",
      name: "Guest name is required.",
      contact: "Add at least one contact method.",
    });
  });

  it("requires an email address before guest confirmation email can be enabled", () => {
    const result = validateReservationDraft({
      date: "2026-04-18",
      time: "17:00",
      partySize: "2",
      name: "Felix Pahlke",
      email: "",
      phone: "+4912345",
      sendGuestNotification: true,
    });

    expect(result.errors.email).toBe(
      "Guest confirmation email requires an email address.",
    );
  });
});
