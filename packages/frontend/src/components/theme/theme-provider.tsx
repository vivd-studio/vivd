import { createContext, useContext, useEffect, useState } from "react";
import {
  DEFAULT_COLOR_THEME,
  isTheme,
  normalizeColorTheme,
  type ColorTheme,
  type Theme,
} from "@vivd/shared/types";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  defaultColorTheme?: ColorTheme;
  storageKey?: string;
  colorThemeStorageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  colorTheme: ColorTheme;
  setColorTheme: (colorTheme: ColorTheme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  colorTheme: DEFAULT_COLOR_THEME,
  setColorTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultColorTheme = DEFAULT_COLOR_THEME,
  storageKey = "vite-ui-theme",
  colorThemeStorageKey = "vite-ui-color-theme",
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => {
      const fromStorage = localStorage.getItem(storageKey);
      return isTheme(fromStorage) ? fromStorage : defaultTheme;
    }
  );
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(
    () => {
      const fromStorage = localStorage.getItem(colorThemeStorageKey);
      return normalizeColorTheme(fromStorage, defaultColorTheme);
    }
  );

  // Apply light/dark mode
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  // Apply color theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute("data-color-theme", colorTheme);
  }, [colorTheme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
    colorTheme,
    setColorTheme: (colorTheme: ColorTheme) => {
      const nextColorTheme = normalizeColorTheme(colorTheme, defaultColorTheme);
      localStorage.setItem(colorThemeStorageKey, nextColorTheme);
      setColorThemeState(nextColorTheme);
    },
  };

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
