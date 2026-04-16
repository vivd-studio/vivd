import type { ColorTheme } from "@vivd/shared/types";

export type ColorThemeOption = {
  value: ColorTheme;
  label: string;
  preview: [string, string];
};

export const COLOR_THEME_OPTIONS: ColorThemeOption[] = [
  { value: "vivd-sharp", label: "Vivd Sharp", preview: ["#059669", "#f59e0b"] },
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
