import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { HeaderBreadcrumbTextLink, HostHeader } from "@/components/shell";
import { ROUTES } from "@/app/router";
import type { ResolvedProjectPluginShortcut } from "@/plugins/shortcuts";
import {
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Image,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plug,
  Trash2,
} from "lucide-react";

type EmbeddedStudioHeaderProps = {
  projectSlug?: string;
  sidebarOpen: boolean;
  includeProjectActions?: boolean;
  studioStatusLabel?: string;
  showStudioStartupAction: boolean;
  isHardRestartPending: boolean;
  isStudioRecovering: boolean;
  isRenamePending: boolean;
  previewIframeSrc: string | null;
  publicPreviewEnabled: boolean;
  previewUrlCopied: boolean;
  canManagePreview: boolean;
  isTogglePublicPreviewPending: boolean;
  projectOriginalUrl?: string | null;
  canDownloadSelectedVersion: boolean;
  isRegenerateThumbnailPending: boolean;
  canRenameProject: boolean;
  projectHeaderPluginShortcuts: ResolvedProjectPluginShortcut[];
  onEdit: () => void;
  onOpenPublish: () => void;
  onOpenPlugins: () => void;
  onNavigate: (path: string) => void;
  onCopyPreviewUrl: () => void;
  onTogglePublicPreview: () => void;
  onDownloadZip: () => void;
  onRegenerateThumbnail: () => void;
  onOpenRename: () => void;
  onOpenDelete: () => void;
};

export function EmbeddedStudioHeader({
  projectSlug,
  sidebarOpen,
  includeProjectActions = false,
  studioStatusLabel,
  showStudioStartupAction,
  isHardRestartPending,
  isStudioRecovering,
  isRenamePending,
  previewIframeSrc,
  publicPreviewEnabled,
  previewUrlCopied,
  canManagePreview,
  isTogglePublicPreviewPending,
  projectOriginalUrl,
  canDownloadSelectedVersion,
  isRegenerateThumbnailPending,
  canRenameProject,
  projectHeaderPluginShortcuts,
  onEdit,
  onOpenPublish,
  onOpenPlugins,
  onNavigate,
  onCopyPreviewUrl,
  onTogglePublicPreview,
  onDownloadZip,
  onRegenerateThumbnail,
  onOpenRename,
  onOpenDelete,
}: EmbeddedStudioHeaderProps) {
  const projectActions = includeProjectActions ? (
    <>
      {showStudioStartupAction ? (
        <Button size="sm" disabled className="h-8 rounded-md px-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {isHardRestartPending
            ? "Restarting..."
            : isStudioRecovering
              ? "Reconnecting..."
              : "Starting..."}
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={onEdit}
          disabled={isRenamePending}
          className="h-8 rounded-md px-3"
        >
          Edit
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenPublish}
        disabled={isRenamePending}
        className="h-8 rounded-md px-3"
      >
        Publish
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenPlugins}
        disabled={isRenamePending}
        className="h-8 rounded-md px-3"
      >
        <Plug className="mr-1.5 h-4 w-4" />
        Plugins
      </Button>
      {projectHeaderPluginShortcuts.map((shortcut) => {
        const ShortcutIcon = shortcut.icon;
        return (
          <Button
            key={`header-shortcut-${shortcut.pluginId}`}
            variant="outline"
            size="icon"
            onClick={() => onNavigate(shortcut.path)}
            title={shortcut.label}
            disabled={isRenamePending}
            className="h-8 w-8 rounded-md"
          >
            <ShortcutIcon className="h-4 w-4" />
          </Button>
        );
      })}
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md"
            disabled={isRenamePending}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={onCopyPreviewUrl}
            disabled={!previewIframeSrc || !publicPreviewEnabled || isRenamePending}
          >
            <Copy className="mr-2 h-4 w-4" />
            {publicPreviewEnabled
              ? previewUrlCopied
                ? "Copied!"
                : "Copy preview URL"
              : "Preview URL disabled"}
          </DropdownMenuItem>
          {canManagePreview ? (
            <DropdownMenuItem
              onClick={onTogglePublicPreview}
              disabled={isTogglePublicPreviewPending || isRenamePending}
            >
              {publicPreviewEnabled ? (
                <EyeOff className="mr-2 h-4 w-4" />
              ) : (
                <Eye className="mr-2 h-4 w-4" />
              )}
              {publicPreviewEnabled ? "Disable preview URL" : "Enable preview URL"}
            </DropdownMenuItem>
          ) : null}
          {projectOriginalUrl ? (
            <DropdownMenuItem
              onClick={() => window.open(projectOriginalUrl, "_blank")}
              disabled={isRenamePending}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Original website
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={onDownloadZip}
            disabled={!canDownloadSelectedVersion || isRenamePending}
          >
            <Download className="mr-2 h-4 w-4" />
            Download as ZIP
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onRegenerateThumbnail}
            disabled={
              !canDownloadSelectedVersion ||
              isRegenerateThumbnailPending ||
              isRenamePending
            }
          >
            {isRegenerateThumbnailPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Image className="mr-2 h-4 w-4" />
            )}
            {isRegenerateThumbnailPending
              ? "Regenerating thumbnail..."
              : "Regenerate thumbnail"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onOpenPlugins}
            disabled={isRenamePending}
          >
            <Plug className="mr-2 h-4 w-4" />
            Plugins
          </DropdownMenuItem>
          {projectHeaderPluginShortcuts.map((shortcut) => {
            const ShortcutIcon = shortcut.icon;
            return (
              <DropdownMenuItem
                key={`menu-shortcut-${shortcut.pluginId}`}
                onClick={() => onNavigate(shortcut.path)}
                disabled={isRenamePending}
              >
                <ShortcutIcon className="mr-2 h-4 w-4" />
                {shortcut.label}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          {canRenameProject ? (
            <DropdownMenuItem
              onClick={onOpenRename}
              disabled={isRenamePending}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Rename project slug
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={onOpenDelete}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            disabled={isRenamePending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  ) : null;

  return (
    <HostHeader
      leadingAccessory={
        <SidebarTrigger
          appearance={sidebarOpen ? "panel" : "brand"}
          morphOnHover={false}
          className="rounded-md"
        />
      }
      leading={
        <>
          <div className="min-w-0 truncate text-sm font-medium sm:hidden">
            {projectSlug}
          </div>
          <Breadcrumb className="hidden sm:flex">
            <BreadcrumbList>
              <BreadcrumbItem>
                <HeaderBreadcrumbTextLink to={ROUTES.DASHBOARD}>
                  Projects
                </HeaderBreadcrumbTextLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{projectSlug}</BreadcrumbPage>
              </BreadcrumbItem>
              {studioStatusLabel ? (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <span className="text-sm text-muted-foreground">
                      {studioStatusLabel}
                    </span>
                  </BreadcrumbItem>
                </>
              ) : null}
            </BreadcrumbList>
          </Breadcrumb>
        </>
      }
      trailing={projectActions}
    />
  );
}
