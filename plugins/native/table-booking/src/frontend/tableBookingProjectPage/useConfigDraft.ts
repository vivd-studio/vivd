import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import type {
  TableBookingDateOverride,
  TableBookingPluginConfig,
  TableBookingSchedulePeriod,
  TableBookingWeeklyScheduleEntry,
} from "./types";
import {
  createDefaultPeriod,
  formatListInput,
  getDateOverride,
  getWeekdayFromIsoDate,
  getWeeklyScheduleEntry,
  normalizeDateOverrides,
  normalizeWeeklySchedule,
  parseListInput,
  removeDateOverrideByDate,
  setWeeklySchedulePeriods,
  sortPeriods,
  upsertDateOverride,
} from "./utils";

export type TableBookingConfigDraftState = {
  timezone: string;
  setTimezone: Dispatch<SetStateAction<string>>;
  sourceHostsInput: string;
  setSourceHostsInput: Dispatch<SetStateAction<string>>;
  redirectHostsInput: string;
  setRedirectHostsInput: Dispatch<SetStateAction<string>>;
  notificationRecipientsInput: string;
  setNotificationRecipientsInput: Dispatch<SetStateAction<string>>;
  partyMin: string;
  setPartyMin: Dispatch<SetStateAction<string>>;
  partyMax: string;
  setPartyMax: Dispatch<SetStateAction<string>>;
  leadTimeMinutes: string;
  setLeadTimeMinutes: Dispatch<SetStateAction<string>>;
  bookingHorizonDays: string;
  setBookingHorizonDays: Dispatch<SetStateAction<string>>;
  defaultDurationMinutes: string;
  defaultDurationMinutesNumber: number;
  setDefaultDurationMinutes: Dispatch<SetStateAction<string>>;
  cancellationCutoffMinutes: string;
  setCancellationCutoffMinutes: Dispatch<SetStateAction<string>>;
  collectNotes: boolean;
  setCollectNotes: Dispatch<SetStateAction<boolean>>;
  weeklySchedule: TableBookingWeeklyScheduleEntry[];
  setWeeklySchedule: Dispatch<SetStateAction<TableBookingWeeklyScheduleEntry[]>>;
  dateOverrides: TableBookingDateOverride[];
  setDateOverrides: Dispatch<SetStateAction<TableBookingDateOverride[]>>;
  buildDraftConfig: () => TableBookingPluginConfig;
  updateWeeklyPeriod: (
    dayOfWeek: number,
    index: number,
    nextPeriod: TableBookingSchedulePeriod,
  ) => void;
  addWeeklyPeriod: (dayOfWeek: number) => void;
  removeWeeklyPeriod: (dayOfWeek: number, index: number) => void;
  createOverrideFromBase: (date: string) => void;
  markOverrideClosed: (date: string) => void;
  clearOverride: (date: string) => void;
  updateOverridePeriod: (
    date: string,
    index: number,
    nextPeriod: TableBookingSchedulePeriod,
  ) => void;
  addOverridePeriod: (date: string) => void;
  removeOverridePeriod: (date: string, index: number) => void;
};

