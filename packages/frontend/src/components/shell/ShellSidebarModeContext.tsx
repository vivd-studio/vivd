import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

export type ShellSidebarDesktopMode = "default" | "immersive";

type ShellSidebarModeContextValue = {
  setDesktopMode: (mode: ShellSidebarDesktopMode) => void;
};

const ShellSidebarModeContext =
  createContext<ShellSidebarModeContextValue | null>(null);

export function ShellSidebarModeProvider({
  children,
  setDesktopMode,
}: {
  children: ReactNode;
  setDesktopMode: (mode: ShellSidebarDesktopMode) => void;
}) {
  const value = useMemo(
    () => ({ setDesktopMode }),
    [setDesktopMode],
  );

  return (
    <ShellSidebarModeContext.Provider value={value}>
      {children}
    </ShellSidebarModeContext.Provider>
  );
}

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
