import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarChart3,
  Check,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  History,
  Image,
  Laptop,
  Loader2,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  Plug,
  Rocket,
  RefreshCw,
  Save,
  Smartphone,
  TabletSmartphone,
  Sun,
  Trash2,
} from "lucide-react";
import type { ColorTheme, Theme } from "@vivd/shared/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  COLOR_THEME_OPTIONS,
  ThemeIndicator,
} from "@/components/theme/color-theme-options";
import { useState } from "react";
import { DEVICE_PRESETS } from "../../types";
import type { DevicePreset, ViewportMode } from "../../types";
import {
  buildProjectStudioPath,
  getHostAppOrigin,
  openEmbeddedStudioPath,
  openUrlInNewTab,
} from "../hostNavigation";

interface MobileActionsMenuProps {
  // View state
  viewportMode: ViewportMode;
  setViewportMode: (mode: ViewportMode) => void;
  selectedDevice: DevicePreset;
  setSelectedDevice: (device: DevicePreset) => void;

  // Project state
  projectSlug: string | undefined;
  selectedVersion: number;
  originalUrl: string | null | undefined;
  copied: boolean;
  publicPreviewEnabled: boolean;
  currentPreviewPath: string;
  navigatePreviewPath: (path: string) => void;

  // Edit state
  assetsOpen: boolean;
  setAssetsOpen: (value: boolean) => void;
  chatOpen: boolean;
  setChatOpen: (value: boolean) => void;
  sessionHistoryOpen: boolean;
  setSessionHistoryOpen: (value: boolean) => void;
  editMode: boolean;
  hasUnsavedChanges: boolean;
  toggleEditMode: () => void;

  // Actions
  handleRefresh: () => void;
  handleCopy: () => void;
  handleOpenPreviewUrl: () => void;
  setPublishDialogOpen: (value: boolean) => void;
  setHistoryPanelOpen: (value: boolean) => void;

  // Status
  hasGitChanges: boolean;
  isPublished: boolean;
  publishStatus?: {
    mode?: "connected" | "standalone";
    domain?: string | null;
    lastTag?: string | null;
  };
  onOpenAnalytics?: () => void;

  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  colorTheme: ColorTheme;
  setColorTheme: (colorTheme: ColorTheme) => void;

  // Permissions
  canUseAgent: boolean;

  // Dev server actions
  previewMode?: "static" | "devserver";
  handleRestartDevServer?: (options?: { clean?: boolean }) => void;
  isRestartingDevServer?: boolean;
  devServerRestartKind?: "restart" | "clean" | null;

  // Embedded actions
  embedded?: boolean;
  onHardRestart?: () => void;

  // Connected-mode actions
  isConnectedMode?: boolean;
  handleTogglePreviewUrl?: () => void;
  isTogglingPreviewUrl?: boolean;
  handleRegenerateThumbnail?: () => void;
  isRegeneratingThumbnail?: boolean;
  handleDeleteProject?: () => void;
  isDeletingProject?: boolean;

  // Optional: User menu items (for PreviewToolbar)
  userMenuContent?: React.ReactNode;
}

