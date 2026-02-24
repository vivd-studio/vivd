export interface TagColor {
  id: string;
  label: string;
  bg: string;       // CSS hex color for the chip background
  text: string;     // CSS hex color for text on the chip
}

const DEFAULT_TAG_COLORS: TagColor[] = [
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

export const TAG_COLORS: TagColor[] = [
  { id: "maroon",   label: "Maroon",   bg: "#991b1b", text: "#fff" },
  { id: "red",      label: "Red",      bg: "#ef4444", text: "#fff" },
  { id: "salmon",   label: "Salmon",   bg: "#f87171", text: "#111827" },
  { id: "rose",     label: "Rose",     bg: "#f43f5e", text: "#fff" },
  { id: "orange",   label: "Orange",   bg: "#f97316", text: "#fff" },
  { id: "amber",    label: "Amber",    bg: "#f59e0b", text: "#111827" },
  { id: "gold",     label: "Gold",     bg: "#facc15", text: "#111827" },
  { id: "yellow",   label: "Yellow",   bg: "#eab308", text: "#fff" },
  { id: "brown",    label: "Brown",    bg: "#92400e", text: "#fff" },
  { id: "olive",    label: "Olive",    bg: "#65a30d", text: "#fff" },
  { id: "lime",     label: "Lime",     bg: "#84cc16", text: "#fff" },
  { id: "green",    label: "Green",    bg: "#22c55e", text: "#fff" },
  { id: "emerald",  label: "Emerald",  bg: "#10b981", text: "#fff" },
  { id: "mint",     label: "Mint",     bg: "#34d399", text: "#064e3b" },
  { id: "teal",     label: "Teal",     bg: "#14b8a6", text: "#fff" },
  { id: "cyan",     label: "Cyan",     bg: "#06b6d4", text: "#083344" },
  { id: "sky",      label: "Sky",      bg: "#0ea5e9", text: "#fff" },
  { id: "cerulean", label: "Cerulean", bg: "#0284c7", text: "#fff" },
  { id: "blue",     label: "Blue",     bg: "#3b82f6", text: "#fff" },
  { id: "navy",     label: "Navy",     bg: "#1e3a8a", text: "#fff" },
  { id: "indigo",   label: "Indigo",   bg: "#6366f1", text: "#fff" },
  { id: "violet",   label: "Violet",   bg: "#8b5cf6", text: "#fff" },
  { id: "plum",     label: "Plum",     bg: "#7e22ce", text: "#fff" },
  { id: "lavender", label: "Lavender", bg: "#c4b5fd", text: "#312e81" },
  { id: "pink",     label: "Pink",     bg: "#ec4899", text: "#fff" },
  { id: "magenta",  label: "Magenta",  bg: "#d946ef", text: "#fff" },
  { id: "slate",    label: "Slate",    bg: "#64748b", text: "#fff" },
  { id: "gray",     label: "Gray",     bg: "#9ca3af", text: "#111827" },
  { id: "stone",    label: "Stone",    bg: "#78716c", text: "#fff" },
  { id: "charcoal", label: "Charcoal", bg: "#334155", text: "#fff" },
];

// Deterministically pick a colour for a tag based on its name so tags that
// have never been explicitly coloured still look nice.
export function getDefaultColorForTag(tag: string): TagColor {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  // Keep legacy defaults stable while allowing a larger manual palette.
  return DEFAULT_TAG_COLORS[hash % DEFAULT_TAG_COLORS.length]!;
}

export function getTagColor(tag: string, colorMap: Record<string, string>): TagColor {
  const id = colorMap[tag];
  return TAG_COLORS.find((c) => c.id === id) ?? getDefaultColorForTag(tag);
}
