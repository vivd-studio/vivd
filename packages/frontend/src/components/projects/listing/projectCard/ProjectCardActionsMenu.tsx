import type { MutableRefObject } from "react";
import type { Measurable } from "@radix-ui/rect";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Image,
  Loader2,
  MoreVertical,
  Pencil,
  Plug,
  RefreshCw,
  Settings2,
  Tags,
  Trash2,
  Type,
} from "lucide-react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@vivd/ui";

import { getProjectPluginShortcuts } from "@/plugins/shortcuts";
import type { Project } from "../ProjectCard.types";

type ProjectPluginShortcut = ReturnType<
  typeof getProjectPluginShortcuts
>[number];

interface ProjectCardActionsMenuProps {
  project: Project;
  publicPreviewEnabled: boolean;
  copied: boolean;
  projectPluginShortcuts: ProjectPluginShortcut[];
  actionsMenuOpen: boolean;
  onActionsMenuOpenChange: (open: boolean) => void;
  suppressActionsCloseAutoFocusRef: MutableRefObject<boolean>;
  actionsMenuItemAnchorRef: MutableRefObject<Measurable>;
  canManagePreview: boolean;
  canRenameProject: boolean;
  canOverrideProjectStatus: boolean;
  isCompleted: boolean;
  isProcessing: boolean;
  isRegenerating: boolean;
  isRenamePending: boolean;
  isTitleUpdatePending: boolean;
  isRegenerateThumbnailPending: boolean;
  isSetPublicPreviewEnabledPending: boolean;
  isSetStatusPending: boolean;
  onOpenPreview: () => void;
  onCopyPreview: () => void;
  onTogglePreviewEnabled: () => void;
  onOpenOriginalWebsite: () => void;
  onOpenPlugins: () => void;
  onOpenPluginShortcut: (path: string) => void;
  onOpenTagsPopoverFromActions: () => void;
  onDownloadZip: () => void;
  onRegenerateThumbnail: () => void;
  onRegenerate: () => void;
  onManageVersions: () => void;
  onOpenPublishDialog: () => void;
  onOpenEditTitleDialog: () => void;
  onOpenRenameDialog: () => void;
  onOpenStatusDialog: () => void;
  onDelete: () => void;
}

export function ProjectCardActionsMenu({
  project,
  publicPreviewEnabled,
  copied,
  projectPluginShortcuts,
  actionsMenuOpen,
  onActionsMenuOpenChange,
  suppressActionsCloseAutoFocusRef,
  actionsMenuItemAnchorRef,
  canManagePreview,
  canRenameProject,
  canOverrideProjectStatus,
  isCompleted,
  isProcessing,
  isRegenerating,
  isRenamePending,
  isTitleUpdatePending,
  isRegenerateThumbnailPending,
  isSetPublicPreviewEnabledPending,
  isSetStatusPending,
  onOpenPreview,
  onCopyPreview,
  onTogglePreviewEnabled,
  onOpenOriginalWebsite,
  onOpenPlugins,
  onOpenPluginShortcut,
  onOpenTagsPopoverFromActions,
  onDownloadZip,
  onRegenerateThumbnail,
  onRegenerate,
  onManageVersions,
  onOpenPublishDialog,
  onOpenEditTitleDialog,
  onOpenRenameDialog,
  onOpenStatusDialog,
  onDelete,
}: ProjectCardActionsMenuProps) {
  const isUrlProject = (project.source || "url") === "url";

  return (
    <DropdownMenu open={actionsMenuOpen} onOpenChange={onActionsMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 z-10 h-7 w-7 text-muted-foreground/60 hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
          disabled={isRenamePending}
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          if (suppressActionsCloseAutoFocusRef.current) {
            event.preventDefault();
            suppressActionsCloseAutoFocusRef.current = false;
          }
        }}
      >
        <DropdownMenuItem
          onClick={onOpenPreview}
          disabled={!isCompleted || !publicPreviewEnabled}
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Open in new tab
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onCopyPreview}
          disabled={!isCompleted || !publicPreviewEnabled}
        >
          {copied ? (
            <Check className="w-4 h-4 mr-2" />
          ) : (
            <Copy className="w-4 h-4 mr-2" />
          )}
          {copied
            ? "Copied!"
            : publicPreviewEnabled
              ? "Copy preview URL"
              : "Preview URL disabled"}
        </DropdownMenuItem>
        {canManagePreview ? (
          <DropdownMenuItem
            onClick={onTogglePreviewEnabled}
            disabled={isSetPublicPreviewEnabledPending}
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
        ) : null}
        {isUrlProject && project.url ? (
          <DropdownMenuItem onClick={onOpenOriginalWebsite}>
            <Globe className="w-4 h-4 mr-2" />
            Original website
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onOpenPlugins}>
          <Plug className="w-4 h-4 mr-2" />
          Plugins
        </DropdownMenuItem>
        {projectPluginShortcuts.map((shortcut) => {
          const ShortcutIcon = shortcut.icon;
          return (
            <DropdownMenuItem
              key={`shortcut-menu-${shortcut.pluginId}`}
              onClick={() => onOpenPluginShortcut(shortcut.path)}
            >
              <ShortcutIcon className="w-4 h-4 mr-2" />
              {shortcut.label}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            const target = event.currentTarget as HTMLElement | null;
            if (!target) return;
            const rect = target.getBoundingClientRect();
            const frozenRect = new DOMRect(rect.x, rect.y, rect.width, 0);
            actionsMenuItemAnchorRef.current = {
              getBoundingClientRect: () => frozenRect,
            };
            suppressActionsCloseAutoFocusRef.current = true;
            onActionsMenuOpenChange(false);
            requestAnimationFrame(() => onOpenTagsPopoverFromActions());
          }}
        >
          <Tags className="w-4 h-4 mr-2" />
          Edit labels
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDownloadZip} disabled={!isCompleted}>
          <Download className="w-4 h-4 mr-2" />
          Download as ZIP
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onRegenerateThumbnail}
          disabled={!isCompleted || isRegenerateThumbnailPending}
        >
          {isRegenerateThumbnailPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Image className="w-4 h-4 mr-2" />
          )}
          {isRegenerateThumbnailPending
            ? "Regenerating thumbnail..."
            : "Regenerate thumbnail"}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={onRegenerate}
          disabled={isProcessing || isRegenerating}
        >
          {isRegenerating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          {isRegenerating ? "Preparing regeneration..." : "Regenerate site"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onManageVersions}>
          <Settings2 className="w-4 h-4 mr-2" />
          Manage versions
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenPublishDialog} disabled={!isCompleted}>
          <Globe className="w-4 h-4 mr-2" />
          {project.publishedDomain ? "Manage publishing" : "Publish site"}
        </DropdownMenuItem>
        {canRenameProject ? (
          <DropdownMenuItem
            onClick={onOpenEditTitleDialog}
            disabled={isTitleUpdatePending || isRenamePending}
          >
            <Type className="w-4 h-4 mr-2" />
            Edit project title
          </DropdownMenuItem>
        ) : null}
        {canRenameProject ? (
          <DropdownMenuItem
            onClick={onOpenRenameDialog}
            disabled={isRenamePending || isTitleUpdatePending}
          >
            <Pencil className="w-4 h-4 mr-2" />
            Rename project slug
          </DropdownMenuItem>
        ) : null}
        {canOverrideProjectStatus ? (
          <DropdownMenuItem
            onClick={onOpenStatusDialog}
            disabled={isSetStatusPending}
          >
            <Pencil className="w-4 h-4 mr-2" />
            Set project status
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={onDelete}
          className="text-destructive focus:text-destructive focus:bg-destructive/10"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