export function useTableBookingConfigDraft(
  initialConfig: TableBookingPluginConfig | null | undefined,
): TableBookingConfigDraftState {
  const [timezone, setTimezone] = useState("UTC");
  const [sourceHostsInput, setSourceHostsInput] = useState("");
  const [redirectHostsInput, setRedirectHostsInput] = useState("");
  const [notificationRecipientsInput, setNotificationRecipientsInput] =
    useState("");
  const [partyMin, setPartyMin] = useState("1");
  const [partyMax, setPartyMax] = useState("8");
  const [leadTimeMinutes, setLeadTimeMinutes] = useState("120");
  const [bookingHorizonDays, setBookingHorizonDays] = useState("60");
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState("90");
  const [cancellationCutoffMinutes, setCancellationCutoffMinutes] =
    useState("120");
  const [collectNotes, setCollectNotes] = useState(true);
  const [weeklySchedule, setWeeklySchedule] = useState<
    TableBookingWeeklyScheduleEntry[]
  >([]);
  const [dateOverrides, setDateOverrides] = useState<TableBookingDateOverride[]>(
    [],
  );

  useEffect(() => {
    if (!initialConfig) return;

    setTimezone(initialConfig.timezone);
    setSourceHostsInput(formatListInput(initialConfig.sourceHosts ?? []));
    setRedirectHostsInput(
      formatListInput(initialConfig.redirectHostAllowlist ?? []),
    );
    setNotificationRecipientsInput(
      formatListInput(initialConfig.notificationRecipientEmails ?? []),
    );
    setPartyMin(String(initialConfig.partySize?.min ?? 1));
    setPartyMax(String(initialConfig.partySize?.max ?? 8));
    setLeadTimeMinutes(String(initialConfig.leadTimeMinutes ?? 120));
    setBookingHorizonDays(String(initialConfig.bookingHorizonDays ?? 60));
    setDefaultDurationMinutes(
      String(initialConfig.defaultDurationMinutes ?? 90),
    );
    setCancellationCutoffMinutes(
      String(initialConfig.cancellationCutoffMinutes ?? 120),
    );
    setCollectNotes(Boolean(initialConfig.collectNotes));
    setWeeklySchedule(normalizeWeeklySchedule(initialConfig.weeklySchedule ?? []));
    setDateOverrides(normalizeDateOverrides(initialConfig.dateOverrides ?? []));
  }, [initialConfig]);

  const buildDraftConfig = (): TableBookingPluginConfig => ({
    timezone,
    sourceHosts: parseListInput(sourceHostsInput),
    redirectHostAllowlist: parseListInput(redirectHostsInput),
    notificationRecipientEmails: parseListInput(notificationRecipientsInput),
    partySize: {
      min: Number.parseInt(partyMin || "0", 10),
      max: Number.parseInt(partyMax || "0", 10),
    },
    leadTimeMinutes: Number.parseInt(leadTimeMinutes || "0", 10),
    bookingHorizonDays: Number.parseInt(bookingHorizonDays || "0", 10),
    defaultDurationMinutes: Number.parseInt(defaultDurationMinutes || "0", 10),
    cancellationCutoffMinutes: Number.parseInt(
      cancellationCutoffMinutes || "0",
      10,
    ),
    collectNotes,
    weeklySchedule: normalizeWeeklySchedule(weeklySchedule),
    dateOverrides: normalizeDateOverrides(dateOverrides),
  });

  const updateWeeklyPeriod = (
    dayOfWeek: number,
    index: number,
    nextPeriod: TableBookingSchedulePeriod,
  ) => {
    setWeeklySchedule((current) => {
      const entry = getWeeklyScheduleEntry(current, dayOfWeek);
      const nextPeriods = entry.periods.map((period, periodIndex) =>
        periodIndex === index ? nextPeriod : period,
      );
      return setWeeklySchedulePeriods({
        weeklySchedule: current,
        dayOfWeek,
        periods: nextPeriods,
      });
    });
  };

  const addWeeklyPeriod = (dayOfWeek: number) => {
    setWeeklySchedule((current) => {
      const entry = getWeeklyScheduleEntry(current, dayOfWeek);
      return setWeeklySchedulePeriods({
        weeklySchedule: current,
        dayOfWeek,
        periods: [...entry.periods, createDefaultPeriod()],
      });
    });
  };

  const removeWeeklyPeriod = (dayOfWeek: number, index: number) => {
    setWeeklySchedule((current) => {
      const entry = getWeeklyScheduleEntry(current, dayOfWeek);
      return setWeeklySchedulePeriods({
        weeklySchedule: current,
        dayOfWeek,
        periods: entry.periods.filter((_, periodIndex) => periodIndex !== index),
      });
    });
  };

  const createOverrideFromBase = (date: string) => {
    const dayOfWeek = getWeekdayFromIsoDate(date);
    const basePeriods = getWeeklyScheduleEntry(weeklySchedule, dayOfWeek).periods;

    setDateOverrides((current) =>
      upsertDateOverride({
        dateOverrides: current,
        override: {
          date,
          closed: false,
          periods:
            basePeriods.length > 0
              ? sortPeriods(basePeriods)
              : [createDefaultPeriod()],
        },
      }),
    );
  };

  const markOverrideClosed = (date: string) => {
    setDateOverrides((current) =>
      upsertDateOverride({
        dateOverrides: current,
        override: {
          date,
          closed: true,
        },
      }),
    );
  };

  const clearOverride = (date: string) => {
    setDateOverrides((current) => removeDateOverrideByDate(current, date));
  };

  const updateOverridePeriod = (
    date: string,
    index: number,
    nextPeriod: TableBookingSchedulePeriod,
  ) => {
    setDateOverrides((current) => {
      const override = getDateOverride(current, date) ?? {
        date,
        closed: false,
        periods: [createDefaultPeriod()],
      };
      const nextPeriods = (override.periods ?? []).map((period, periodIndex) =>
        periodIndex === index ? nextPeriod : period,
      );
      return upsertDateOverride({
        dateOverrides: current,
        override: {
          ...override,
          closed: false,
          periods: nextPeriods,
        },
      });
    });
  };

  const addOverridePeriod = (date: string) => {
    setDateOverrides((current) => {
      const override = getDateOverride(current, date) ?? {
        date,
        closed: false,
        periods: [],
      };
      return upsertDateOverride({
        dateOverrides: current,
        override: {
          ...override,
          closed: false,
          periods: [...(override.periods ?? []), createDefaultPeriod()],
        },
      });
    });
  };

  const removeOverridePeriod = (date: string, index: number) => {
    setDateOverrides((current) => {
      const override = getDateOverride(current, date);
      if (!override) return current;

      const nextPeriods = (override.periods ?? []).filter(
        (_, periodIndex) => periodIndex !== index,
      );

      return upsertDateOverride({
        dateOverrides: current,
        override:
          nextPeriods.length > 0
            ? {
                ...override,
                closed: false,
                periods: nextPeriods,
              }
            : {
                date,
                closed: true,
              },
      });
    });
  };

  return {
    timezone,
    setTimezone,
    sourceHostsInput,
    setSourceHostsInput,
    redirectHostsInput,
    setRedirectHostsInput,
    notificationRecipientsInput,
    setNotificationRecipientsInput,
    partyMin,
    setPartyMin,
    partyMax,
    setPartyMax,
    leadTimeMinutes,
    setLeadTimeMinutes,
    bookingHorizonDays,
    setBookingHorizonDays,
    defaultDurationMinutes,
    defaultDurationMinutesNumber: Number.parseInt(defaultDurationMinutes || "90", 10),
    setDefaultDurationMinutes,
    cancellationCutoffMinutes,
    setCancellationCutoffMinutes,
    collectNotes,
    setCollectNotes,
    weeklySchedule,
    setWeeklySchedule,
    dateOverrides,
    setDateOverrides,
    buildDraftConfig,
    updateWeeklyPeriod,
    addWeeklyPeriod,
    removeWeeklyPeriod,
    createOverrideFromBase,
    markOverrideClosed,
    clearOverride,
    updateOverridePeriod,
    addOverridePeriod,
    removeOverridePeriod,
  };
}
