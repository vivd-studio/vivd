import { parseVivdInternalTags } from "./SelectedElementPill";
import type { FollowupBehavior } from "./chatTypes";

export const FOLLOWUP_BEHAVIOR_STORAGE_KEY = "vivd-followup-behavior";

export function getStoredFollowupBehavior(): FollowupBehavior {
  if (typeof window === "undefined") {
    return "steer";
  }

  const stored = window.localStorage.getItem(FOLLOWUP_BEHAVIOR_STORAGE_KEY);
  return stored === "queue" || stored === "steer" ? stored : "steer";
}

export function buildQueuedFollowupPreview(task: string): string {
  const { cleanMessage, internalTags } = parseVivdInternalTags(task);
  const firstMeaningfulLine = cleanMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (firstMeaningfulLine) {
    return firstMeaningfulLine;
  }

  if (internalTags.length > 0) {
    return "[Attachment]";
  }

  return "[Queued follow-up]";
}
