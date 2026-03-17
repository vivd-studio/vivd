import * as React from "react";

export type NavigationSearchContextValue = {
  isOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
};

export const NAVIGATION_SEARCH_SHORTCUT_LABEL = "Cmd/Ctrl+K";

export const NavigationSearchContext = React.createContext<NavigationSearchContextValue | null>(
  null,
);

export function useNavigationSearch() {
  const context = React.useContext(NavigationSearchContext);
  if (!context) {
    throw new Error("useNavigationSearch must be used within NavigationSearchProvider.");
  }

  return context;
}
