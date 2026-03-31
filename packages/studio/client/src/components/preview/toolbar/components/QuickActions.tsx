import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Image,
  Loader2,
  MoreHorizontal,
  Plug,
  Rocket,
  RotateCcw,
  Save,
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
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  buildProjectStudioPath,
  getHostAppOrigin,
  openEmbeddedStudioPath,
  openUrlInNewTab,
} from "../hostNavigation";

interface QuickActionsProps {
  projectSlug: string | undefined;
  selectedVersion: number;
  previewMode?: "static" | "devserver";
  originalUrl: string | null | undefined;
  copied: boolean;
  publicPreviewEnabled: boolean;
  handleCopy: () => void;
  handleOpenPreviewUrl: () => void;
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
  previewMode,
  originalUrl,
  copied,
  publicPreviewEnabled,
  handleCopy,
  handleOpenPreviewUrl,
  handleRestartDevServer,
  isRestartingDevServer,
  devServerRestartKind,
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
  const desktopActionGap = 6;
  const compactDesktopActionWidth = 30;
  const snapshotsExpandedWidth = 112;
  const publishExpandedWidth = 88;
  const desktopIconButtonClass = "h-[30px] w-[30px] p-0";
  const desktopActionsWidth =
    (projectSlug
      ? snapshotsExpandedWidth + desktopActionGap + publishExpandedWidth + desktopActionGap
      : 0) +
    compactDesktopActionWidth;
  const publishTitle = isPublished
    ? publishStatus?.domain
      ? `Published: ${publishStatus.domain}`
      : publishStatus?.lastTag
        ? `Published: ${publishStatus.lastTag}`
        : "Published"
    : publishStatus?.mode === "connected"
      ? "Publish site"
      : "Create a git tag";

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

  const expandableActionClass = cn(
    "group h-[30px] w-[30px] justify-start gap-0 overflow-hidden rounded-lg px-0 text-muted-foreground transition-[width,background-color,color] duration-200 ease-out hover:w-[var(--toolbar-expanded-width)] hover:bg-muted/60 hover:text-foreground",
  );

  const expandableActionLabelClass =
    "overflow-hidden whitespace-nowrap text-[13px] font-medium max-w-0 pl-0 pr-0 opacity-0 transition-[max-width,opacity,padding] duration-200 ease-out group-hover:max-w-24 group-hover:pl-0.5 group-hover:pr-2.5 group-hover:opacity-100";

  const expandableActionStyle = (expandedWidth: number): CSSProperties =>
    ({
      ["--toolbar-expanded-width" as const]: `${expandedWidth}px`,
    }) as CSSProperties;

  const renderExpandableDesktopAction = ({
    label,
    title,
    icon,
    expandedWidth,
    onClick,
    iconBadge,
  }: {
    label: string;
    title: string;
    icon: ReactNode;
    expandedWidth: number;
    onClick: () => void;
    iconBadge?: ReactNode;
  }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={expandableActionClass}
      style={expandableActionStyle(expandedWidth)}
      title={title}
    >
      <span className="relative flex h-[30px] w-[30px] shrink-0 items-center justify-center">
        {icon}
        {iconBadge}
      </span>
      <span aria-hidden="true" className={expandableActionLabelClass}>
        {label}
      </span>
      <span className="sr-only">{label}</span>
    </Button>
  );

  return (
    <>
      <div
        className="hidden sm:flex items-center justify-end gap-1.5"
        style={{ width: `${desktopActionsWidth}px` }}
      >
        {/* Snapshots button */}
        {projectSlug &&
          renderExpandableDesktopAction({
            label: "Snapshots",
            title: "Snapshots & History",
            expandedWidth: snapshotsExpandedWidth,
            onClick: () => setHistoryPanelOpen(true),
            icon: <Save className="w-4 h-4" />,
            iconBadge: hasGitChanges ? (
              <span
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500"
                aria-hidden="true"
              />
            ) : undefined,
          })}

        {/* Publish button */}
        {projectSlug &&
          renderExpandableDesktopAction({
            label: "Publish",
            title: publishTitle,
            expandedWidth: publishExpandedWidth,
            onClick: () => setPublishDialogOpen(true),
            icon: (
              <>
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
              </>
            ),
          })}

        {/* More Actions Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={desktopIconButtonClass}
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
            <DropdownMenuItem
              onClick={handleOpenPreviewUrl}
              disabled={!canCopyPreviewUrl}
            >
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
                    onClick={() => openUrlInNewTab(originalUrl)}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View Original Website
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleOpenPlugins}>
                  <Plug className="w-4 h-4 mr-2" />
                  Plugins
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
      </div>

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
