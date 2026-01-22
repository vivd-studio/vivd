import { Button } from "@/components/ui/button";
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
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  ChevronDown,
  Smartphone,
  Monitor,
  Edit3,
  MoreHorizontal,
  Globe,
  FolderOpen,
  MessageSquare,
  Download,
  Menu,
  Sun,
  Moon,
  Laptop,
  History,
  Rocket,
  Maximize2,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { usePreview } from "./PreviewContext";
import { DEVICE_PRESETS } from "./types";
import { ModeToggle, useTheme } from "@/components/theme";
import { useState } from "react";
import {
  VersionHistoryPanel,
  VersionSelector,
} from "@/components/projects/versioning";
import { PublishDialog } from "@/components/publish/PublishDialog";
import { trpc } from "@/lib/trpc";
import { POLLING_BACKGROUND } from "@/app/config/polling";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { HeaderProfileMenu } from "@/components/shell";

/**
 * EmbeddedStudioToolbar - A unified toolbar for embedded studio views that combines:
 * - Layout elements: SidebarTrigger, Breadcrumbs
 * - PreviewToolbar elements: View controls, edit buttons, actions
 *
 * Replaces the dual-header (Layout header + PreviewToolbar) with a single toolbar.
 */
export function EmbeddedStudioToolbar() {
  const { setTheme, theme } = useTheme();
  const { canUseAgent } = usePermissions();
  const utils = trpc.useUtils();

  // Save/History dialog states
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

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

  const { data: changesData } = trpc.project.gitHasChanges.useQuery(
    { slug: projectSlug!, version: selectedVersion },
    { enabled: !!projectSlug, refetchInterval: POLLING_BACKGROUND },
  );
  const hasGitChanges = changesData?.hasChanges || false;

  // Get publish status
  const { data: publishStatus } = trpc.project.publishStatus.useQuery(
    { slug: projectSlug! },
    { enabled: !!projectSlug },
  );
  const isPublished = publishStatus?.isPublished || false;

  // Load version mutation
  const loadVersionMutation = trpc.project.gitLoadVersion.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      handleRefresh();
      utils.project.gitHistory.invalidate({
        slug: projectSlug!,
        version: selectedVersion,
      });
      utils.project.gitHasChanges.invalidate({
        slug: projectSlug!,
        version: selectedVersion,
      });
      utils.project.gitWorkingCommit.invalidate({
        slug: projectSlug!,
        version: selectedVersion,
      });
    },
    onError: (error) => {
      toast.error(`Failed to load version: ${error.message}`);
    },
  });

  const handleLoadVersion = (commitHash: string) => {
    if (!projectSlug) return;
    loadVersionMutation.mutate({
      slug: projectSlug,
      version: selectedVersion,
      commitHash,
    });
  };

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
            {canUseAgent && (
              <DropdownMenuItem onClick={() => setChatOpen(!chatOpen)}>
                <MessageSquare className="w-4 h-4 mr-2" />
                {chatOpen ? "Hide Agent" : "Show Agent"}
              </DropdownMenuItem>
            )}
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
                  `${baseUrl}/vivd-studio/api/download/${projectSlug}/${selectedVersion}`,
                  "_blank",
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
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Manage</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setPublishDialogOpen(true)}>
              <Rocket className="w-4 h-4 mr-2" />
              {isPublished
                ? `Live at ${publishStatus?.domain}`
                : "Publish to Web"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setHistoryPanelOpen(true)}>
              <History className="w-4 h-4 mr-2" />
              Snapshots & History
              {hasGitChanges && (
                <span className="ml-auto h-2 w-2 bg-amber-500 rounded-full" />
              )}
            </DropdownMenuItem>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <header className="px-2 md:px-4 py-2.5 border-b flex flex-row items-center gap-1 md:gap-2 shrink-0 z-10 bg-background overflow-x-auto">
        {/* Left Section: SidebarTrigger + Breadcrumbs */}
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-4 hidden sm:block" />

        <Breadcrumb className="hidden sm:flex">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/vivd-studio">Projects</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{projectSlug}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Version selector */}
        {projectSlug && (
          <VersionSelector
            selectedVersion={selectedVersion}
            versions={versions}
            onSelect={handleVersionSelect}
            triggerVariant="secondary"
            triggerClassName={
              hasMultipleVersions
                ? "shrink-0 text-xs px-2 py-0.5 font-normal cursor-pointer hover:bg-secondary/80 transition-colors"
                : "shrink-0 text-xs px-2 py-0.5 font-normal"
            }
            triggerTitle={
              hasMultipleVersions
                ? `Click to select from ${versions.length} versions`
                : undefined
            }
            align="start"
            label="Select Version"
          />
        )}

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
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs h-8"
                >
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
                  ? "border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400"
                  : ""
              }`}
            >
              <FolderOpen className="w-4 h-4 mr-1.5" />
              <span className="hidden lg:inline">Assets</span>
            </Button>

            {/* Edit button */}
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
                        ? "border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400"
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
          {projectSlug && canUseAgent && (
            <>
              <Button
                variant={chatOpen ? "secondary" : "outline"}
                size="sm"
                onClick={() => setChatOpen(!chatOpen)}
                className={`hidden md:flex h-8 ${
                  !chatOpen
                    ? "border-violet-500/50 bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400"
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
          {/* Publish Button */}
          {projectSlug && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPublishDialogOpen(true)}
                  className="hidden sm:flex h-8 w-8 p-0"
                >
                  <Rocket
                    className="w-4 h-4"
                    style={{
                      stroke: "url(#favicon-gradient-embedded)",
                    }}
                  />
                  <svg width="0" height="0" className="absolute">
                    <defs>
                      <linearGradient
                        id="favicon-gradient-embedded"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="100%"
                      >
                        <stop offset="0%" stopColor="#10B981" />
                        <stop offset="100%" stopColor="#F59E0B" />
                      </linearGradient>
                    </defs>
                  </svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isPublished
                  ? `Live at ${publishStatus?.domain}`
                  : "Publish to web"}
              </TooltipContent>
            </Tooltip>
          )}

          {/* History/Snapshots button */}
          {projectSlug && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={historyPanelOpen ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setHistoryPanelOpen(true)}
                  className="hidden sm:flex h-8 w-8 p-0 relative"
                >
                  <History className="w-4 h-4" />
                  {hasGitChanges && (
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-amber-500 rounded-full" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {hasGitChanges
                  ? "Snapshots (pending changes)"
                  : "Snapshots & History"}
              </TooltipContent>
            </Tooltip>
          )}

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

          {/* More Actions Dropdown - hidden on mobile */}
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
              <DropdownMenuItem onClick={handleCopy}>
                {copied ? (
                  <Check className="w-4 h-4 mr-2 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4 mr-2" />
                )}
                {copied ? "Copied!" : "Copy URL"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(fullUrl, "_blank")}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in New Tab
              </DropdownMenuItem>
              {projectSlug && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      const baseUrl = import.meta.env.VITE_BACKEND_URL || "";
                      window.open(
                        `${baseUrl}/vivd-studio/api/download/${projectSlug}/${selectedVersion}`,
                        "_blank",
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
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Separator - hidden on mobile */}
          <div className="hidden md:block h-5 w-px bg-border mx-1" />

          {/* Theme Toggle - hidden on mobile */}
          <div className="hidden md:block">
            <ModeToggle />
          </div>

          {/* Profile Menu */}
          <HeaderProfileMenu />

          {/* Separator - hidden on mobile */}
          <div className="hidden md:block h-5 w-px bg-border mx-1" />

          {/* Mobile Menu Button */}
          <MobileActionsMenu />

          {/* Fullscreen Button */}
          {projectSlug && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  asChild
                >
                  <Link to={`/vivd-studio/projects/${projectSlug}/fullscreen`}>
                    <Maximize2 className="w-4 h-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fullscreen</TooltipContent>
            </Tooltip>
          )}

          {/* Close Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleClose}
              >
                <X className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Version History Panel */}
      {projectSlug && (
        <VersionHistoryPanel
          open={historyPanelOpen}
          onOpenChange={setHistoryPanelOpen}
          projectSlug={projectSlug}
          version={selectedVersion}
          onLoadVersion={handleLoadVersion}
          onRefresh={handleRefresh}
        />
      )}

      {/* Publish Dialog */}
      {projectSlug && (
        <PublishDialog
          open={publishDialogOpen}
          onOpenChange={setPublishDialogOpen}
          projectSlug={projectSlug}
          version={selectedVersion}
          onPublished={() => {
            utils.project.publishStatus.invalidate({ slug: projectSlug });
          }}
        />
      )}
    </>
  );
}
