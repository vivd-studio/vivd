type ErrorWithCause = {
  message?: unknown;
  code?: unknown;
  cause?: unknown;
};

let hasWarnedAboutMissingOperatorCapacityStorage = false;

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

export function isMissingOperatorCapacityStorageError(error: unknown): boolean {
  const chain = collectErrorChain(error);

  return chain.some((entry) => {
    const message = getErrorMessage(entry).toLowerCase();
    const code = getErrorCode(entry);
    const isMissingStorageMessage =
      message.includes("does not exist") ||
      message.includes("undefined column") ||
      message.includes("undefined table");

    if (
      (code === "42703" || isMissingStorageMessage) &&
      (message.includes("source_channel") ||
        message.includes("created_by_user_id") ||
        message.includes("updated_by_user_id"))
    ) {
      return true;
    }

    if (
      (code === "42P01" || isMissingStorageMessage) &&
      message.includes("table_booking_capacity_adjustment")
    ) {
      return true;
    }

    return false;
  });
}

export function warnMissingOperatorCapacityStorage(error: unknown): void {
  if (hasWarnedAboutMissingOperatorCapacityStorage) return;
  hasWarnedAboutMissingOperatorCapacityStorage = true;

  const detail =
    collectErrorChain(error)
      .map((entry) => getErrorMessage(entry).trim())
      .find((message) => message.length > 0) ?? "unknown error";

  console.warn(
    `[Table Booking] operator-capacity storage is unavailable or out of date; falling back to legacy reservation reads. Run backend db:migrate to apply migration 0028_table_booking_operator_capacity.sql. Error: ${detail}`,
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
