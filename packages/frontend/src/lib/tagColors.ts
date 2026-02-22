import { useState, useEffect, useCallback } from "react";

export interface TagColor {
  id: string;
  label: string;
  bg: string;       // CSS hex color for the chip background
  text: string;     // CSS hex color for text on the chip
}

export const TAG_COLORS: TagColor[] = [
  { id: "red",    label: "Red",    bg: "#ef4444", text: "#fff" },
  { id: "orange", label: "Orange", bg: "#f97316", text: "#fff" },
  { id: "yellow", label: "Yellow", bg: "#eab308", text: "#fff" },
  { id: "lime",   label: "Lime",   bg: "#84cc16", text: "#fff" },
  { id: "green",  label: "Green",  bg: "#22c55e", text: "#fff" },
  { id: "teal",   label: "Teal",   bg: "#14b8a6", text: "#fff" },
  { id: "sky",    label: "Sky",    bg: "#0ea5e9", text: "#fff" },
  { id: "blue",   label: "Blue",   bg: "#3b82f6", text: "#fff" },
  { id: "indigo", label: "Indigo", bg: "#6366f1", text: "#fff" },
  { id: "violet", label: "Violet", bg: "#8b5cf6", text: "#fff" },
  { id: "pink",   label: "Pink",   bg: "#ec4899", text: "#fff" },
  { id: "slate",  label: "Slate",  bg: "#64748b", text: "#fff" },
];

// Deterministically pick a colour for a tag based on its name so tags that
// have never been explicitly coloured still look nice.
export function getDefaultColorForTag(tag: string): TagColor {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length]!;
}

export function getTagColor(tag: string, colorMap: Record<string, string>): TagColor {
  const id = colorMap[tag];
  return TAG_COLORS.find((c) => c.id === id) ?? getDefaultColorForTag(tag);
}

const STORAGE_KEY = "vivd-tag-colors";
const UPDATE_EVENT = "vivd-tag-colors:updated";

function readStoredColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStoredColors(map: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event(UPDATE_EVENT));
  } catch {
    // ignore storage errors
  }
}

/** React hook that manages tag colors from localStorage. */
export function useTagColors() {
  const [colorMap, setColorMap] = useState<Record<string, string>>(() =>
    readStoredColors(),
  );

  // Sync if another tab changes storage
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setColorMap(readStoredColors());
      }
    }
    function handleColorUpdate() {
      setColorMap(readStoredColors());
    }
    window.addEventListener("storage", handleStorage);
    window.addEventListener(UPDATE_EVENT, handleColorUpdate);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(UPDATE_EVENT, handleColorUpdate);
    };
  }, []);

  const setTagColor = useCallback((tag: string, colorId: string) => {
    setColorMap((prev) => {
      const next = { ...prev, [tag]: colorId };
      writeStoredColors(next);
      return next;
    });
  }, []);

  const getColor = useCallback(
    (tag: string): TagColor => getTagColor(tag, colorMap),
    [colorMap],
  );

  return { colorMap, setTagColor, getColor };
}
