export const PROJECT_VERSION_MANUAL_STATUS_VALUES = [
  "completed",
  "failed",
  "initial_generation_paused",
] as const;

export type ProjectVersionManualStatus =
  (typeof PROJECT_VERSION_MANUAL_STATUS_VALUES)[number];

export function isProjectVersionManualStatus(
  value: string | null | undefined,
): value is ProjectVersionManualStatus {
  return (
    typeof value === "string" &&
    PROJECT_VERSION_MANUAL_STATUS_VALUES.includes(
      value as ProjectVersionManualStatus,
    )
  );
}
