import type { NewsletterCampaignAudience } from "./types";

export function getCampaignAudienceLabel(
  audience: NewsletterCampaignAudience,
  currentMode: "newsletter" | "waitlist",
): string {
  return audience === "mode_confirmed"
    ? `Confirmed (${currentMode})`
    : "All confirmed";
}

export function parseListInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split("\n")
        .flatMap((line) => line.split(","))
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function formatListInput(values: string[]): string {
  return values.join("\n");
}

export function formatDate(value: string | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function downloadCsv(
  filename: string,
  rows: Array<Record<string, unknown>>,
) {
  const keys = Array.from(
    rows.reduce((set, row) => {
      for (const key of Object.keys(row)) set.add(key);
      return set;
    }, new Set<string>()),
  );
  const escape = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const content = [
    keys.join(","),
    ...rows.map((row) => keys.map((key) => escape(row[key])).join(",")),
  ].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
