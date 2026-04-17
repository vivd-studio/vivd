import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import type {
  TableBookingCapacityAdjustmentRecord,
  TableBookingCapacityMode,
  TableBookingDateOverride,
  TableBookingWeeklyScheduleEntry,
} from "./types";
import { resolveScheduleForDate } from "./utils";

export type TableBookingCapacityAdjustmentEditorState = {
  editingAdjustmentId: string | null;
  adjustmentStartTime: string;
  setAdjustmentStartTime: Dispatch<SetStateAction<string>>;
  adjustmentEndTime: string;
  setAdjustmentEndTime: Dispatch<SetStateAction<string>>;
  adjustmentMode: TableBookingCapacityMode;
  setAdjustmentMode: Dispatch<SetStateAction<TableBookingCapacityMode>>;
  adjustmentCapacityValue: string;
  setAdjustmentCapacityValue: Dispatch<SetStateAction<string>>;
  adjustmentReason: string;
  setAdjustmentReason: Dispatch<SetStateAction<string>>;
  resetCapacityAdjustmentForm: (date?: string) => void;
  startEditingCapacityAdjustment: (
    adjustment: TableBookingCapacityAdjustmentRecord,
  ) => void;
};

export function useTableBookingCapacityAdjustmentEditor(options: {
  selectedDate: string;
  weeklySchedule: TableBookingWeeklyScheduleEntry[];
  dateOverrides: TableBookingDateOverride[];
}): TableBookingCapacityAdjustmentEditorState {
  const { selectedDate, weeklySchedule, dateOverrides } = options;
  const [editingAdjustmentId, setEditingAdjustmentId] = useState<string | null>(
    null,
  );
  const [adjustmentStartTime, setAdjustmentStartTime] = useState("17:00");
  const [adjustmentEndTime, setAdjustmentEndTime] = useState("19:00");
  const [adjustmentMode, setAdjustmentMode] =
    useState<TableBookingCapacityMode>("cover_holdback");
  const [adjustmentCapacityValue, setAdjustmentCapacityValue] = useState("4");
  const [adjustmentReason, setAdjustmentReason] = useState("");

  const resetCapacityAdjustmentForm = (date = selectedDate) => {
    const scheduleForDate = resolveScheduleForDate({
      weeklySchedule,
      dateOverrides,
      date,
    });
    const firstPeriod = scheduleForDate.periods[0];
    setEditingAdjustmentId(null);
    setAdjustmentStartTime(firstPeriod?.startTime ?? "17:00");
    setAdjustmentEndTime(firstPeriod?.endTime ?? "19:00");
    setAdjustmentMode("cover_holdback");
    setAdjustmentCapacityValue("4");
    setAdjustmentReason("");
  };

  const startEditingCapacityAdjustment = (
    adjustment: TableBookingCapacityAdjustmentRecord,
  ) => {
    setEditingAdjustmentId(adjustment.id);
    setAdjustmentStartTime(adjustment.startTime);
    setAdjustmentEndTime(adjustment.endTime);
    setAdjustmentMode(adjustment.mode);
    setAdjustmentCapacityValue(
      adjustment.capacityValue ? String(adjustment.capacityValue) : "",
    );
    setAdjustmentReason(adjustment.reason ?? "");
  };

  useEffect(() => {
    if (!editingAdjustmentId) {
      resetCapacityAdjustmentForm(selectedDate);
    }
  }, [selectedDate, editingAdjustmentId, weeklySchedule, dateOverrides]);

  return {
    editingAdjustmentId,
    adjustmentStartTime,
    setAdjustmentStartTime,
    adjustmentEndTime,
    setAdjustmentEndTime,
    adjustmentMode,
    setAdjustmentMode,
    adjustmentCapacityValue,
    setAdjustmentCapacityValue,
    adjustmentReason,
    setAdjustmentReason,
    resetCapacityAdjustmentForm,
    startEditingCapacityAdjustment,
  };
}
