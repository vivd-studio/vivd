import {
  isProjectVersionManualStatus,
  type ProjectVersionManualStatus,
} from "@vivd/shared/types";
import type { ProjectSource } from "../ProjectCard.types";

export type ProjectStatusBadgeVariant =
  | "neutral"
  | "info"
  | "success"
  | "warn"
  | "danger";

export interface ManualProjectStatusOption {
  value: ProjectVersionManualStatus;
  label: string;
  description: string;
}

const MANUAL_PROJECT_STATUS_LABELS: Record<ProjectVersionManualStatus, string> =
  {
    completed: "Completed",
    failed: "Failed",
    initial_generation_paused: "Paused",
  };

const MANUAL_PROJECT_STATUS_DESCRIPTIONS: Record<
  ProjectVersionManualStatus,
  string
> = {
  completed:
    "Use when the site is usable and the current project status is simply stale.",
  failed:
    "Use when the run genuinely failed and should stop being treated as in progress.",
  initial_generation_paused:
    "Use when a scratch bootstrap run stopped early but should remain resumable in Studio.",
};

export function isStudioAccessibleProjectStatus(
  status: string | null | undefined,
): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "initial_generation_paused" ||
    status === "starting_studio" ||
    status === "generating_initial_site"
  );
}

export function getManualProjectStatusOptions(
  source?: ProjectSource,
): ManualProjectStatusOption[] {
  const values: ProjectVersionManualStatus[] =
    source === "scratch"
      ? ["completed", "failed", "initial_generation_paused"]
      : ["completed", "failed"];

  return values.map((value) => ({
    value,
    label: MANUAL_PROJECT_STATUS_LABELS[value],
    description: MANUAL_PROJECT_STATUS_DESCRIPTIONS[value],
  }));
}

export function getDefaultManualProjectStatus(
  currentStatus: string | null | undefined,
  source?: ProjectSource,
): ProjectVersionManualStatus {
  if (isProjectVersionManualStatus(currentStatus)) {
    if (currentStatus !== "initial_generation_paused" || source === "scratch") {
      return currentStatus;
    }
  }

  return source === "scratch" ? "initial_generation_paused" : "failed";
}

export function isDevDomain(domain: string): boolean {
  return (
    domain === "localhost" ||
    domain.endsWith(".local") ||
    domain.endsWith(".localhost") ||
    !domain.includes(".")
  );
}

export function getProjectStatusPresentation(status: string): {
  label: string;
  color: ProjectStatusBadgeVariant;
} {
  let label = "Pending";
  let color: ProjectStatusBadgeVariant = "neutral";

  switch (status) {
    case "pending":
      label = "Pending";
      break;
    case "capturing_references":
      label = "Capturing References";
      color = "info";
      break;
    case "scraping":
      label = "Scraping Website";
      color = "info";
      break;
    case "analyzing_images":
      label = "Analyzing Images";
      color = "info";
      break;
    case "starting_studio":
      label = "Starting Studio";
      color = "info";
      break;
    case "generating_initial_site":
      label = "Generating Initial Site";
      color = "info";
      break;
    case "initial_generation_paused":
      label = "Initial Generation Paused";
      color = "warn";
      break;
    case "creating_hero":
      label = "Creating Hero Image";
      color = "info";
      break;
    case "generating_html":
      label = "Generating HTML";
      color = "info";
      break;
    case "completed":
      label = "Completed";
      color = "success";
      break;
    case "failed":
      label = "Failed";
      color = "danger";
      break;
    default:
      label = status;
  }

  return { label, color };
}
