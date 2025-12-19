import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Layers,
  ChevronDown,
  Smartphone,
  Monitor,
  Edit3,
  MoreHorizontal,
  Globe,
  FolderOpen,
  MessageSquare,
  Download,
  LogOut,
  Settings,
  X,
  Menu,
  Sun,
  Moon,
  Laptop,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { usePreview } from "./PreviewContext";
import { DEVICE_PRESETS } from "./types";
import { ModeToggle } from "@/components/mode-toggle";
import { authClient } from "@/lib/auth-client";
import { useTheme } from "@/components/theme-provider";

export function PreviewToolbar() {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const { setTheme, theme } = useTheme();

  const handleLogout = async () => {
    await authClient.signOut();
    navigate("/login");
  };
  const {
    projectSlug,
    originalUrl,
    copied,
    selectedVersion,
    mobileView,
    setMobileView,
    selectedDevice,
    setSelectedDevice,
    editMode,
    hasUnsavedChanges,
    fullUrl,
    versions,
    hasMultipleVersions,
    handleVersionSelect,
    handleCopy,
    handleRefresh,
    toggleEditMode,
    assetsOpen,
    setAssetsOpen,
    chatOpen,
    setChatOpen,
    handleClose,
  } = usePreview();

  // Mobile menu content for actions
  const MobileActionsMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 md:hidden">
          <Menu className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* View Controls Group */}
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setMobileView(false)}>
          <Monitor className="w-4 h-4 mr-2" />
          Desktop View
          {!mobileView && <Check className="w-4 h-4 ml-auto" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMobileView(true)}>
          <Smartphone className="w-4 h-4 mr-2" />
          Mobile View
          {mobileView && <Check className="w-4 h-4 ml-auto" />}
        </DropdownMenuItem>

        {mobileView && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Smartphone className="w-4 h-4 mr-2" />
              Device: {selectedDevice.name}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {DEVICE_PRESETS.map((device) => (
                <DropdownMenuItem
                  key={device.name}
                  onClick={() => setSelectedDevice(device)}
                >
                  {selectedDevice.name === device.name && (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  <span
                    className={
                      selectedDevice.name === device.name ? "" : "ml-6"
                    }
                  >
                    {device.name}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {device.width}×{device.height}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />

        {/* Actions Group */}
        {projectSlug && (
          <>
            <DropdownMenuLabel>Panels</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setAssetsOpen(!assetsOpen)}>
              <FolderOpen className="w-4 h-4 mr-2" />
              {assetsOpen ? "Hide Assets" : "Show Assets"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setChatOpen(!chatOpen)}>
              <MessageSquare className="w-4 h-4 mr-2" />
              {chatOpen ? "Hide Agent" : "Show Agent"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={toggleEditMode}
              disabled={hasUnsavedChanges && !editMode}
            >
              <Edit3 className="w-4 h-4 mr-2" />
              {editMode ? "Stop Editing" : "Edit Text"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Quick Actions */}
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuItem onClick={handleRefresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh Preview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopy}>
          <Copy className="w-4 h-4 mr-2" />
          {copied ? "Copied!" : "Copy Link"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(fullUrl, "_blank")}>
          <ExternalLink className="w-4 h-4 mr-2" />
          Open in New Tab
        </DropdownMenuItem>

        {projectSlug && (
          <>
            <DropdownMenuItem
              onClick={() => {
                const baseUrl = import.meta.env.VITE_BACKEND_URL || "";
                window.open(
                  `${baseUrl}/api/download/${projectSlug}/${selectedVersion}`,
                  "_blank"
                );
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Download as ZIP
            </DropdownMenuItem>
            {originalUrl && (
              <DropdownMenuItem
                onClick={() => window.open(originalUrl, "_blank")}
              >
                <Globe className="w-4 h-4 mr-2" />
                View Original Website
              </DropdownMenuItem>
            )}
          </>
        )}

        <DropdownMenuSeparator />

        {/* Theme */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === "light" ? (
              <Sun className="w-4 h-4 mr-2" />
            ) : theme === "dark" ? (
              <Moon className="w-4 h-4 mr-2" />
            ) : (
              <Laptop className="w-4 h-4 mr-2" />
            )}
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="w-4 h-4 mr-2" />
              Light
              {theme === "light" && <Check className="w-4 h-4 ml-auto" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="w-4 h-4 mr-2" />
              Dark
              {theme === "dark" && <Check className="w-4 h-4 ml-auto" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Laptop className="w-4 h-4 mr-2" />
              System
              {theme === "system" && <Check className="w-4 h-4 ml-auto" />}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* User Options */}
        {session && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {session.user.name}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {session.user.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to="/vivd-studio/settings" className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <header className="px-2 md:px-4 py-2.5 border-b flex flex-row items-center gap-1 md:gap-2 shrink-0 z-10 bg-background overflow-x-auto">
      {/* Left Section: App Icon + Preview Identity */}
      <img
        src="/favicon-transparent.svg"
        alt="vivd"
        className="h-6 w-6 shrink-0"
      />

      {/* Separator - hidden on mobile */}
      <div className="hidden sm:block h-5 w-px bg-border mx-1" />

      <div className="flex items-center gap-1 md:gap-2 shrink-0">
        <span className="hidden sm:inline font-medium text-muted-foreground">
          Preview
        </span>
        {projectSlug && hasMultipleVersions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Badge
                variant="secondary"
                className="shrink-0 text-xs px-2 py-0.5 font-normal cursor-pointer hover:bg-secondary/80 transition-colors"
                title={`Click to select from ${versions.length} versions`}
              >
                <Layers className="w-3 h-3 mr-1" />v{selectedVersion}
                <ChevronDown className="w-3 h-3 ml-1" />
              </Badge>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Select Version</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {versions.map((v) => (
                <DropdownMenuItem
                  key={v.version}
                  onClick={() => handleVersionSelect(v.version)}
                  className={selectedVersion === v.version ? "bg-accent" : ""}
                >
                  <Check
                    className={`w-4 h-4 mr-2 ${
                      selectedVersion === v.version
                        ? "opacity-100"
                        : "opacity-0"
                    }`}
                  />
                  <span>v{v.version}</span>
                  <span
                    className={`ml-auto text-xs ${
                      v.status === "completed"
                        ? "text-green-600"
                        : v.status === "failed"
                        ? "text-red-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    {v.status === "completed"
                      ? "✓"
                      : v.status === "failed"
                      ? "✗"
                      : "..."}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : projectSlug ? (
          <Badge
            variant="secondary"
            className="shrink-0 text-xs px-2 py-0.5 font-normal"
          >
            <Layers className="w-3 h-3 mr-1" />v{selectedVersion}
          </Badge>
        ) : null}
      </div>

      {/* Separator - hidden on mobile */}
      <div className="hidden md:block h-5 w-px bg-border mx-1" />

      {/* Center Section: View Controls - hidden on mobile */}
      <div className="hidden md:flex items-center gap-1">
        {/* Viewport Toggle */}
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={!mobileView ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMobileView(false)}
                className="rounded-r-none px-2.5"
              >
                <Monitor className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Desktop View</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={mobileView ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMobileView(true)}
                className="rounded-l-none border-l-0 px-2.5"
              >
                <Smartphone className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mobile View</TooltipContent>
          </Tooltip>
        </div>

        {/* Device Selector (only when mobile view) */}
        {mobileView && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1 text-xs h-8">
                {selectedDevice.name}
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Select Device</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {DEVICE_PRESETS.map((device) => (
                <DropdownMenuItem
                  key={device.name}
                  onClick={() => setSelectedDevice(device)}
                  className={
                    selectedDevice.name === device.name ? "bg-accent" : ""
                  }
                >
                  <Check
                    className={`w-4 h-4 mr-2 ${
                      selectedDevice.name === device.name
                        ? "opacity-100"
                        : "opacity-0"
                    }`}
                  />
                  <span>{device.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {device.width}×{device.height}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Separator - hidden on mobile */}
      <div className="hidden md:block h-5 w-px bg-border mx-1" />

      {/* Edit Controls - hidden on mobile */}
      {projectSlug && (
        <div className="hidden md:flex items-center gap-1">
          {/* Assets button */}
          <Button
            variant={assetsOpen ? "secondary" : "outline"}
            size="sm"
            onClick={() => setAssetsOpen(!assetsOpen)}
            className={`h-8 ${
              !assetsOpen
                ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white border-none"
                : ""
            }`}
          >
            <FolderOpen className="w-4 h-4 mr-1.5" />
            <span className="hidden lg:inline">Assets</span>
          </Button>

          {/* Edit button - disabled when in edit mode or when there are unsaved changes */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant={editMode ? "secondary" : "outline"}
                  size="sm"
                  onClick={toggleEditMode}
                  disabled={hasUnsavedChanges && !editMode}
                  className={`h-8 ${
                    !editMode && !hasUnsavedChanges
                      ? "bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white border-none"
                      : ""
                  }`}
                >
                  <Edit3 className="w-4 h-4 mr-1.5" />
                  <span className="hidden lg:inline">
                    {editMode ? "Editing..." : "Edit Text"}
                  </span>
                </Button>
              </span>
            </TooltipTrigger>
            {hasUnsavedChanges && !editMode && (
              <TooltipContent>
                Save or discard image changes first
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      )}

      {/* Right Section: Panel Toggles + Quick Actions (pushed to right) */}
      <div className="flex items-center gap-1 ml-auto shrink-0">
        {/* Panel Toggles - hidden on mobile */}
        {projectSlug && (
          <>
            <Button
              variant={chatOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => setChatOpen(!chatOpen)}
              className={`hidden md:flex h-8 ${
                !chatOpen
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white border-none"
                  : ""
              }`}
            >
              <MessageSquare className="w-4 h-4 mr-1.5" />
              <span className="hidden lg:inline">Agent</span>
            </Button>

            <div className="hidden md:block h-5 w-px bg-border mx-1" />
          </>
        )}

        {/* Quick actions - hidden on small screens */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              className="hidden sm:flex h-8 w-8 p-0"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh Preview</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="hidden sm:flex h-8 w-8 p-0"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied!" : "Copy Link"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(fullUrl, "_blank")}
              className="hidden sm:flex h-8 w-8 p-0"
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open in New Tab</TooltipContent>
        </Tooltip>

        {/* More Actions Dropdown - hidden on mobile */}
        {projectSlug && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="hidden sm:flex h-8 w-8 p-0"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  const baseUrl = import.meta.env.VITE_BACKEND_URL || "";
                  window.open(
                    `${baseUrl}/api/download/${projectSlug}/${selectedVersion}`,
                    "_blank"
                  );
                }}
              >
                <Download className="w-4 h-4 mr-2" />
                Download as ZIP
              </DropdownMenuItem>
              {originalUrl && (
                <DropdownMenuItem
                  onClick={() => window.open(originalUrl, "_blank")}
                >
                  <Globe className="w-4 h-4 mr-2" />
                  View Original Website
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Separator - hidden on mobile */}
        <div className="hidden md:block h-5 w-px bg-border mx-1" />

        {/* Theme Toggle - hidden on mobile */}
        <div className="hidden md:block">
          <ModeToggle />
        </div>

        {/* Profile Avatar - hidden on mobile */}
        {session && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="hidden md:flex relative h-8 w-8 rounded-full"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage
                    src={session.user.image || undefined}
                    alt={session.user.name}
                  />
                  <AvatarFallback>
                    {session.user.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {session.user.name}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {session.user.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/vivd-studio/settings" className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Separator - hidden on mobile */}
        <div className="hidden md:block h-5 w-px bg-border mx-1" />

        {/* Mobile Menu Button */}
        <MobileActionsMenu />

        {/* Close/Back Button - always visible */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="h-8 w-8 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back to Dashboard</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
