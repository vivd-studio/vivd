import { createContext, useContext, useEffect, useState } from "react";
import {
  DEFAULT_COLOR_THEME,
  isTheme,
  normalizeColorTheme,
  type ColorTheme,
  type Theme,
} from "@vivd/shared/types";
import {
  parseVivdHostMessage,
  postVivdHostMessage,
} from "@/lib/hostBridge";

type ResolvedTheme = Exclude<Theme, "system">;

function getThemeFromQuery(): Theme | null {
  const value = new URLSearchParams(window.location.search).get("theme");
  return isTheme(value) ? value : null;
}

function getColorThemeFromQuery(): ColorTheme | null {
  const value = new URLSearchParams(window.location.search).get("colorTheme");
  return value === null ? null : normalizeColorTheme(value);
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
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
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  colorTheme: ColorTheme;
  setColorTheme: (colorTheme: ColorTheme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  resolvedTheme: "light",
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
      return normalizeColorTheme(fromStorage, defaultColorTheme);
    }
  );
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    getSystemTheme()
  );
  const [hostThemeInitialized, setHostThemeInitialized] = useState(
    () => window.parent === window
  );
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };

    updateSystemTheme();
    mediaQuery.addEventListener("change", updateSystemTheme);
    return () => mediaQuery.removeEventListener("change", updateSystemTheme);
  }, []);

  // Apply light/dark mode
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    localStorage.setItem(storageKey, theme);
  }, [storageKey, theme]);

  // Apply color theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute("data-color-theme", colorTheme);
  }, [colorTheme]);

  useEffect(() => {
    localStorage.setItem(colorThemeStorageKey, colorTheme);
  }, [colorTheme, colorThemeStorageKey]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = parseVivdHostMessage(event);
      if (message?.type !== "vivd:host:theme") return;

      const nextTheme = message.theme;
      const nextColorTheme = message.colorTheme;

      if (isTheme(nextTheme)) {
        setThemeState((prev) => (prev === nextTheme ? prev : nextTheme));
      }
      setColorThemeState((prev) => {
        const normalizedColorTheme = normalizeColorTheme(
          nextColorTheme,
          defaultColorTheme,
        );
        return prev === normalizedColorTheme ? prev : normalizedColorTheme;
      });
      setHostThemeInitialized(true);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (window.parent === window) return;
    if (!hostThemeInitialized) return;
    postVivdHostMessage({ type: "vivd:studio:theme", theme, colorTheme });
  }, [hostThemeInitialized, theme, colorTheme]);

  const value = {
    theme,
    resolvedTheme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setThemeState(theme);
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
