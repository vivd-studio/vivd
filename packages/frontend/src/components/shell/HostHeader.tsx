import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Link, type LinkProps } from "react-router-dom";
import { ModeToggle } from "@/components/theme";
import { BreadcrumbLink } from "@vivd/ui";

import { cn } from "@/lib/utils";
import { HeaderProfileMenu } from "./HeaderProfileMenu";
import {
  NAVIGATION_SEARCH_SHORTCUT_LABEL,
  useNavigationSearch,
} from "./navigationSearchContext";

type HostHeaderProps = {
  leadingAccessory?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  endAccessory?: ReactNode;
  showSearch?: boolean;
  showModeToggle?: boolean;
  showProfileMenu?: boolean;
  className?: string;
};

export function HostHeader({
  leadingAccessory,
  leading,
  trailing,
  endAccessory,
  showSearch = false,
  showModeToggle = true,
  showProfileMenu = true,
  className,
}: HostHeaderProps) {
  const showChrome =
    showSearch || showModeToggle || showProfileMenu || Boolean(endAccessory);

  return (
    <div
      className={cn(
        "flex min-h-[var(--vivd-shell-header-height)] items-center gap-2",
        className,
      )}
    >
      {leadingAccessory ? (
        <div className="flex shrink-0 items-center gap-2">
          {leadingAccessory}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {leading}
      </div>

      {trailing ? (
        <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
      ) : null}

      {showChrome ? (
        <div className="flex shrink-0 items-center gap-1.5">
          {showSearch ? <HeaderSearchTrigger /> : null}
          {showModeToggle ? <ModeToggle /> : null}
          {showProfileMenu ? <HeaderProfileMenu /> : null}
          {endAccessory}
        </div>
      ) : null}
    </div>
  );
}

type HeaderBreadcrumbLinkProps = LinkProps & {
  children: ReactNode;
  className?: string;
};

export function HeaderBreadcrumbTextLink({
  children,
  className,
  ...props
}: HeaderBreadcrumbLinkProps) {
  return (
    <BreadcrumbLink asChild>
      <Link
        className={cn(
          "text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:underline focus-visible:underline-offset-4",
          className,
        )}
        {...props}
      >
        {children}
      </Link>
    </BreadcrumbLink>
  );
}

function HeaderSearchTrigger() {
  const { openSearch } = useNavigationSearch();

  return (
    <button
      type="button"
      aria-label="Open search"
      onClick={openSearch}
      className="flex h-8 items-center gap-2 rounded-md border border-border/70 bg-surface-sunken px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-panel hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Search className="size-4" />
      <span className="hidden sm:inline">Search</span>
      <span className="hidden text-xs font-medium text-muted-foreground/80 md:inline">
        {NAVIGATION_SEARCH_SHORTCUT_LABEL}
      </span>
    </button>
  );
}
