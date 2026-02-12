import { createContext, useContext, useEffect, useState } from "react";
import {
  isColorTheme,
  isTheme,
  type ColorTheme,
  type Theme,
} from "@vivd/shared/types";

function getThemeFromQuery(): Theme | null {
  const value = new URLSearchParams(window.location.search).get("theme");
  return isTheme(value) ? value : null;
}

function getColorThemeFromQuery(): ColorTheme | null {
  const value = new URLSearchParams(window.location.search).get("colorTheme");
  return isColorTheme(value) ? value : null;
}

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
  const [theme, setThemeState] = useState<Theme>(() => {
    const fromQuery = getThemeFromQuery();
    if (fromQuery) return fromQuery;
    const fromStorage = localStorage.getItem(storageKey);
    return isTheme(fromStorage) ? fromStorage : defaultTheme;
  });
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(
    () => {
      const fromQuery = getColorThemeFromQuery();
      if (fromQuery) return fromQuery;
      const fromStorage = localStorage.getItem(colorThemeStorageKey);
      return isColorTheme(fromStorage) ? fromStorage : defaultColorTheme;
    }
  );
  const [hostThemeInitialized, setHostThemeInitialized] = useState(
    () => window.parent === window
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

  useEffect(() => {
    localStorage.setItem(storageKey, theme);
  }, [storageKey, theme]);

  // Apply color theme
  useEffect(() => {
    const root = window.document.documentElement;

    if (colorTheme === "clean") {
      root.removeAttribute("data-color-theme");
    } else {
      root.setAttribute("data-color-theme", colorTheme);
    }
  }, [colorTheme]);

  useEffect(() => {
    localStorage.setItem(colorThemeStorageKey, colorTheme);
  }, [colorTheme, colorThemeStorageKey]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (window.parent === window) return;
      if (event.data?.type !== "vivd:host:theme") return;

      const nextTheme = event.data?.theme;
      const nextColorTheme = event.data?.colorTheme;

      if (isTheme(nextTheme)) {
        setThemeState((prev) => (prev === nextTheme ? prev : nextTheme));
      }
      if (isColorTheme(nextColorTheme)) {
        setColorThemeState((prev) =>
          prev === nextColorTheme ? prev : nextColorTheme
        );
      }
      setHostThemeInitialized(true);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (window.parent === window) return;
    if (!hostThemeInitialized) return;
    window.parent.postMessage(
      { type: "vivd:studio:theme", theme, colorTheme },
      "*"
    );
  }, [hostThemeInitialized, theme, colorTheme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setThemeState(theme);
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
