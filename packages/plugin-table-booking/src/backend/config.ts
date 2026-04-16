import { z } from "zod";

const TIME_STRING_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export const tableBookingTimeStringSchema = z
  .string()
  .trim()
  .regex(TIME_STRING_PATTERN, "Time must use HH:MM 24-hour format.");

export const tableBookingIsoDateSchema = z
  .string()
  .trim()
  .regex(ISO_DATE_PATTERN, "Date must use YYYY-MM-DD format.");

export const tableBookingSchedulePeriodSchema = z
  .object({
    startTime: tableBookingTimeStringSchema,
    endTime: tableBookingTimeStringSchema,
    slotIntervalMinutes: z.number().int().min(5).max(180).default(30),
    maxConcurrentCovers: z.number().int().min(1).max(500),
    durationMinutes: z.number().int().min(30).max(480).optional(),
    maxPartySize: z.number().int().min(1).max(50).optional(),
  })
  .superRefine((period, ctx) => {
    if (period.startTime >= period.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "endTime must be after startTime.",
      });
    }
  });

export type TableBookingSchedulePeriod = z.infer<
  typeof tableBookingSchedulePeriodSchema
>;

export const tableBookingWeeklyScheduleEntrySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  periods: z.array(tableBookingSchedulePeriodSchema).max(8).default([]),
});

export type TableBookingWeeklyScheduleEntry = z.infer<
  typeof tableBookingWeeklyScheduleEntrySchema
>;

export const tableBookingDateOverrideSchema = z
  .object({
    date: tableBookingIsoDateSchema,
    closed: z.boolean().default(false),
    periods: z.array(tableBookingSchedulePeriodSchema).max(8).optional(),
  })
  .superRefine((override, ctx) => {
    if (override.closed && override.periods && override.periods.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periods"],
        message: "Closed overrides cannot also define service periods.",
      });
    }
  });

export type TableBookingDateOverride = z.infer<
  typeof tableBookingDateOverrideSchema
>;

function validatePeriods(
  periods: TableBookingSchedulePeriod[],
  pathPrefix: Array<string | number>,
  ctx: z.RefinementCtx,
) {
  const sorted = periods
    .map((period, index) => ({ period, index }))
    .sort((left, right) => left.period.startTime.localeCompare(right.period.startTime));

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const next = sorted[index + 1];
    if (next && current.period.endTime > next.period.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...pathPrefix, current.index, "endTime"],
        message: "Service periods cannot overlap.",
      });
    }
  }
}

export const tableBookingPluginConfigSchema = z
  .object({
    timezone: z
      .string()
      .trim()
      .min(1)
      .refine(isValidTimeZone, "Timezone must be a valid IANA timezone."),
    sourceHosts: z.array(z.string().trim().min(1)).default([]),
    redirectHostAllowlist: z.array(z.string().trim().min(1)).default([]),
    notificationRecipientEmails: z.array(z.string().trim().email()).default([]),
    partySize: z
      .object({
        min: z.number().int().min(1).max(20).default(1),
        max: z.number().int().min(1).max(20).default(8),
      })
      .default({
        min: 1,
        max: 8,
      }),
    leadTimeMinutes: z.number().int().min(0).max(14 * 24 * 60).default(120),
    bookingHorizonDays: z.number().int().min(1).max(365).default(60),
    defaultDurationMinutes: z.number().int().min(30).max(480).default(90),
    cancellationCutoffMinutes: z.number().int().min(0).max(14 * 24 * 60).default(120),
    collectNotes: z.boolean().default(true),
    weeklySchedule: z
      .array(tableBookingWeeklyScheduleEntrySchema)
      .max(7)
      .default([
        {
          dayOfWeek: 5,
          periods: [
            {
              startTime: "17:00",
              endTime: "22:00",
              slotIntervalMinutes: 30,
              maxConcurrentCovers: 28,
            },
          ],
        },
        {
          dayOfWeek: 6,
          periods: [
            {
              startTime: "17:00",
              endTime: "22:00",
              slotIntervalMinutes: 30,
              maxConcurrentCovers: 28,
            },
          ],
        },
      ]),
    dateOverrides: z.array(tableBookingDateOverrideSchema).max(120).default([]),
  })
  .superRefine((config, ctx) => {
    if (config.partySize.max < config.partySize.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partySize", "max"],
        message: "Maximum party size must be greater than or equal to minimum party size.",
      });
    }

    const seenDays = new Set<number>();
    for (const [index, entry] of config.weeklySchedule.entries()) {
      if (seenDays.has(entry.dayOfWeek)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["weeklySchedule", index, "dayOfWeek"],
          message: `Duplicate weekly schedule entry for day ${entry.dayOfWeek}.`,
        });
      }
      seenDays.add(entry.dayOfWeek);
      validatePeriods(entry.periods, ["weeklySchedule", index, "periods"], ctx);
    }

    const seenDates = new Set<string>();
    for (const [index, override] of config.dateOverrides.entries()) {
      if (seenDates.has(override.date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dateOverrides", index, "date"],
          message: `Duplicate date override for ${override.date}.`,
        });
      }
      seenDates.add(override.date);
      validatePeriods(override.periods ?? [], ["dateOverrides", index, "periods"], ctx);
    }
  });

export type TableBookingPluginConfig = z.infer<
  typeof tableBookingPluginConfigSchema
>;
