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
  Rocket,
  RefreshCw,
  Smartphone,
  Sun,
  Trash2,
} from "lucide-react";
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
import { useState } from "react";
import { DEVICE_PRESETS } from "../../types";
import type { DevicePreset } from "../../types";

interface MobileActionsMenuProps {
  // View state
  mobileView: boolean;
  setMobileView: (value: boolean) => void;
  selectedDevice: DevicePreset;
  setSelectedDevice: (device: DevicePreset) => void;

  // Project state
  projectSlug: string | undefined;
  selectedVersion: number;
  originalUrl: string | null | undefined;
  fullUrl: string;
  copied: boolean;
  publicPreviewEnabled: boolean;

  // Edit state
  assetsOpen: boolean;
  setAssetsOpen: (value: boolean) => void;
  chatOpen: boolean;
  setChatOpen: (value: boolean) => void;
  editMode: boolean;
  hasUnsavedChanges: boolean;
  toggleEditMode: () => void;

  // Actions
  handleRefresh: () => void;
  handleCopy: () => void;
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

  // Theme
  theme: string;
  setTheme: (theme: "light" | "dark" | "system") => void;

  // Permissions
  canUseAgent: boolean;

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
  mobileView,
  setMobileView,
  selectedDevice,
  setSelectedDevice,
  projectSlug,
  selectedVersion,
  originalUrl,
  fullUrl,
  copied,
  publicPreviewEnabled,
  assetsOpen,
  setAssetsOpen,
  chatOpen,
  setChatOpen,
  editMode,
  hasUnsavedChanges,
  toggleEditMode,
  handleRefresh,
  handleCopy,
  setPublishDialogOpen,
  setHistoryPanelOpen,
  hasGitChanges,
  isPublished,
  publishStatus,
  theme,
  setTheme,
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
  const getHostAppOrigin = () => {
    const params = new URLSearchParams(window.location.search);

    const hostOrigin = params.get("hostOrigin");
    if (hostOrigin) {
      try {
        return new URL(hostOrigin).origin;
      } catch {
        // Ignore invalid values.
      }
    }

    const returnTo = params.get("returnTo");
    if (returnTo) {
      try {
        return new URL(returnTo).origin;
      } catch {
        // Ignore invalid values.
      }
    }

    if (document.referrer) {
      try {
        return new URL(document.referrer).origin;
      } catch {
        // Ignore invalid values.
      }
    }

    return window.location.origin;
  };

  const handleDownloadZip = () => {
    if (!projectSlug) return;
    const origin = getHostAppOrigin();
    const url = `${origin}/vivd-studio/api/download/${encodeURIComponent(projectSlug)}/${selectedVersion}`;
    window.open(url, "_blank", "noopener,noreferrer");
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

        {/* Panels Group */}
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
        <DropdownMenuItem onClick={handleCopy} disabled={!canCopyPreviewUrl}>
          <Copy className="w-4 h-4 mr-2" />
          {copied
            ? "Copied!"
            : publicPreviewEnabled
              ? "Copy preview URL"
              : "Preview URL disabled"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(fullUrl, "_blank")}>
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
                onClick={() => window.open(originalUrl, "_blank")}
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
              <History className="w-4 h-4 mr-2" />
              Snapshots & History
              {hasGitChanges && (
                <span className="ml-auto h-2 w-2 bg-amber-500 rounded-full" />
              )}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
