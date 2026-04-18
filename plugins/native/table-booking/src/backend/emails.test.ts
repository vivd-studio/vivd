import { describe, expect, it } from "vitest";
import {
  buildGuestBookingCancellationEmail,
  buildGuestBookingConfirmationEmail,
  buildStaffBookingCancellationEmail,
  buildStaffNewBookingEmail,
} from "./emails";

const brandingResolver = {
  getResolvedBranding: async () => ({
    displayName: "Example Bistro",
    supportEmail: "support@example.com",
  }),
};

describe("table-booking emails", () => {
  it("renders guest booking confirmation emails", async () => {
    const email = await buildGuestBookingConfirmationEmail(
      {
        projectTitle: "Example Bistro",
        guestName: "Pat",
        partySize: 2,
        bookingDateTimeLabel: "April 19, 2026 at 18:30",
        cancelUrl: "https://example.com/cancel?token=abc",
      },
      brandingResolver,
    );

    expect(email.subject).toBe("Your table booking is confirmed for Example Bistro");
    expect(email.text).toContain("Cancel booking: https://example.com/cancel?token=abc");
    expect(email.html).toContain("Booking confirmed");
  });

  it("renders cancellation and staff notification emails", async () => {
    const guestCancellationEmail = await buildGuestBookingCancellationEmail(
      {
        projectTitle: "Example Bistro",
        guestName: "Pat",
        partySize: 2,
        bookingDateTimeLabel: "April 19, 2026 at 18:30",
      },
      brandingResolver,
    );
    const staffNewBookingEmail = await buildStaffNewBookingEmail(
      {
        projectTitle: "Example Bistro",
        bookingDateTimeLabel: "April 19, 2026 at 18:30",
        partySize: 2,
        guestName: "Pat",
        guestEmail: "pat@example.com",
        guestPhone: "+4912345",
      },
      brandingResolver,
    );
    const staffCancellationEmail = await buildStaffBookingCancellationEmail(
      {
        projectTitle: "Example Bistro",
        bookingDateTimeLabel: "April 19, 2026 at 18:30",
        partySize: 2,
        guestName: "Pat",
        guestEmail: "pat@example.com",
        guestPhone: "+4912345",
        cancelledBy: "guest",
      },
      brandingResolver,
    );

    expect(guestCancellationEmail.subject).toBe(
      "Your table booking was cancelled for Example Bistro",
    );
    expect(staffNewBookingEmail.subject).toBe("New table booking for Example Bistro");
    expect(staffCancellationEmail.text).toContain("The guest cancelled this booking.");
  });
});
