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
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  History,
  Image,
  Loader2,
  MoreHorizontal,
  RefreshCw,
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

interface QuickActionsProps {
  projectSlug: string | undefined;
  selectedVersion: number;
  fullUrl: string;
  originalUrl: string | null | undefined;
  copied: boolean;
  publicPreviewEnabled: boolean;
  handleCopy: () => void;
  handleRefresh: () => void;
  historyPanelOpen: boolean;
  setHistoryPanelOpen: (value: boolean) => void;
  publishDialogOpen: boolean;
  setPublishDialogOpen: (value: boolean) => void;
  hasGitChanges: boolean;
  isPublished: boolean;
  publishStatus?: {
    mode?: "connected" | "standalone";
    domain?: string | null;
    lastTag?: string | null;
  };
  gradientId?: string;
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
}

export function QuickActions({
  projectSlug,
  selectedVersion,
  fullUrl,
  originalUrl,
  copied,
  publicPreviewEnabled,
  handleCopy,
  handleRefresh,
  historyPanelOpen,
  setHistoryPanelOpen,
  setPublishDialogOpen,
  hasGitChanges,
  isPublished,
  publishStatus,
  gradientId = "favicon-gradient",
  embedded,
  onHardRestart,
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
                  stroke: `url(#${gradientId})`,
                }}
              />
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

      {/* Refresh button */}
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
