import type { RenderableFileDiffSummary } from "../render/timeline";
import type { DetailedFileDiff } from "./types";

export type ResolvedFileDiffStatus = "added" | "deleted" | "modified";

type FileDiffStatusSource = Pick<RenderableFileDiffSummary, "status"> &
  Partial<Pick<DetailedFileDiff, "before" | "after">>;

export function resolveFileDiffStatus(
  diff: FileDiffStatusSource,
): ResolvedFileDiffStatus {
  if (diff.status === "added" || diff.status === "deleted") {
    return diff.status;
  }

  const before = typeof diff.before === "string" ? diff.before : "";
  const after = typeof diff.after === "string" ? diff.after : "";

  if (before.length === 0 && after.length > 0) {
    return "added";
  }

  if (after.length === 0 && before.length > 0) {
    return "deleted";
  }

  return "modified";
}

export function formatFileDiffStatus(status: ResolvedFileDiffStatus): string {
  if (status === "added") return "Added";
  if (status === "deleted") return "Removed";
  return "Modified";
}
