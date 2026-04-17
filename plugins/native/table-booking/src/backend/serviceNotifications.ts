import type { TableBookingPluginConfig } from "./config";
import type { TableBookingPluginServiceDeps } from "./ports";
import { formatDateTimeLabelInTimeZone } from "./schedule";
import type { ReservationRow } from "./serviceTypes";

async function sendTransactionalEmail(
  deps: Pick<
    TableBookingPluginServiceDeps,
    "emailDeliveryService"
  >,
  options: {
    to: string[];
    subject: string;
    text: string;
    html: string;
    metadata: Record<string, string>;
  },
) {
  try {
    const response = await deps.emailDeliveryService.send(options);
    if (!response.accepted) {
      console.error("Table booking email not accepted", {
        provider: response.provider,
        error: response.error,
        metadata: options.metadata,
      });
    }
  } catch (error) {
    console.error("Table booking email failed", {
      error,
      metadata: options.metadata,
    });
  }
}

export async function sendBookingCreatedEmails(
  deps: Pick<
    TableBookingPluginServiceDeps,
    "emailDeliveryService" | "emailTemplates"
  >,
  options: {
    projectTitle: string;
    config: TableBookingPluginConfig;
    reservation: ReservationRow;
    cancelUrl: string;
    notifyGuest?: boolean;
    notifyStaff?: boolean;
  },
) {
  const bookingDateTimeLabel = formatDateTimeLabelInTimeZone(
    options.reservation.serviceStartAt,
    options.config.timezone,
  );
  const notifyGuest = options.notifyGuest ?? true;
  const notifyStaff = options.notifyStaff ?? true;

  const [guestEmail, staffEmail] = await Promise.all([
    notifyGuest
      ? deps.emailTemplates.buildGuestConfirmationEmail({
          projectTitle: options.projectTitle,
          guestName: options.reservation.guestName,
          partySize: options.reservation.partySize,
          bookingDateTimeLabel,
          cancelUrl: options.cancelUrl,
        })
      : Promise.resolve(null),
    notifyStaff && options.config.notificationRecipientEmails.length > 0
      ? deps.emailTemplates.buildStaffNewBookingEmail({
          projectTitle: options.projectTitle,
          bookingDateTimeLabel,
          partySize: options.reservation.partySize,
          guestName: options.reservation.guestName,
          guestEmail: options.reservation.guestEmail,
          guestPhone: options.reservation.guestPhone,
          notes: options.reservation.notes,
        })
      : Promise.resolve(null),
  ]);

  await Promise.all([
    guestEmail
      ? sendTransactionalEmail(deps, {
          to: [options.reservation.guestEmail],
          subject: guestEmail.subject,
          text: guestEmail.text,
          html: guestEmail.html,
          metadata: {
            plugin: "table_booking",
            flow: "guest_confirmation",
            project: options.reservation.projectSlug,
            organization: options.reservation.organizationId,
          },
        })
      : Promise.resolve(),
    staffEmail
      ? sendTransactionalEmail(deps, {
          to: options.config.notificationRecipientEmails,
          subject: staffEmail.subject,
          text: staffEmail.text,
          html: staffEmail.html,
          metadata: {
            plugin: "table_booking",
            flow: "staff_new_booking",
            project: options.reservation.projectSlug,
            organization: options.reservation.organizationId,
          },
        })
      : Promise.resolve(),
  ]);
}

export async function sendGuestCancellationEmails(
  deps: Pick<
    TableBookingPluginServiceDeps,
    "emailDeliveryService" | "emailTemplates"
  >,
  options: {
    projectTitle: string;
    config: TableBookingPluginConfig;
    reservation: ReservationRow;
    cancelledBy: "guest" | "staff";
  },
) {
  const bookingDateTimeLabel = formatDateTimeLabelInTimeZone(
    options.reservation.serviceStartAt,
    options.config.timezone,
  );

  const [guestEmail, staffEmail] = await Promise.all([
    deps.emailTemplates.buildGuestCancellationEmail({
      projectTitle: options.projectTitle,
      guestName: options.reservation.guestName,
      partySize: options.reservation.partySize,
      bookingDateTimeLabel,
    }),
    options.config.notificationRecipientEmails.length > 0
      ? deps.emailTemplates.buildStaffCancellationEmail({
          projectTitle: options.projectTitle,
          bookingDateTimeLabel,
          partySize: options.reservation.partySize,
          guestName: options.reservation.guestName,
          guestEmail: options.reservation.guestEmail,
          guestPhone: options.reservation.guestPhone,
          cancelledBy: options.cancelledBy,
          notes: options.reservation.notes,
        })
      : Promise.resolve(null),
  ]);

  await Promise.all([
    sendTransactionalEmail(deps, {
      to: [options.reservation.guestEmail],
      subject: guestEmail.subject,
      text: guestEmail.text,
      html: guestEmail.html,
      metadata: {
        plugin: "table_booking",
        flow: "guest_cancellation",
        project: options.reservation.projectSlug,
        organization: options.reservation.organizationId,
      },
    }),
    staffEmail
      ? sendTransactionalEmail(deps, {
          to: options.config.notificationRecipientEmails,
          subject: staffEmail.subject,
          text: staffEmail.text,
          html: staffEmail.html,
          metadata: {
            plugin: "table_booking",
            flow: "staff_cancellation",
            project: options.reservation.projectSlug,
            organization: options.reservation.organizationId,
          },
        })
      : Promise.resolve(),
  ]);
}
