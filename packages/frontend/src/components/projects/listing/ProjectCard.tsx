import { useState, useEffect, useRef, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import type { Measurable } from "@radix-ui/rect";
import {
  isProjectVersionManualStatus,
  type ProjectVersionManualStatus,
} from "@vivd/shared/types";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Copy,
  Check,
  Loader2,
  Globe,
  Trash2,
  MoreVertical,
  Download,
  ExternalLink,
  Settings2,
  Plug,
  Eye,
  EyeOff,
  Image,
  Pencil,
  RefreshCw,
  Tags,
  Type,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAppConfig } from "@/lib/AppConfigContext";
import { ROUTES } from "@/app/router";
import { getProjectPluginShortcuts } from "@/plugins/shortcuts";
import { getProjectPluginPresentation } from "@/plugins/presentation";

import { VersionSelector } from "../versioning/VersionSelector";
import { VersionManagementPanel } from "../versioning/VersionManagementPanel";
import { PublishSiteDialog } from "../publish/PublishSiteDialog";
import { ProjectTagsPopover, TagChip } from "./ProjectTagsPopover";
import { getTagColor } from "@/lib/tagColors";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface VersionInfo {
  version: number;
  createdAt: string;
  status: string;
  errorMessage?: string;
}

export interface Project {
  slug: string;
  url: string;
  source?: "url" | "scratch";
  title?: string;
  tags?: string[];
  status: string;
  createdAt: string;
  currentVersion?: number;
  totalVersions?: number;
  versions?: VersionInfo[];
  publishedDomain?: string | null;
  publishedVersion?: number | null;
  thumbnailUrl?: string | null;
  publicPreviewEnabled?: boolean;
  enabledPlugins?: string[];
}

interface ProjectCardProps {
  project: Project;
  availableTags: string[];
  tagColorMap: Record<string, string>;
  onRegenerate: (slug: string, version?: number) => void;
  onDelete: (slug: string) => void;
  isRegenerating: boolean;
}

export function isStudioAccessibleProjectStatus(
  status: string | null | undefined,
): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "initial_generation_paused" ||
    status === "starting_studio" ||
    status === "generating_initial_site"
  );
}

const MANUAL_PROJECT_STATUS_LABELS: Record<ProjectVersionManualStatus, string> = {
  completed: "Completed",
  failed: "Failed",
  initial_generation_paused: "Paused",
};

const MANUAL_PROJECT_STATUS_DESCRIPTIONS: Record<
  ProjectVersionManualStatus,
  string
> = {
  completed:
    "Use when the site is usable and the current project status is simply stale.",
  failed:
    "Use when the run genuinely failed and should stop being treated as in progress.",
  initial_generation_paused:
    "Use when a scratch bootstrap run stopped early but should remain resumable in Studio.",
};

export function getManualProjectStatusOptions(source?: "url" | "scratch") {
  const values: ProjectVersionManualStatus[] =
    source === "scratch"
      ? ["completed", "failed", "initial_generation_paused"]
      : ["completed", "failed"];

  return values.map((value) => ({
    value,
    label: MANUAL_PROJECT_STATUS_LABELS[value],
    description: MANUAL_PROJECT_STATUS_DESCRIPTIONS[value],
  }));
}

export function getDefaultManualProjectStatus(
  currentStatus: string | null | undefined,
  source?: "url" | "scratch",
): ProjectVersionManualStatus {
  if (isProjectVersionManualStatus(currentStatus)) {
    if (currentStatus !== "initial_generation_paused" || source === "scratch") {
      return currentStatus;
    }
  }

  return source === "scratch" ? "initial_generation_paused" : "failed";
}

function isDevDomain(domain: string): boolean {
  return (
    domain === "localhost" ||
    domain.endsWith(".local") ||
    domain.endsWith(".localhost") ||
    !domain.includes(".")
  );
}

