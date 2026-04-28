import { createContext, useContext, useEffect } from "react";

export type ShellSidebarDesktopMode = "default" | "immersive";

export type ShellSidebarModeContextValue = {
  setDesktopMode: (mode: ShellSidebarDesktopMode) => void;
};

export const ShellSidebarModeContext =
  createContext<ShellSidebarModeContextValue | null>(null);

export function useShellSidebarDesktopMode(mode: ShellSidebarDesktopMode) {
  const context = useContext(ShellSidebarModeContext);
  const setDesktopMode = context?.setDesktopMode;

  useEffect(() => {
    if (!setDesktopMode) return;

    setDesktopMode(mode);
    return () => {
      setDesktopMode("default");
    };
  }, [mode, setDesktopMode]);
}
