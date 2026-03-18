import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Check,
  Copy,
  BarChart3,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  History,
  Image,
  Loader2,
  MoreHorizontal,
  Plug,
  Rocket,
  RotateCcw,
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
import {
  buildProjectStudioPath,
  getHostAppOrigin,
  openEmbeddedStudioPath,
} from "../hostNavigation";

interface QuickActionsProps {
  projectSlug: string | undefined;
  selectedVersion: number;
  previewMode?: "static" | "devserver";
  fullUrl: string;
  originalUrl: string | null | undefined;
  copied: boolean;
  publicPreviewEnabled: boolean;
  handleCopy: () => void;
  handleRestartDevServer?: (options?: { clean?: boolean }) => void;
  isRestartingDevServer?: boolean;
  devServerRestartKind?: "restart" | "clean" | null;
  setHistoryPanelOpen: (value: boolean) => void;
  setPublishDialogOpen: (value: boolean) => void;
  hasGitChanges: boolean;
  isPublished: boolean;
  publishStatus?: {
    mode?: "connected" | "standalone";
    domain?: string | null;
    lastTag?: string | null;
  };
  analyticsAvailable?: boolean;
  gradientId?: string;
  embedded?: boolean;
  onHardRestart?: () => void;
  pluginsOpen: boolean;
  setPluginsOpen: (value: boolean) => void;

  // Connected-mode actions
  isConnectedMode?: boolean;
  handleTogglePreviewUrl?: () => void;
  isTogglingPreviewUrl?: boolean;
  handleRegenerateThumbnail?: () => void;
  isRegeneratingThumbnail?: boolean;
  handleDeleteProject?: () => void;
  isDeletingProject?: boolean;
}

export function QuickActions({
  projectSlug,
  selectedVersion,
  previewMode,
  fullUrl,
  originalUrl,
  copied,
  publicPreviewEnabled,
  handleCopy,
  handleRestartDevServer,
  isRestartingDevServer,
  devServerRestartKind,
  setHistoryPanelOpen,
  setPublishDialogOpen,
  hasGitChanges,
  isPublished,
  publishStatus,
  analyticsAvailable = false,
  gradientId = "favicon-gradient",
  embedded,
  onHardRestart,
  pluginsOpen,
  setPluginsOpen,
  isConnectedMode,
  handleTogglePreviewUrl,
  isTogglingPreviewUrl,
  handleRegenerateThumbnail,
  isRegeneratingThumbnail,
  handleDeleteProject,
  isDeletingProject,
}: QuickActionsProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const canCopyPreviewUrl = Boolean(projectSlug) && publicPreviewEnabled;

  const handleDownloadZip = () => {
    if (!projectSlug) return;
    const origin = getHostAppOrigin();
    const url = `${origin}/vivd-studio/api/download/${encodeURIComponent(projectSlug)}/${selectedVersion}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleOpenPlugins = () => {
    if (!projectSlug) return;
    setPluginsOpen(!pluginsOpen);
  };

  const handleOpenAnalytics = () => {
    if (!projectSlug) return;
    openEmbeddedStudioPath(
      buildProjectStudioPath(projectSlug, "analytics"),
      embedded,
    );
  };

  return (
    <>
      {/* Analytics button */}
      {projectSlug && analyticsAvailable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenAnalytics}
              className="hidden sm:flex h-8 w-8 p-0"
            >
              <BarChart3 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Analytics</TooltipContent>
        </Tooltip>
      )}

      {/* Publish Button */}
      {projectSlug && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPublishDialogOpen(true)}
              className="hidden h-8 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
            >
              <Rocket
                className="w-4 h-4"
                style={{
                  stroke: `url(#${gradientId})`,
                }}
              />
              <span>Publish</span>
              <svg width="0" height="0" className="absolute">
                <defs>
                  <linearGradient
                    id={gradientId}
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
              ? publishStatus?.domain
                ? `Published: ${publishStatus.domain}`
                : publishStatus?.lastTag
                  ? `Published: ${publishStatus.lastTag}`
                  : "Published"
              : publishStatus?.mode === "connected"
                ? "Publish site"
                : "Create a git tag"}
          </TooltipContent>
        </Tooltip>
      )}

      {/* More Actions Dropdown */}
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
          <DropdownMenuItem onClick={handleCopy} disabled={!canCopyPreviewUrl}>
            {copied ? (
              <Check className="w-4 h-4 mr-2 text-green-600" />
            ) : (
              <Copy className="w-4 h-4 mr-2" />
            )}
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
            <>
              <DropdownMenuItem onClick={handleDownloadZip}>
                <Download className="w-4 h-4 mr-2" />
                Download as ZIP
              </DropdownMenuItem>
              {originalUrl && (
                <DropdownMenuItem
                  onClick={() => window.open(originalUrl, "_blank")}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Original Website
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleOpenPlugins}>
                <Plug className="w-4 h-4 mr-2" />
                {pluginsOpen ? "Hide Plugins" : "Plugins"}
              </DropdownMenuItem>
              {analyticsAvailable ? (
                <DropdownMenuItem onClick={handleOpenAnalytics}>
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Analytics
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => setHistoryPanelOpen(true)}>
                <History className="w-4 h-4 mr-2" />
                Snapshots & History
                {hasGitChanges ? (
                  <span className="ml-auto h-2 w-2 rounded-full bg-amber-500" />
                ) : null}
              </DropdownMenuItem>
            </>
          )}
          {previewMode === "devserver" && projectSlug && handleRestartDevServer && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleRestartDevServer()}
                disabled={Boolean(isRestartingDevServer)}
              >
                {isRestartingDevServer && devServerRestartKind === "restart" ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-2" />
                )}
                Restart dev server
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleRestartDevServer({ clean: true })}
                disabled={Boolean(isRestartingDevServer)}
              >
                {isRestartingDevServer && devServerRestartKind === "clean" ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-2" />
                )}
                Clean reinstall dev server
              </DropdownMenuItem>
            </>
          )}
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowDeleteConfirm(true)}
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete project
              </DropdownMenuItem>
            </>
          )}
          {embedded && onHardRestart && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onHardRestart}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Hard Restart
              </DropdownMenuItem>
            </>
          )}
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
