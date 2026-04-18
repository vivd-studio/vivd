import { useCallback, useEffect, useState } from "react";

export type PresentationMode = "normal" | "hc-light" | "hc-dark";

export const PRESENTATION_MODES: PresentationMode[] = [
  "normal",
  "hc-light",
  "hc-dark",
];

const STORAGE_KEY = "vivd:table-booking:operator:presentation-mode";
const QUERY_FLAG = "mode";

export const PRESENTATION_MODE_LABELS: Record<PresentationMode, string> = {
  normal: "Normal",
  "hc-light": "Bright (HC)",
  "hc-dark": "Dim (HC)",
};

function isPresentationMode(value: unknown): value is PresentationMode {
  return (
    value === "normal" || value === "hc-light" || value === "hc-dark"
  );
}

function readQueryModeOverride(): PresentationMode | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get(QUERY_FLAG);
    return isPresentationMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

function readStoredMode(): PresentationMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isPresentationMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

function readInitialSystemDefault(): PresentationMode {
  if (typeof window === "undefined" || !window.matchMedia) return "normal";
  const prefersMoreContrast = window.matchMedia(
    "(prefers-contrast: more)",
  ).matches;
  const prefersDark = window.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches;
  if (prefersMoreContrast && prefersDark) return "hc-dark";
  if (prefersMoreContrast) return "hc-light";
  return "normal";
}

export function usePresentationMode() {
  const [mode, setModeState] = useState<PresentationMode>(() => {
    return (
      readQueryModeOverride() ?? readStoredMode() ?? readInitialSystemDefault()
    );
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore quota / privacy errors
    }
  }, [mode]);

  const cycleMode = useCallback(() => {
    setModeState((current) => {
      const index = PRESENTATION_MODES.indexOf(current);
      const next = PRESENTATION_MODES[(index + 1) % PRESENTATION_MODES.length];
      return next ?? "normal";
    });
  }, []);

  return {
    mode,
    setMode: setModeState,
    cycleMode,
  };
}
