import type { TableBookingPluginConfig } from "./config";
import { tableBookingIsoDateSchema, tableBookingTimeStringSchema } from "./config";
import type {
  TableBookingCapacityAdjustmentInput,
  TableBookingReservationMutationInput,
  TableBookingStaffReservationInput,
} from "./ports";
import { overlaps, zonedDateTimeToUtc } from "./schedule";
import { TableBookingValidationError } from "./serviceErrors";
import type { CapacityAdjustmentRow, ReservationRow } from "./serviceTypes";
import {
  capacityAdjustmentModeSchema,
  coerceDateValue,
  guestNameSchema,
  partySizeSchema,
  phoneSchema,
  sourceChannelSchema,
  emailSchema,
} from "./serviceShared";

export function startOfUtcMonth(): Date {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  return monthStart;
}

export function endOfRangeFromDate(date: Date, rangeDays: number): Date {
  return new Date(date.getTime() + rangeDays * 24 * 60 * 60 * 1000);
}

export function canGuestCancelReservation(
  reservation: Pick<ReservationRow, "status" | "serviceStartAt">,
  config: TableBookingPluginConfig,
  now: Date,
): boolean {
  if (reservation.status !== "confirmed") return false;
  const serviceStartAt = coerceDateValue(reservation.serviceStartAt);
  if (!serviceStartAt) return false;
  return (
    serviceStartAt.getTime() - now.getTime() >=
    config.cancellationCutoffMinutes * 60_000
  );
}

export function validateAvailabilityInput(options: {
  date: string;
  partySize: number;
  config: TableBookingPluginConfig;
}) {
  const dateParsed = tableBookingIsoDateSchema.safeParse(options.date);
  if (!dateParsed.success) {
    throw new TableBookingValidationError("Date must use YYYY-MM-DD format.");
  }

  if (
    options.partySize < options.config.partySize.min ||
    options.partySize > options.config.partySize.max
  ) {
    throw new TableBookingValidationError(
      `Party size must be between ${options.config.partySize.min} and ${options.config.partySize.max}.`,
    );
  }
}

export function validateBookingPayload(options: {
  input: TableBookingReservationMutationInput;
  config: TableBookingPluginConfig;
}) {
  validateAvailabilityInput({
    date: options.input.date,
    partySize: options.input.partySize,
    config: options.config,
  });

  const timeParsed = tableBookingTimeStringSchema.safeParse(options.input.time);
  if (!timeParsed.success) {
    throw new TableBookingValidationError("Time must use HH:MM format.");
  }

  const emailParsed = emailSchema.safeParse(options.input.email);
  if (!emailParsed.success) {
    throw new TableBookingValidationError("A valid email address is required.");
  }

  const phoneParsed = phoneSchema.safeParse(options.input.phone);
  if (!phoneParsed.success) {
    throw new TableBookingValidationError("A valid phone number is required.");
  }

  const nameParsed = guestNameSchema.safeParse(options.input.name);
  if (!nameParsed.success) {
    throw new TableBookingValidationError("Guest name is required.");
  }

  const sizeParsed = partySizeSchema.safeParse(options.input.partySize);
  if (!sizeParsed.success) {
    throw new TableBookingValidationError("Party size must be a whole number.");
  }
}

export function validateStaffReservationInput(options: {
  input: TableBookingStaffReservationInput;
  config: TableBookingPluginConfig;
}) {
  validateAvailabilityInput({
    date: options.input.date,
    partySize: options.input.partySize,
    config: options.config,
  });

  if (!tableBookingTimeStringSchema.safeParse(options.input.time).success) {
    throw new TableBookingValidationError("Time must use HH:MM format.");
  }
  if (!emailSchema.safeParse(options.input.email).success) {
    throw new TableBookingValidationError("A valid email address is required.");
  }
  if (!phoneSchema.safeParse(options.input.phone).success) {
    throw new TableBookingValidationError("A valid phone number is required.");
  }
  if (!guestNameSchema.safeParse(options.input.name).success) {
    throw new TableBookingValidationError("Guest name is required.");
  }
  if (!partySizeSchema.safeParse(options.input.partySize).success) {
    throw new TableBookingValidationError("Party size must be a whole number.");
  }
  if (!sourceChannelSchema.safeParse(options.input.sourceChannel).success) {
    throw new TableBookingValidationError("Choose a valid reservation source.");
  }
}

