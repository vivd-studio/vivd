import { useEffect, useState } from "react";

export type FreshnessTone = "fresh" | "warm" | "stale";

export interface FreshnessResult {
  ageSeconds: number;
  tone: FreshnessTone;
  label: string;
}

export function useFreshness(
  lastSuccessAt: number | null,
  pollIntervalMs: number,
  hasError: boolean,
): FreshnessResult {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  if (lastSuccessAt === null) {
    return {
      ageSeconds: 0,
      tone: hasError ? "stale" : "warm",
      label: hasError ? "no data" : "loading…",
    };
  }

  const ageMs = Math.max(0, now - lastSuccessAt);
  const ageSeconds = Math.round(ageMs / 1_000);

  let tone: FreshnessTone = "fresh";
  if (hasError || ageMs > pollIntervalMs * 2) tone = "stale";
  else if (ageMs > pollIntervalMs) tone = "warm";

  let label: string;
  if (ageSeconds < 10) label = "just now";
  else if (ageSeconds < 60) label = `${ageSeconds}s ago`;
  else if (ageSeconds < 3600) label = `${Math.floor(ageSeconds / 60)}m ago`;
  else label = `${Math.floor(ageSeconds / 3600)}h ago`;

  return { ageSeconds, tone, label };
}
