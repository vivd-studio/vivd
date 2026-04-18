type ErrorWithCause = {
  message?: unknown;
  code?: unknown;
  cause?: unknown;
};

let hasWarnedAboutMissingOperatorCapacityStorage = false;
const TABLE_BOOKING_OPERATOR_CAPACITY_STORAGE_MIGRATION =
  "0028_table_booking_operator_capacity.sql";

function collectErrorChain(error: unknown): ErrorWithCause[] {
  const chain: ErrorWithCause[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    chain.push(current as ErrorWithCause);
    current = (current as ErrorWithCause).cause;
  }

  return chain;
}

function getErrorMessage(error: ErrorWithCause | null | undefined): string {
  return typeof error?.message === "string" ? error.message : "";
}

function getErrorCode(error: ErrorWithCause | null | undefined): string {
  return typeof error?.code === "string" ? error.code.toUpperCase() : "";
}

export function getMissingOperatorCapacityStorageErrorMessage(
  error: unknown,
): string | null {
  const chain = collectErrorChain(error);

  const matchesMissingReservationColumns = chain.some((entry) => {
    const message = getErrorMessage(entry).toLowerCase();
    const code = getErrorCode(entry);
    const isMissingStorageMessage =
      message.includes("does not exist") ||
      message.includes("undefined column") ||
      message.includes("undefined table");

    return (
      (code === "42703" || isMissingStorageMessage) &&
      (message.includes("source_channel") ||
        message.includes("created_by_user_id") ||
        message.includes("updated_by_user_id"))
    );
  });

  const matchesMissingCapacityTable = chain.some((entry) => {
    const message = getErrorMessage(entry).toLowerCase();
    const code = getErrorCode(entry);
    const isMissingStorageMessage =
      message.includes("does not exist") ||
      message.includes("undefined column") ||
      message.includes("undefined table");

    return (
      (code === "42P01" || isMissingStorageMessage) &&
      message.includes("table_booking_capacity_adjustment")
    );
  });

  if (!matchesMissingReservationColumns && !matchesMissingCapacityTable) {
    return null;
  }

  return `Table Booking operator storage is unavailable or out of date. Run backend db:migrate to apply migration ${TABLE_BOOKING_OPERATOR_CAPACITY_STORAGE_MIGRATION}.`;
}

export function isMissingOperatorCapacityStorageError(error: unknown): boolean {
  return getMissingOperatorCapacityStorageErrorMessage(error) !== null;
}

export function warnMissingOperatorCapacityStorage(error: unknown): void {
  if (hasWarnedAboutMissingOperatorCapacityStorage) return;
  hasWarnedAboutMissingOperatorCapacityStorage = true;

  const detail =
    collectErrorChain(error)
      .map((entry) => getErrorMessage(entry).trim())
      .find((message) => message.length > 0) ?? "unknown error";

  console.warn(
    `[Table Booking] operator storage is unavailable or out of date; falling back to legacy reservation storage where possible. Run backend db:migrate to apply migration ${TABLE_BOOKING_OPERATOR_CAPACITY_STORAGE_MIGRATION}. Error: ${detail}`,
  );
}

export class TableBookingPluginNotEnabledError extends Error {
  constructor() {
    super(
      "Table Booking is not enabled for this project. Ask a super-admin to enable it first.",
    );
    this.name = "TableBookingPluginNotEnabledError";
  }
}

export class TableBookingSourceHostError extends Error {
  constructor() {
    super("Booking source host is not allowed for this project.");
    this.name = "TableBookingSourceHostError";
  }
}

export class TableBookingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableBookingValidationError";
  }
}

export class TableBookingCapacityError extends Error {
  constructor() {
    super("That time slot is no longer available. Please choose another time.");
    this.name = "TableBookingCapacityError";
  }
}

export class TableBookingQuotaExceededError extends Error {
  constructor() {
    super("Monthly booking limit reached for this project.");
    this.name = "TableBookingQuotaExceededError";
  }
}

export class TableBookingReservationNotFoundError extends Error {
  constructor(bookingId: string) {
    super(`Booking not found: ${bookingId}`);
    this.name = "TableBookingReservationNotFoundError";
  }
}
