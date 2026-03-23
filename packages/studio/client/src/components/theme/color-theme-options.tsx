import type { ColorTheme } from "@vivd/shared/types";

export type ColorThemeOption = {
  value: ColorTheme;
  label: string;
  preview: [string, string];
};

export const COLOR_THEME_OPTIONS: ColorThemeOption[] = [
  { value: "clean", label: "Clean", preview: ["#ffffff", "#3b82f6"] },
  { value: "natural", label: "Natural", preview: ["#8b5e3c", "#c9a227"] },
  { value: "vivd-green", label: "Vivd Green", preview: ["#10b981", "#f59e0b"] },
  { value: "vivd-sharp", label: "Vivd Sharp", preview: ["#059669", "#f59e0b"] },
  { value: "ocean", label: "Ocean", preview: ["#0ea5e9", "#14b8a6"] },
  { value: "aurora", label: "Aurora", preview: ["#4f7cff", "#ff2b8a"] },
  { value: "mono", label: "Mono", preview: ["#fafafa", "#0b0b0b"] },
];

export function ThemeIndicator({ preview }: { preview: [string, string] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-full border border-black/10 dark:border-white/20"
        style={{ backgroundColor: preview[0] }}
      />
      <span
        className="h-2.5 w-2.5 rounded-full border border-black/10 dark:border-white/20"
        style={{ backgroundColor: preview[1] }}
      />
    </span>
  );
}
