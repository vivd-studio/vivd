import {
  Building2,
  Check,
  ChevronsUpDown,
  LogOut,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage, Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from "@vivd/ui";

import { VivdIcon } from "@/components/common";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ROUTES } from "@/app/router";
import { cn } from "@/lib/utils";
import {
  formatOrgRole,
  formatSidebarVersionLabel,
  type InstanceSoftware,
  type SidebarOrganization,
  type SwitcherOrganization,
} from "./helpers";

type OrganizationSwitcherProps = {
  org: SidebarOrganization;
  organizations: SwitcherOrganization[];
  allowOrganizationChoices: boolean;
  canSelectOrganization: boolean;
  onSelectOrganization: (organizationId: string) => void;
  isSwitching: boolean;
};

export function OrganizationSwitcher({
  org,
  organizations,
  allowOrganizationChoices,
  canSelectOrganization,
  onSelectOrganization,
  isSwitching,
}: OrganizationSwitcherProps) {
  const showSwitcher = allowOrganizationChoices && organizations.length > 1;
  const showPinnedHint = allowOrganizationChoices && !canSelectOrganization;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex size-8 shrink-0 items-center justify-center">
                <VivdIcon className="size-[1.625rem]" strokeWidth={12} />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  vi
                  <span
                    style={{
                      background:
                        "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--chart-2)) 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}
                  >
                    vd
                  </span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {org?.name ?? "Studio"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side="bottom"
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Building2 className="size-4 text-muted-foreground" />
                <span className="truncate font-medium">{org?.name ?? "Organization"}</span>
                {org ? (
                  <Badge
                    variant={org.status === "active" ? "default" : "secondary"}
                    className="ml-auto px-1.5 py-0 text-[10px]"
                  >
                    {org.status}
                  </Badge>
                ) : null}
              </div>
            </DropdownMenuLabel>
            {(showSwitcher || showPinnedHint) ? <DropdownMenuSeparator /> : null}
            {showSwitcher ? (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {canSelectOrganization ? "Switch organization" : "Open organization"}
                </DropdownMenuLabel>
                {organizations.map((entry) => (
                  <DropdownMenuItem
                    key={entry.id}
                    disabled={isSwitching || entry.isActive}
                    onSelect={() => onSelectOrganization(entry.id)}
                  >
                    <div className="flex min-w-0 w-full items-center gap-2">
                      {entry.isActive ? (
                        <Check className="size-4 shrink-0" />
                      ) : (
                        <span className="size-4 shrink-0" />
                      )}
                      <span className="truncate">{entry.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatOrgRole(entry.role)}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
                {showPinnedHint ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                      This host is pinned; selecting another org will redirect.
                    </DropdownMenuItem>
                  </>
                ) : null}
              </>
            ) : showPinnedHint ? (
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                Organization pinned to this domain
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

type SidebarSession = {
  user: {
    name: string;
    email: string;
    image?: string | null;
  };
};

type UserMenuProps = {
  session: SidebarSession;
  onLogout: () => Promise<void>;
};

export function UserMenu({ session, onLogout }: UserMenuProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage
                  src={session.user.image || undefined}
                  alt={session.user.name}
                />
                <AvatarFallback className="rounded-lg">
                  {session.user.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{session.user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {session.user.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side="bottom"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    src={session.user.image || undefined}
                    alt={session.user.name}
                  />
                  <AvatarFallback className="rounded-lg">
                    {session.user.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{session.user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {session.user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void onLogout()}>
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function SidebarVersionIndicator({
  software,
}: {
  software: InstanceSoftware | undefined;
}) {
  const versionLabel = formatSidebarVersionLabel(software);
  const hasUpdate = software?.releaseStatus === "available";
  const latestLabel = software?.latestVersion || software?.latestTag || null;
  const fallbackLabel = "Version";
  const visibleLabel = versionLabel || fallbackLabel;
  const tooltipLabel = versionLabel
    ? hasUpdate && latestLabel
      ? `Vivd ${versionLabel} · Update available (${latestLabel})`
      : `Vivd ${versionLabel}`
    : "Vivd version info unavailable";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={`${ROUTES.SUPERADMIN_BASE}?section=instance#instance-software`}
          aria-label={tooltipLabel}
          className={cn(
            "flex min-h-7 items-center gap-2 rounded-md px-2 text-[10px] text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/40 hover:text-foreground",
            "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
          )}
        >
          <span className="font-medium tracking-[0.08em] group-data-[collapsible=icon]:hidden">
            {visibleLabel}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full transition-colors",
              hasUpdate
                ? "bg-amber-400/90 shadow-[0_0_0_3px_rgba(251,191,36,0.12)]"
                : "bg-muted-foreground/25",
            )}
          />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" align="center">
        <p>{tooltipLabel}</p>
      </TooltipContent>
    </Tooltip>
  );
}
