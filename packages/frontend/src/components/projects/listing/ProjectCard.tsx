import { useState, useEffect, useRef, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import type { Measurable } from "@radix-ui/rect";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Copy,
  Check,
  Plus,
  Loader2,
  RotateCcw,
  Globe,
  Trash2,
  MoreVertical,
  Download,
  ExternalLink,
  Settings2,
  Eye,
  EyeOff,
  Image,
  Tags,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAppConfig } from "@/lib/AppConfigContext";
import { ROUTES } from "@/app/router";
import { VersionSelector } from "../versioning/VersionSelector";
import { VersionManagementPanel } from "../versioning/VersionManagementPanel";
import { PublishSiteDialog } from "../publish/PublishSiteDialog";
import { ProjectTagsPopover, TagChip } from "./ProjectTagsPopover";
import { useTagColors } from "@/lib/tagColors";
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
}

interface ProjectCardProps {
  project: Project;
  availableTags: string[];
  onRegenerate: (slug: string, version?: number) => void;
  onDelete: (slug: string) => void;
  isRegenerating: boolean;
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

  const resetMutation = trpc.project.resetStatus.useMutation({
    onSuccess: (data) => {
      toast.success("Status Reset", {
        description: data.message,
      });
      utils.project.list.invalidate();
    },
    onError: (error) => {
      toast.error("Reset Failed", {
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
    },
    onError: (error) => {
      toast.error("Failed to update tags", {
        description: error.message,
      });
    },
  });

  const { getColor } = useTagColors();

  const [selectedVersion, setSelectedVersion] = useState(
    project.currentVersion || 1,
  );
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showVersionManagement, setShowVersionManagement] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [tagsPopoverOpen, setTagsPopoverOpen] = useState(false);
  const [tagsPopoverAnchor, setTagsPopoverAnchor] = useState<"tags" | "actions">("tags");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const suppressActionsCloseAutoFocusRef = useRef(false);
  const tagsAreaAnchorRef = useRef<HTMLDivElement>(null);
  const actionsMenuItemAnchorRef = useRef<Measurable>({
    getBoundingClientRect: () => new DOMRect(),
  });
  const [copied, setCopied] = useState(false);
  const publicPreviewEnabled = project.publicPreviewEnabled ?? true;
  const canManagePreview = membership?.organizationRole !== "client_editor";

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

  const hasMultipleVersions = (project.totalVersions || 1) > 1;
  const versions = project.versions || [];

  const handleVersionSelect = (version: number) => {
    setSelectedVersion(version);
    setCurrentVersionMutation.mutate({ slug: project.slug, version });
  };

  // Get status for selected version
  const selectedVersionInfo = versions.find(
    (v) => v.version === selectedVersion,
  );
  const isCompleted =
    selectedVersionInfo?.status === "completed" ||
    (selectedVersion === project.currentVersion &&
      project.status === "completed");
  const isFailed =
    selectedVersionInfo?.status === "failed" ||
    (selectedVersion === project.currentVersion && project.status === "failed");
  const isProcessing =
    !isCompleted && !isFailed && selectedVersionInfo?.status !== "unknown";
  const totalVersions = project.totalVersions || 1;
  const projectTags = project.tags ?? [];
  const isUrlProject = (project.source || "url") === "url";
  const subtitle = isUrlProject
    ? project.url
    : project.title
      ? `“${project.title}”`
      : "Start-from-scratch project";
  const publishedUrl = project.publishedDomain
    ? `${isDevDomain(project.publishedDomain) ? "http" : "https"}://${project.publishedDomain}`
    : null;
  const activeTagsPopoverAnchorRef: RefObject<Measurable> = (
    tagsPopoverAnchor === "actions"
      ? actionsMenuItemAnchorRef
      : tagsAreaAnchorRef
  ) as unknown as RefObject<Measurable>;

  // Calculate progress and label
  let statusLabel = "Pending";
  let statusColor: "default" | "secondary" | "destructive" | "outline" =
    "secondary";

  switch (project.status) {
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
      statusLabel = project.status;
  }

  return (
    <>
      <Card
        className={`flex flex-col h-full overflow-hidden transition-all min-h-[160px] bg-card/50 border-border/50 shadow-sm hover:shadow-md ${
          isProcessing
            ? "border-primary/60 ring-1 ring-primary/20 animate-pulse duration-3000"
            : ""
        } ${isCompleted ? "cursor-pointer hover:border-primary/40 hover:bg-card" : ""}`}
        onClick={() => {
          if (isCompleted) {
            navigate(`/vivd-studio/projects/${project.slug}`);
          }
        }}
      >
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex justify-between items-start gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <CardTitle
                className="text-base font-semibold truncate"
                title={project.slug}
              >
                {project.slug}
              </CardTitle>
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
            <div className="flex shrink-0 flex-col items-end gap-1">
              <ProjectTagsPopover
                open={tagsPopoverOpen}
                onOpenChange={setTagsPopoverOpen}
                anchorVirtualRef={activeTagsPopoverAnchorRef}
                sideOffset={tagsPopoverAnchor === "actions" ? -6 : 6}
                suppressInitialOutsideInteraction={
                  tagsPopoverOpen && tagsPopoverAnchor === "actions"
                }
                projectTags={projectTags}
                availableTags={availableTags}
                isSaving={updateTagsMutation.isPending}
                onToggleTag={(tag, add) => {
                  const next = add
                    ? [...projectTags, tag]
                    : projectTags.filter((t) => t !== tag);
                  updateTagsMutation.mutate({ slug: project.slug, tags: next });
                }}
                onCreateTag={(tag) => {
                  if (!projectTags.includes(tag)) {
                    updateTagsMutation.mutate({
                      slug: project.slug,
                      tags: [...projectTags, tag],
                    });
                  }
                }}
              >
                <div
                  ref={tagsAreaAnchorRef}
                  className="flex min-h-[22px] max-w-[200px] cursor-pointer flex-wrap justify-end gap-1 text-right"
                  title="Click to edit labels"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTagsPopoverAnchor("tags");
                    setTagsPopoverOpen(true);
                  }}
                >
                  {projectTags.length === 0 ? (
                    <span className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors select-none">
                      + Add labels
                    </span>
                  ) : (
                    <>
                      {projectTags.slice(0, 4).map((tag) => (
                        <TagChip key={tag} tag={tag} color={getColor(tag)} className="text-[10px] py-0.5" />
                      ))}
                      {projectTags.length > 4 && (
                        <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                          +{projectTags.length - 4}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </ProjectTagsPopover>
              {!isCompleted && (
                <Badge variant={statusColor} className="shrink-0">
                  {statusLabel}
                </Badge>
              )}
            </div>
          </div>
          <div
            className="text-xs text-muted-foreground truncate"
            title={subtitle}
          >
            {subtitle}
          </div>
          {project.publishedDomain && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Globe className="w-3 h-3 text-green-600 shrink-0" />
              <a
                href={publishedUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-600 hover:text-green-700 hover:underline truncate"
                title={`Published at ${project.publishedDomain}${
                  project.publishedVersion
                    ? ` (v${project.publishedVersion})`
                    : ""
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {project.publishedDomain}
                {project.publishedVersion && (
                  <span className="text-muted-foreground ml-1">
                    (v{project.publishedVersion})
                  </span>
                )}
              </a>
            </div>
          )}
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
              {isSuperAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowResetConfirm(true);
                  }}
                  disabled={resetMutation.isPending}
                >
                  <RotateCcw
                    className={`w-3 h-3 mr-1 ${
                      resetMutation.isPending ? "animate-spin" : ""
                    }`}
                  />
                  {resetMutation.isPending
                    ? "Resetting..."
                    : "Force Reset (Super Admin)"}
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
            </div>
          )}
        </CardContent>
        <CardFooter className="pt-2.5 pb-3 px-4 flex items-center justify-end gap-2 border-t border-border/30 mt-auto">
          <DropdownMenu
            open={actionsMenuOpen}
            onOpenChange={setActionsMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="w-4 h-4" />
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
              {/* Actions should stay in sync — see PROJECT_ACTIONS in @vivd/shared */}
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
                  setTagsPopoverAnchor("actions");
                  setActionsMenuOpen(false);
                  requestAnimationFrame(() => setTagsPopoverOpen(true));
                }}
              >
                <Tags className="w-4 h-4 mr-2" />
                Edit tags
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate(ROUTES.PROJECT_PLUGINS(project.slug))}
              >
                <Settings2 className="w-4 h-4 mr-2" />
                Plugins
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
              <DropdownMenuItem
                onClick={() => onDelete(project.slug)}
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {isUrlProject && project.url && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-indigo-300 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-400 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950 dark:hover:text-indigo-300"
              disabled={isProcessing || isRegenerating}
              onClick={(e) => {
                e.stopPropagation();
                onRegenerate(project.slug, selectedVersion);
              }}
              title="Create new version"
            >
              <Plus
                className={`w-4 h-4 ${isRegenerating ? "animate-spin" : ""}`}
              />
              <span className="text-xs font-medium">New</span>
            </Button>
          )}
        </CardFooter>
      </Card>

      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force Reset Project?</AlertDialogTitle>
            <AlertDialogDescription>
              Force reset {project.slug} v{selectedVersion} to{" "}
              <code>failed</code>? This is an admin-only action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={resetMutation.isPending}
              onClick={() => {
                resetMutation.mutate({
                  slug: project.slug,
                  version: selectedVersion,
                });
                setShowResetConfirm(false);
              }}
            >
              Force Reset
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