export function MobileActionsMenu({
  viewportMode,
  setViewportMode,
  selectedDevice,
  setSelectedDevice,
  projectSlug,
  selectedVersion,
  originalUrl,
  copied,
  publicPreviewEnabled,
  currentPreviewPath,
  navigatePreviewPath,
  assetsOpen,
  setAssetsOpen,
  chatOpen,
  setChatOpen,
  sessionHistoryOpen,
  setSessionHistoryOpen,
  editMode,
  hasUnsavedChanges,
  toggleEditMode,
  handleRefresh,
  handleCopy,
  handleOpenPreviewUrl,
  setPublishDialogOpen,
  setHistoryPanelOpen,
  hasGitChanges,
  isPublished,
  publishStatus,
  onOpenAnalytics,
  theme,
  setTheme,
  colorTheme,
  setColorTheme,
  previewMode,
  handleRestartDevServer,
  isRestartingDevServer,
  devServerRestartKind,
  embedded,
  onHardRestart,
  isConnectedMode,
  handleTogglePreviewUrl,
  isTogglingPreviewUrl,
  handleRegenerateThumbnail,
  isRegeneratingThumbnail,
  handleDeleteProject,
  isDeletingProject,
  canUseAgent,
  userMenuContent,
}: MobileActionsMenuProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const canCopyPreviewUrl = Boolean(projectSlug) && publicPreviewEnabled;
  const isEditDisabled = hasUnsavedChanges && !editMode;
  const editLabel = editMode ? "Stop Editing" : "Edit Text";

  const handleDownloadZip = () => {
    if (!projectSlug) return;
    const origin = getHostAppOrigin();
    const url = `${origin}/vivd-studio/api/download/${encodeURIComponent(projectSlug)}/${selectedVersion}`;
    openUrlInNewTab(url);
  };

  const handleOpenPlugins = () => {
    if (!projectSlug) return;
    openEmbeddedStudioPath(
      buildProjectStudioPath(projectSlug, "plugins"),
      embedded,
    );
  };

  const handleOpenAnalytics = () => {
    if (onOpenAnalytics) {
      onOpenAnalytics();
      return;
    }
    if (!projectSlug) return;
    openEmbeddedStudioPath(
      buildProjectStudioPath(projectSlug, "analytics"),
      embedded,
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 md:hidden">
            <Menu className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
        {/* View Controls Group */}
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setViewportMode("desktop")}>
          <Monitor className="w-4 h-4 mr-2" />
          Desktop View
          {viewportMode === "desktop" && <Check className="w-4 h-4 ml-auto" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setViewportMode("tablet")}>
          <TabletSmartphone className="w-4 h-4 mr-2" />
          Tablet View
          {viewportMode === "tablet" && <Check className="w-4 h-4 ml-auto" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setViewportMode("mobile")}>
          <Smartphone className="w-4 h-4 mr-2" />
          Mobile View
          {viewportMode === "mobile" && <Check className="w-4 h-4 ml-auto" />}
        </DropdownMenuItem>

        {viewportMode === "mobile" && (
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

        <DropdownMenuItem onClick={() => navigatePreviewPath(currentPreviewPath)}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh current route
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Panels Group */}
        {projectSlug && (
          <>
            <DropdownMenuLabel>Panels</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setAssetsOpen(!assetsOpen)}>
              <FolderOpen className="w-4 h-4 mr-2" />
              {assetsOpen ? "Hide Assets" : "Show Assets"}
            </DropdownMenuItem>
            {canUseAgent && (
              <DropdownMenuItem
                onClick={() => {
                  if (chatOpen && !sessionHistoryOpen) {
                    setChatOpen(false);
                    return;
                  }
                  setChatOpen(true);
                  setSessionHistoryOpen(false);
                }}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                {chatOpen && !sessionHistoryOpen ? "Hide Agent" : "Show Agent"}
              </DropdownMenuItem>
            )}
            {canUseAgent ? (
              <DropdownMenuItem
                onClick={() => {
                  if (chatOpen && sessionHistoryOpen) {
                    setChatOpen(false);
                    return;
                  }
                  setChatOpen(true);
                  setSessionHistoryOpen(true);
                }}
              >
                <History className="w-4 h-4 mr-2" />
                {sessionHistoryOpen ? "Hide sessions" : "Show sessions"}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={toggleEditMode}
              disabled={isEditDisabled}
            >
              <Edit3 className="w-4 h-4 mr-2" />
              {editLabel}
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
        {previewMode === "devserver" && handleRestartDevServer && (
          <>
            <DropdownMenuItem
              onClick={() => handleRestartDevServer()}
              disabled={isRestartingDevServer}
            >
              {isRestartingDevServer && devServerRestartKind === "restart" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Restart dev server
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleRestartDevServer({ clean: true })}
              disabled={isRestartingDevServer}
            >
              {isRestartingDevServer && devServerRestartKind === "clean" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Clean reinstall
            </DropdownMenuItem>
          </>
        )}
        {embedded && onHardRestart && (
          <DropdownMenuItem onClick={onHardRestart}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Hard restart
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleCopy} disabled={!canCopyPreviewUrl}>
          <Copy className="w-4 h-4 mr-2" />
          {copied
            ? "Copied!"
            : publicPreviewEnabled
              ? "Copy preview URL"
              : "Preview URL disabled"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleOpenPreviewUrl}
          disabled={!canCopyPreviewUrl}
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Open in New Tab
        </DropdownMenuItem>
        {projectSlug && (
          <DropdownMenuItem onClick={handleDownloadZip}>
            <Download className="w-4 h-4 mr-2" />
            Download as ZIP
          </DropdownMenuItem>
        )}

        {projectSlug && (
          <>
            {originalUrl && (
              <DropdownMenuItem
                onClick={() => openUrlInNewTab(originalUrl)}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View Original Website
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Manage</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setPublishDialogOpen(true)}>
              <Rocket className="w-4 h-4 mr-2" />
              {isPublished
                ? publishStatus?.domain
                  ? `Published: ${publishStatus.domain}`
                  : publishStatus?.lastTag
                    ? `Published: ${publishStatus.lastTag}`
                    : "Published"
                : publishStatus?.mode === "connected"
                  ? "Publish site"
                  : "Create a git tag"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setHistoryPanelOpen(true)}>
              <Save className="w-4 h-4 mr-2" />
              Snapshots & History
              {hasGitChanges && (
                <span className="ml-auto h-2 w-2 bg-amber-500 rounded-full" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOpenPlugins}>
              <Plug className="w-4 h-4 mr-2" />
              Plugins
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOpenAnalytics}>
              <BarChart3 className="w-4 h-4 mr-2" />
              Analytics
            </DropdownMenuItem>
            {/* Connected-mode actions — see PROJECT_ACTIONS in @vivd/shared */}
            {isConnectedMode && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleTogglePreviewUrl}
                  disabled={isTogglingPreviewUrl}
                >
                  {publicPreviewEnabled ? (
                    <EyeOff className="w-4 h-4 mr-2" />
                  ) : (
                    <Eye className="w-4 h-4 mr-2" />
                  )}
                  {publicPreviewEnabled
                    ? "Disable preview URL"
                    : "Enable preview URL"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleRegenerateThumbnail}
                  disabled={isRegeneratingThumbnail}
                >
                  {isRegeneratingThumbnail ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Image className="w-4 h-4 mr-2" />
                  )}
                  {isRegeneratingThumbnail
                    ? "Regenerating thumbnail..."
                    : "Regenerate thumbnail"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-destructive focus:text-destructive focus:bg-destructive/10"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete project
                </DropdownMenuItem>
              </>
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

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="w-4 h-4 mr-2" />
            Color Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {COLOR_THEME_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setColorTheme(option.value)}
              >
                <ThemeIndicator preview={option.preview} />
                <span>{option.label}</span>
                {colorTheme === option.value && (
                  <Check className="w-4 h-4 ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Optional user menu content (for PreviewToolbar) */}
        {userMenuContent}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete confirmation dialog */}
      {isConnectedMode && (
        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete project?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete <strong>{projectSlug}</strong> and
                all its versions. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingProject}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 dark:border dark:border-destructive/40 dark:bg-destructive/12 dark:text-destructive dark:shadow-none dark:hover:bg-destructive/18 dark:hover:border-destructive/55"
                disabled={isDeletingProject}
                onClick={() => {
                  handleDeleteProject?.();
                  setShowDeleteConfirm(false);
                }}
              >
                {isDeletingProject ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