export function validateCapacityAdjustmentInput(
  input: TableBookingCapacityAdjustmentInput,
) {
  if (!tableBookingIsoDateSchema.safeParse(input.serviceDate).success) {
    throw new TableBookingValidationError("Date must use YYYY-MM-DD format.");
  }
  if (!tableBookingTimeStringSchema.safeParse(input.startTime).success) {
    throw new TableBookingValidationError("Start time must use HH:MM format.");
  }
  if (!tableBookingTimeStringSchema.safeParse(input.endTime).success) {
    throw new TableBookingValidationError("End time must use HH:MM format.");
  }
  if (input.startTime >= input.endTime) {
    throw new TableBookingValidationError(
      "Adjustment end time must be after start time.",
    );
  }
  if (!capacityAdjustmentModeSchema.safeParse(input.mode).success) {
    throw new TableBookingValidationError(
      "Choose a valid capacity adjustment mode.",
    );
  }
  const capacityValue =
    typeof input.capacityValue === "number" ? input.capacityValue : null;
  if (input.mode === "closed") {
    return;
  }
  if (!Number.isInteger(capacityValue) || (capacityValue ?? 0) <= 0) {
    throw new TableBookingValidationError(
      "Capacity value must be a whole number above zero.",
    );
  }
}

export function validateBookingWindow(options: {
  config: TableBookingPluginConfig;
  date: string;
  startAt: Date;
  now: Date;
}) {
  const horizonEnd = endOfRangeFromDate(
    options.now,
    options.config.bookingHorizonDays,
  );
  if (options.startAt > horizonEnd) {
    throw new TableBookingValidationError(
      "That date is outside the online booking window.",
    );
  }

  if (
    options.startAt.getTime() - options.now.getTime() <
    options.config.leadTimeMinutes * 60_000
  ) {
    throw new TableBookingValidationError(
      "That time is too soon for online booking. Please choose a later slot.",
    );
  }
}

export function overlapsTimeRangeForDate(options: {
  date: string;
  startAt: Date;
  endAt: Date;
  adjustment: Pick<CapacityAdjustmentRow, "startTime" | "endTime">;
  timeZone: string;
}) {
  const adjustmentStartAt = zonedDateTimeToUtc(
    options.date,
    options.adjustment.startTime,
    options.timeZone,
  );
  const adjustmentEndAt = zonedDateTimeToUtc(
    options.date,
    options.adjustment.endTime,
    options.timeZone,
  );
  return overlaps(
    adjustmentStartAt,
    adjustmentEndAt,
    options.startAt,
    options.endAt,
  );
}

export function getEffectiveCapacityForRange(options: {
  baseCapacity: number;
  adjustments: CapacityAdjustmentRow[];
  date: string;
  startAt: Date;
  endAt: Date;
  timeZone: string;
}): number {
  const overlappingAdjustments = options.adjustments.filter((adjustment) =>
    overlapsTimeRangeForDate({
      date: options.date,
      startAt: options.startAt,
      endAt: options.endAt,
      adjustment,
      timeZone: options.timeZone,
    }),
  );

  if (overlappingAdjustments.some((adjustment) => adjustment.mode === "closed")) {
    return 0;
  }

  const overrideValues = overlappingAdjustments
    .filter((adjustment) => adjustment.mode === "effective_capacity_override")
    .map((adjustment) => adjustment.capacityValue ?? options.baseCapacity);
  const holdbackValue = overlappingAdjustments
    .filter((adjustment) => adjustment.mode === "cover_holdback")
    .reduce((sum, adjustment) => sum + (adjustment.capacityValue ?? 0), 0);

  const overriddenCapacity =
    overrideValues.length > 0
      ? Math.min(options.baseCapacity, ...overrideValues)
      : options.baseCapacity;

  return Math.max(0, overriddenCapacity - holdbackValue);
}

export function getPeakBookedCovers(options: {
  reservations: ReservationRow[];
  startAt: Date;
  endAt: Date;
}): number {
  const events: Array<{ at: number; delta: number }> = [];
  for (const reservation of options.reservations) {
    if (reservation.status !== "confirmed") continue;
    if (
      !overlaps(
        reservation.serviceStartAt,
        reservation.serviceEndAt,
        options.startAt,
        options.endAt,
      )
    ) {
      continue;
    }

    const overlapStart = Math.max(
      reservation.serviceStartAt.getTime(),
      options.startAt.getTime(),
    );
    const overlapEnd = Math.min(
      reservation.serviceEndAt.getTime(),
      options.endAt.getTime(),
    );
    events.push({ at: overlapStart, delta: reservation.partySize });
    events.push({ at: overlapEnd, delta: -reservation.partySize });
  }

  events.sort((left, right) =>
    left.at === right.at ? left.delta - right.delta : left.at - right.at,
  );

  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}
