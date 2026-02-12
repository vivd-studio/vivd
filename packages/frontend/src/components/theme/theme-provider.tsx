import { createContext, useContext, useEffect, useState } from "react";
import {
  isColorTheme,
  isTheme,
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
  colorTheme: "vivd-sharp",
  setColorTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultColorTheme = "vivd-sharp",
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
      return isColorTheme(fromStorage) ? fromStorage : defaultColorTheme;
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

    if (colorTheme === "clean") {
      root.removeAttribute("data-color-theme");
    } else {
      root.setAttribute("data-color-theme", colorTheme);
    }
  }, [colorTheme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
    colorTheme,
    setColorTheme: (colorTheme: ColorTheme) => {
      localStorage.setItem(colorThemeStorageKey, colorTheme);
      setColorThemeState(colorTheme);
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