export function ProjectCard({
  project,
  availableTags,
  tagColorMap,
  onRegenerate,
  onDelete,
  isRegenerating,
}: ProjectCardProps) {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { config } = useAppConfig();
  const { data: membership } = trpc.organization.getMyMembership.useQuery(undefined, {
    enabled: !!session && config.hasHostOrganizationAccess,
  });
  const isSuperAdmin = session?.user?.role === "super_admin";
  const utils = trpc.useUtils();

  const setStatusMutation = trpc.project.setStatus.useMutation({
    onSuccess: (data, variables) => {
      toast.success("Project status updated", {
        description: data.message,
      });
      utils.project.list.invalidate();
      utils.project.status.invalidate({
        slug: variables.slug,
        version: variables.version,
      });
    },
    onError: (error) => {
      toast.error("Status update failed", {
        description: error.message,
      });
    },
  });

  const setCurrentVersionMutation = trpc.project.setCurrentVersion.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to set version", {
        description: error.message,
      });
    },
  });

  const regenerateThumbnailMutation = trpc.project.regenerateThumbnail.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Thumbnail regenerated", {
        description: `${variables.slug} v${variables.version}`,
      });
      utils.project.list.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to regenerate thumbnail", {
        description: error.message,
      });
    },
  });
  const updateTagsMutation = trpc.project.updateTags.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      utils.project.listTags.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to update tags", {
        description: error.message,
      });
    },
  });
  const deleteTagMutation = trpc.project.deleteTag.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      utils.project.listTags.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to delete label", {
        description: error.message,
      });
    },
  });
  const renameTagMutation = trpc.project.renameTag.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      utils.project.listTags.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to rename label", {
        description: error.message,
      });
    },
  });
  const setTagColorMutation = trpc.project.setTagColor.useMutation({
    onSuccess: () => {
      utils.project.listTags.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to update label color", {
        description: error.message,
      });
    },
  });
  const renameSlugMutation = trpc.project.renameSlug.useMutation({
    onSuccess: (data) => {
      toast.success("Project renamed", {
        description: `${data.oldSlug} -> ${data.newSlug}`,
      });
      setShowRenameDialog(false);
      utils.project.list.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to rename project", {
        description: error.message,
      });
    },
  });
  const updateTitleMutation = trpc.project.updateTitle.useMutation({
    onSuccess: (data) => {
      toast.success("Project title updated", {
        description: `New title: ${data.title}`,
      });
      setShowEditTitleDialog(false);
      setIsInlineTitleEditing(false);
      setInlineTitleInput(data.title);
      utils.project.list.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to update project title", {
        description: error.message,
      });
    },
  });

  const getColor = (tag: string) => getTagColor(tag, tagColorMap);

  const [selectedVersion, setSelectedVersion] = useState(
    project.currentVersion || 1,
  );
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [showEditTitleDialog, setShowEditTitleDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [editTitleInput, setEditTitleInput] = useState(project.title ?? "");
  const [inlineTitleInput, setInlineTitleInput] = useState(
    project.title?.trim() || project.slug,
  );
  const [isInlineTitleEditing, setIsInlineTitleEditing] = useState(false);
  const [renameSlugInput, setRenameSlugInput] = useState(project.slug);
  const [showVersionManagement, setShowVersionManagement] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [tagsPopoverOpen, setTagsPopoverOpen] = useState(false);
  const [tagsPopoverSessionKey, setTagsPopoverSessionKey] = useState(0);
  const [tagsPopoverAnchor, setTagsPopoverAnchor] = useState<"tags" | "actions">("tags");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const suppressActionsCloseAutoFocusRef = useRef(false);
  const inlineTitleInputRef = useRef<HTMLInputElement>(null);
  const tagsAreaAnchorRef = useRef<HTMLDivElement>(null);
  const actionsMenuItemAnchorRef = useRef<Measurable>({
    getBoundingClientRect: () => new DOMRect(),
  });
  const [copied, setCopied] = useState(false);
  const publicPreviewEnabled = project.publicPreviewEnabled ?? true;
  const projectPluginShortcuts = getProjectPluginShortcuts({
    enabledPluginIds: project.enabledPlugins ?? [],
    projectSlug: project.slug,
    surface: "project-card",
  });
  const enabledPluginEntries = (project.enabledPlugins ?? []).map((pluginId) =>
    getProjectPluginPresentation(pluginId, project.slug),
  );

  const canManagePreview = membership?.organizationRole !== "client_editor";
  const canRenameProject = membership?.organizationRole !== "client_editor";
  const canOverrideProjectStatus =
    isSuperAdmin ||
    membership?.organizationRole === "owner" ||
    membership?.organizationRole === "admin";
  const isRenamePending = renameSlugMutation.isPending;
  const isTitleUpdatePending = updateTitleMutation.isPending;

  const getPreviewUrl = () => {
    const shareablePath = `/vivd-studio/api/preview/${project.slug}/v${selectedVersion}/`;
    const tenantHost = config.activeOrganizationTenantHost;
    const shareableUrl = tenantHost
      ? new URL(
          shareablePath,
          `${isDevDomain(tenantHost) ? "http" : "https"}://${tenantHost}`,
        )
      : new URL(shareablePath, window.location.origin);
    return shareableUrl.toString();
  };

  const handleCopyPreview = () => {
    if (!publicPreviewEnabled) {
      toast.error("Preview URL is disabled for this project");
      return;
    }
    const absoluteUrl = getPreviewUrl();

    navigator.clipboard.writeText(absoluteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const setPublicPreviewEnabledMutation =
    trpc.project.setPublicPreviewEnabled.useMutation({
      onSuccess: (data) => {
        toast.success(
          data.publicPreviewEnabled ? "Preview URL enabled" : "Preview URL disabled",
        );
        utils.project.list.invalidate();
        utils.project.getExternalPreviewStatus.invalidate({
          slug: project.slug,
          version: selectedVersion,
        });
      },
      onError: (error) => {
        toast.error("Failed to update preview URL setting", {
          description: error.message,
        });
      },
    });

  // Sync selectedVersion with project.currentVersion when it changes
  // This ensures we switch to the new version when one is created
  useEffect(() => {
    if (project.currentVersion && project.currentVersion !== selectedVersion) {
      setSelectedVersion(project.currentVersion);
    }
  }, [project.currentVersion]);

  useEffect(() => {
    setRenameSlugInput(project.slug);
  }, [project.slug]);

  useEffect(() => {
    setEditTitleInput(project.title ?? "");
  }, [project.title]);

  useEffect(() => {
    if (isInlineTitleEditing) return;
    setInlineTitleInput(project.title?.trim() || project.slug);
  }, [isInlineTitleEditing, project.slug, project.title]);

  const hasMultipleVersions = (project.totalVersions || 1) > 1;
  const versions = project.versions || [];

  const handleVersionSelect = (version: number) => {
    setSelectedVersion(version);
    setCurrentVersionMutation.mutate({ slug: project.slug, version });
  };

  const openTagsPopover = (anchor: "tags" | "actions") => {
    setTagsPopoverAnchor(anchor);
    setTagsPopoverSessionKey((current) => current + 1);
    setTagsPopoverOpen(true);
  };

  // Get status for selected version
  const selectedVersionInfo = versions.find(
    (v) => v.version === selectedVersion,
  );
  const selectedVersionStatus =
    selectedVersionInfo?.status ??
    (selectedVersion === project.currentVersion ? project.status : "unknown");
  const manualProjectStatusOptions = getManualProjectStatusOptions(project.source);
  const [manualStatusInput, setManualStatusInput] =
    useState<ProjectVersionManualStatus>(() =>
      getDefaultManualProjectStatus(selectedVersionStatus, project.source),
    );
  const isCompleted =
    selectedVersionStatus === "completed";
  const isFailed =
    selectedVersionStatus === "failed";
  const isInitialGenerationPaused =
    selectedVersionStatus === "initial_generation_paused";
  const isProcessing =
    !isCompleted &&
    !isFailed &&
    !isInitialGenerationPaused &&
    selectedVersionStatus !== "unknown";
  const canOpenStudio = isStudioAccessibleProjectStatus(selectedVersionStatus);
  const totalVersions = project.totalVersions || 1;
  const projectTags = project.tags ?? [];
  const isUrlProject = (project.source || "url") === "url";
  const displayTitle = project.title?.trim() || project.slug;
  const supportingDetail = isUrlProject ? project.url : "";
  const publishedUrl = project.publishedDomain
    ? `${isDevDomain(project.publishedDomain) ? "http" : "https"}://${project.publishedDomain}`
    : null;
  const activeTagsPopoverAnchorRef: RefObject<Measurable> = (
    tagsPopoverAnchor === "actions"
      ? actionsMenuItemAnchorRef
      : tagsAreaAnchorRef
  ) as unknown as RefObject<Measurable>;

  useEffect(() => {
    if (!showStatusDialog) return;
    setManualStatusInput(
      getDefaultManualProjectStatus(selectedVersionStatus, project.source),
    );
  }, [project.source, selectedVersionStatus, showStatusDialog]);

  // Calculate progress and label
  let statusLabel = "Pending";
  let statusColor: "default" | "secondary" | "destructive" | "outline" =
    "secondary";

  switch (selectedVersionStatus) {
    case "pending":
      statusLabel = "Pending";
      break;
    case "capturing_references":
      statusLabel = "Capturing References";
      statusColor = "default";
      break;
    case "scraping":
      statusLabel = "Scraping Website";
      statusColor = "default";
      break;
    case "analyzing_images":
      statusLabel = "Analyzing Images";
      statusColor = "default";
      break;
    case "starting_studio":
      statusLabel = "Starting Studio";
      statusColor = "default";
      break;
    case "generating_initial_site":
      statusLabel = "Generating Initial Site";
      statusColor = "default";
      break;
    case "initial_generation_paused":
      statusLabel = "Initial Generation Paused";
      statusColor = "secondary";
      break;
    case "creating_hero":
      statusLabel = "Creating Hero Image";
      statusColor = "default";
      break;
    case "generating_html":
      statusLabel = "Generating HTML";
      statusColor = "default";
      break;
    case "completed":
      statusLabel = "Completed";
      statusColor = "outline"; // Will be overridden by className for specific green style
      break;
    case "failed":
      statusLabel = "Failed";
      statusColor = "destructive";
      break;
    default:
      statusLabel = selectedVersionStatus;
  }

  const projectStudioRoute =
    selectedVersion > 0
      ? `${ROUTES.PROJECT(project.slug)}?version=${selectedVersion}`
      : ROUTES.PROJECT(project.slug);

  const openProjectStudio = () => {
    navigate(projectStudioRoute);
  };

  const startInlineTitleEdit = () => {
    if (!canRenameProject || isRenamePending || isTitleUpdatePending) return;
    setInlineTitleInput(displayTitle);
    setIsInlineTitleEditing(true);
  };

  const cancelInlineTitleEdit = () => {
    setInlineTitleInput(displayTitle);
    setIsInlineTitleEditing(false);
  };

  const commitInlineTitleEdit = () => {
    if (isTitleUpdatePending) return;

    const nextTitle = inlineTitleInput.trim();
    if (!nextTitle || nextTitle === displayTitle) {
      cancelInlineTitleEdit();
      return;
    }

    setIsInlineTitleEditing(false);
    updateTitleMutation.mutate({
      slug: project.slug,
      title: nextTitle,
    });
  };

  useEffect(() => {
    if (!isInlineTitleEditing) return;

    const frame = window.requestAnimationFrame(() => {
      inlineTitleInputRef.current?.focus();
      inlineTitleInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isInlineTitleEditing]);

  return (
    <>
      <Card
        className={`group relative flex flex-col h-full overflow-hidden transition-all min-h-[160px] bg-card/50 border-border/50 shadow-sm hover:shadow-md ${
          isProcessing
            ? "border-primary/60 ring-1 ring-primary/20 animate-pulse duration-3000"
            : ""
        } ${
          canOpenStudio ? "cursor-pointer hover:border-primary/40 hover:bg-card" : ""
        }`}
        onClick={() => {
          if (canOpenStudio && !isRenamePending) {
            openProjectStudio();
          }
        }}
      >
        <DropdownMenu
          open={actionsMenuOpen}
          onOpenChange={setActionsMenuOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 z-10 h-7 w-7 text-muted-foreground/60 hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
              disabled={isRenamePending}
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onClick={(e) => e.stopPropagation()}
            onCloseAutoFocus={(event) => {
              if (suppressActionsCloseAutoFocusRef.current) {
                event.preventDefault();
                suppressActionsCloseAutoFocusRef.current = false;
              }
            }}
          >
            {/* ── Preview ── */}
            <DropdownMenuItem
              onClick={() => window.open(getPreviewUrl(), "_blank")}
              disabled={!isCompleted || !publicPreviewEnabled}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open in new tab
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleCopyPreview}
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
            {canManagePreview && (
              <DropdownMenuItem
                onClick={() =>
                  setPublicPreviewEnabledMutation.mutate({
                    slug: project.slug,
                    enabled: !publicPreviewEnabled,
                  })
                }
                disabled={setPublicPreviewEnabledMutation.isPending}
              >
                {publicPreviewEnabled ? (
                  <EyeOff className="w-4 h-4 mr-2" />
                ) : (
                  <Eye className="w-4 h-4 mr-2" />
                )}
                {publicPreviewEnabled ? "Disable preview URL" : "Enable preview URL"}
              </DropdownMenuItem>
            )}
            {isUrlProject && project.url && (
              <DropdownMenuItem
                onClick={() => window.open(project.url, "_blank")}
              >
                <Globe className="w-4 h-4 mr-2" />
                Original website
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {/* ── Content & plugins ── */}
            <DropdownMenuItem
              onClick={() => navigate(ROUTES.PROJECT_PLUGINS(project.slug))}
            >
              <Plug className="w-4 h-4 mr-2" />
              Plugins
            </DropdownMenuItem>
            {projectPluginShortcuts.map((shortcut) => {
              const ShortcutIcon = shortcut.icon;
              return (
                <DropdownMenuItem
                  key={`shortcut-menu-${shortcut.pluginId}`}
                  onClick={() => navigate(shortcut.path)}
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
                const frozenRect = new DOMRect(
                  rect.x,
                  rect.y,
                  rect.width,
                  0,
                );
                actionsMenuItemAnchorRef.current = {
                  getBoundingClientRect: () => frozenRect,
                };
                suppressActionsCloseAutoFocusRef.current = true;
                setActionsMenuOpen(false);
                requestAnimationFrame(() => openTagsPopover("actions"));
              }}
            >
              <Tags className="w-4 h-4 mr-2" />
              Edit labels
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const baseUrl = import.meta.env.VITE_BACKEND_URL || "";
                window.open(
                  `${baseUrl}/vivd-studio/api/download/${project.slug}/${selectedVersion}`,
                  "_blank",
                );
              }}
              disabled={!isCompleted}
            >
              <Download className="w-4 h-4 mr-2" />
              Download as ZIP
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                regenerateThumbnailMutation.mutate({
                  slug: project.slug,
                  version: selectedVersion,
                })
              }
              disabled={!isCompleted || regenerateThumbnailMutation.isPending}
            >
              {regenerateThumbnailMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Image className="w-4 h-4 mr-2" />
              )}
              {regenerateThumbnailMutation.isPending
                ? "Regenerating thumbnail..."
                : "Regenerate thumbnail"}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* ── Project management ── */}
            <DropdownMenuItem
              onClick={() => onRegenerate(project.slug, selectedVersion)}
              disabled={isProcessing || isRegenerating}
            >
              {isRegenerating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              {isRegenerating ? "Preparing regeneration..." : "Regenerate site"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowVersionManagement(true)}
            >
              <Settings2 className="w-4 h-4 mr-2" />
              Manage versions
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setPublishDialogOpen(true)}
              disabled={!isCompleted}
            >
              <Globe className="w-4 h-4 mr-2" />
              {project.publishedDomain ? "Manage publishing" : "Publish site"}
            </DropdownMenuItem>
            {canRenameProject && (
              <DropdownMenuItem
                onClick={() => {
                  setEditTitleInput(project.title ?? "");
                  setShowEditTitleDialog(true);
                }}
                disabled={isTitleUpdatePending || renameSlugMutation.isPending}
              >
                <Type className="w-4 h-4 mr-2" />
                Edit project title
              </DropdownMenuItem>
            )}
            {canRenameProject && (
              <DropdownMenuItem
                onClick={() => {
                  setRenameSlugInput(project.slug);
                  setShowRenameDialog(true);
                }}
                disabled={renameSlugMutation.isPending || isTitleUpdatePending}
              >
                <Pencil className="w-4 h-4 mr-2" />
                Rename project slug
              </DropdownMenuItem>
            )}
            {canOverrideProjectStatus && (
              <DropdownMenuItem
                onClick={() => setShowStatusDialog(true)}
                disabled={setStatusMutation.isPending}
              >
                <Pencil className="w-4 h-4 mr-2" />
                Set project status
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => onDelete(project.slug)}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CardHeader className="pl-4 pr-10 pb-3 pt-4">
          <div className="flex min-h-[44px] items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {isInlineTitleEditing ? (
                <Input
                  ref={inlineTitleInputRef}
                  value={inlineTitleInput}
                  onChange={(event) => setInlineTitleInput(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onBlur={() => commitInlineTitleEdit()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitInlineTitleEdit();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelInlineTitleEdit();
                    }
                  }}
                  placeholder="Project title"
                  disabled={isTitleUpdatePending}
                  className="h-8 min-w-0 max-w-[220px]"
                  aria-label={`Edit title for ${project.slug}`}
                />
              ) : (
                <CardTitle
                  className={`truncate text-base font-semibold ${
                    canRenameProject ? "cursor-text" : ""
                  }`}
                  title={displayTitle}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    startInlineTitleEdit();
                  }}
                >
                  {displayTitle}
                </CardTitle>
              )}
              {totalVersions > 0 &&
                (hasMultipleVersions ? (
                  <VersionSelector
                    selectedVersion={selectedVersion}
                    versions={versions}
                    onSelect={handleVersionSelect}
                    stopPropagation
                    triggerVariant="secondary"
                    triggerClassName="shrink-0 text-xs px-1.5 py-0 font-normal cursor-pointer hover:bg-secondary/80 transition-colors"
                    triggerTitle={`Click to select from ${totalVersions} versions`}
                    align="start"
                    label="Select Version"
                    onManageVersions={() => setShowVersionManagement(true)}
                  />
                ) : (
                  <VersionSelector
                    selectedVersion={selectedVersion}
                    versions={versions}
                    onSelect={handleVersionSelect}
                    stopPropagation
                    triggerVariant="secondary"
                    triggerClassName="shrink-0 text-xs px-1.5 py-0 font-normal"
                    triggerTitle={`${totalVersions} version`}
                  />
                ))}
            </div>
            <div className="grid shrink-0 content-start justify-items-end gap-1">
              <ProjectTagsPopover
                key={`${project.slug}:${tagsPopoverSessionKey}`}
                open={tagsPopoverOpen}
                onOpenChange={setTagsPopoverOpen}
                anchorVirtualRef={activeTagsPopoverAnchorRef}
                sideOffset={tagsPopoverAnchor === "actions" ? -6 : 6}
                suppressInitialOutsideInteraction={
                  tagsPopoverOpen && tagsPopoverAnchor === "actions"
                }
                projectTags={projectTags}
                availableTags={availableTags}
                colorMap={tagColorMap}
                isSaving={
                  updateTagsMutation.isPending ||
                  deleteTagMutation.isPending ||
                  renameTagMutation.isPending ||
                  setTagColorMutation.isPending
                }
                onCommitTags={(tags) => {
                  const isUnchanged =
                    tags.length === projectTags.length &&
                    tags.every((tag, index) => projectTags[index] === tag);
                  if (isUnchanged) return;

                  updateTagsMutation.mutate({
                    slug: project.slug,
                    tags,
                  });
                }}
                onDeleteTags={(tags) => {
                  for (const tag of Array.from(new Set(tags))) {
                    deleteTagMutation.mutate({ tag });
                  }
                }}
                onRenameTags={(renames) => {
                  for (const rename of renames) {
                    renameTagMutation.mutate(rename);
                  }
                }}
                onSetTagColor={(tag, colorId) => {
                  setTagColorMutation.mutate({ tag, colorId });
                }}
              >
                <div
                  ref={tagsAreaAnchorRef}
                  className="flex h-[22px] max-w-[200px] cursor-pointer flex-nowrap justify-end gap-1 overflow-hidden text-right"
                  title="Click to edit labels"
                  onClick={(e) => {
                    if (isRenamePending) return;
                    e.stopPropagation();
                    openTagsPopover("tags");
                  }}
                >
                  {projectTags.length > 0 ? (
                    <>
                      {projectTags.slice(0, 4).map((tag) => (
                        <TagChip
                          key={tag}
                          tag={tag}
                          color={getColor(tag)}
                          className="max-w-[84px] shrink truncate py-0.5 text-[10px]"
                        />
                      ))}
                      {projectTags.length > 4 && (
                        <span className="inline-flex shrink-0 items-center rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          +{projectTags.length - 4}
                        </span>
                      )}
                    </>
                  ) : null}
                </div>
              </ProjectTagsPopover>
              <div className="flex min-h-5 items-center justify-end">
                {!isCompleted && (
                  <Badge variant={statusColor} className="shrink-0">
                    {statusLabel}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {supportingDetail ? (
            <div
              className="text-xs text-muted-foreground line-clamp-1"
              title={supportingDetail}
            >
              {supportingDetail}
            </div>
          ) : null}
          <div className={`grid gap-1 ${supportingDetail ? "mt-2" : "mt-1"}`}>
            <div className="flex min-h-[18px] items-center gap-1.5">
              {project.publishedDomain ? (
                <>
                  <Globe className="h-3 w-3 shrink-0 text-green-600" />
                  <a
                    href={publishedUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-xs text-green-600 hover:text-green-700 hover:underline"
                    title={`Published at ${project.publishedDomain}${
                      project.publishedVersion
                        ? ` (v${project.publishedVersion})`
                        : ""
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {project.publishedDomain}
                    {project.publishedVersion && (
                      <span className="ml-1 text-muted-foreground">
                        (v{project.publishedVersion})
                      </span>
                    )}
                  </a>
                </>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-1.5 px-4 grow flex flex-col">
          {isCompleted && project.thumbnailUrl && (
            <div className="w-full aspect-[16/10] rounded-md overflow-hidden bg-muted mb-2">
              <img
                src={project.thumbnailUrl}
                alt={`${project.slug} preview`}
                className="w-full h-full object-cover object-top"
                loading="lazy"
              />
            </div>
          )}

          {isProcessing && (
            <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground grow">
              <div className="flex items-center gap-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium">{statusLabel}...</span>
              </div>
              {canOpenStudio && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    openProjectStudio();
                  }}
                >
                  Open Studio
                </Button>
              )}
              {canOverrideProjectStatus && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowStatusDialog(true);
                  }}
                  disabled={setStatusMutation.isPending}
                >
                  <Settings2
                    className={`w-3 h-3 mr-1 ${
                      setStatusMutation.isPending ? "animate-spin" : ""
                    }`}
                  />
                  {setStatusMutation.isPending ? "Updating..." : "Set status"}
                </Button>
              )}
            </div>
          )}

          {isFailed && (
            <div className="text-sm text-center text-destructive space-y-1 flex flex-col items-center justify-center grow">
              <div className="font-medium">Generation failed</div>
              {selectedVersionInfo?.errorMessage && (
                <div className="text-xs text-muted-foreground">
                  {selectedVersionInfo.errorMessage}
                </div>
              )}
              {canOpenStudio && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    openProjectStudio();
                  }}
                >
                  Open Studio
                </Button>
              )}
              {canOverrideProjectStatus && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowStatusDialog(true);
                  }}
                  disabled={setStatusMutation.isPending}
                >
                  Set status
                </Button>
              )}
            </div>
          )}

          {isInitialGenerationPaused && (
            <div className="text-sm text-center space-y-2 flex flex-col items-center justify-center grow">
              <div className="font-medium text-foreground">
                Initial generation paused
              </div>
              <div className="text-xs text-muted-foreground max-w-[24rem]">
                {selectedVersionInfo?.errorMessage ||
                  "The bootstrap run stopped before finishing. Open Studio to continue the same project from there."}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openProjectStudio();
                }}
              >
                Open Studio
              </Button>
              {canOverrideProjectStatus && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowStatusDialog(true);
                  }}
                  disabled={setStatusMutation.isPending}
                >
                  Set status
                </Button>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter className="pt-2.5 pb-3 px-4 flex items-center justify-end gap-1 border-t border-border/30 mt-auto">
          <TooltipProvider delayDuration={100}>
            {enabledPluginEntries.map((plugin) => {
              const PluginIcon = plugin.icon;
              return (
                <Tooltip key={`footer-plugin-${plugin.pluginId}`}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (plugin.path) navigate(plugin.path);
                      }}
                      disabled={isRenamePending || !plugin.path}
                    >
                      <PluginIcon className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{plugin.title}</TooltipContent>
                </Tooltip>
              );
            })}
            {enabledPluginEntries.length > 0 && (
              <span className="mx-1 h-3.5 w-px bg-border/60 rounded-full" aria-hidden />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(ROUTES.PROJECT_PLUGINS(project.slug));
                  }}
                  disabled={isRenamePending}
                >
                  <Plug className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Plugins</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardFooter>
        {isRenamePending ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Renaming project slug...
            </div>
          </div>
        ) : null}
      </Card>

      <AlertDialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set project status</AlertDialogTitle>
            <AlertDialogDescription>
              Override {project.slug} v{selectedVersion} with a durable status.
              This is available to organization admins and super admins.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <Select
              value={manualStatusInput}
              onValueChange={(value) =>
                setManualStatusInput(value as ProjectVersionManualStatus)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {manualProjectStatusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {
                manualProjectStatusOptions.find(
                  (option) => option.value === manualStatusInput,
                )?.description
              }
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setStatusMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                setStatusMutation.isPending ||
                manualStatusInput === selectedVersionStatus
              }
              onClick={() => {
                setStatusMutation.mutate({
                  slug: project.slug,
                  version: selectedVersion,
                  status: manualStatusInput,
                });
                setShowStatusDialog(false);
              }}
            >
              Update status
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showEditTitleDialog}
        onOpenChange={(open) => {
          if (isTitleUpdatePending) return;
          setShowEditTitleDialog(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit project title</AlertDialogTitle>
            <AlertDialogDescription>
              Update the display name shown for this project in listings, search,
              and navigation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              value={editTitleInput}
              onChange={(event) => setEditTitleInput(event.target.value)}
              placeholder="Project title"
              autoFocus
              disabled={isTitleUpdatePending}
            />
            {isTitleUpdatePending ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving title...
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isTitleUpdatePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                isTitleUpdatePending ||
                !editTitleInput.trim() ||
                editTitleInput.trim() === (project.title ?? "").trim()
              }
              onClick={() => {
                updateTitleMutation.mutate({
                  slug: project.slug,
                  title: editTitleInput.trim(),
                });
              }}
            >
              {isTitleUpdatePending ? "Saving..." : "Save title"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showRenameDialog}
        onOpenChange={(open) => {
          if (isRenamePending) return;
          setShowRenameDialog(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename project slug?</AlertDialogTitle>
            <AlertDialogDescription>
              Change <strong>{project.slug}</strong> to a new URL slug. This updates
              project references across the control plane. This can take a while
              and project actions stay locked until it completes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              value={renameSlugInput}
              onChange={(event) => setRenameSlugInput(event.target.value)}
              placeholder="new-project-slug"
              autoFocus
              disabled={isRenamePending}
            />
            {isRenamePending ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Renaming in progress. Please keep this page open.
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={renameSlugMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                renameSlugMutation.isPending ||
                !renameSlugInput.trim() ||
                renameSlugInput.trim().toLowerCase() === project.slug.toLowerCase()
              }
              onClick={() => {
                const nextSlug = renameSlugInput.trim();
                renameSlugMutation.mutate({
                  oldSlug: project.slug,
                  newSlug: nextSlug,
                  confirmationText: nextSlug,
                });
              }}
            >
              {renameSlugMutation.isPending ? "Renaming..." : "Rename slug"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VersionManagementPanel
        open={showVersionManagement}
        onOpenChange={setShowVersionManagement}
        projectSlug={project.slug}
        versions={versions}
        publishedVersion={project.publishedVersion}
      />

      <PublishSiteDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        slug={project.slug}
        version={selectedVersion}
        onOpenStudio={() => navigate(`/vivd-studio/projects/${project.slug}`)}
      />
    </>
  );
}
