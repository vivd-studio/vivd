export const THEME_VALUES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEME_VALUES)[number];

export const COLOR_THEME_VALUES = [
  "clean",
  "natural",
  "vivd-green",
  "vivd-sharp",
  "ocean",
] as const;
export type ColorTheme = (typeof COLOR_THEME_VALUES)[number];

export function isTheme(value: unknown): value is Theme {
  return (
    typeof value === "string" &&
    (THEME_VALUES as readonly string[]).includes(value)
  );
}

export function isColorTheme(value: unknown): value is ColorTheme {
  return (
    typeof value === "string" &&
    (COLOR_THEME_VALUES as readonly string[]).includes(value)
  );
}

