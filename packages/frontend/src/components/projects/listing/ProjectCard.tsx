import { useEffect, useRef, useState, type RefObject } from "react";
import type { Measurable } from "@radix-ui/rect";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { ROUTES } from "@/app/router";
import { useAppConfig } from "@/lib/AppConfigContext";
import { authClient } from "@/lib/auth-client";
import { getTagColor } from "@/lib/tagColors";
import { trpc } from "@/lib/trpc";
import { getProjectPluginPresentation } from "@/plugins/presentation";
import { getProjectPluginShortcuts } from "@/plugins/shortcuts";
import { toast } from "sonner";
import { PublishSiteDialog } from "../publish/PublishSiteDialog";
import { VersionManagementPanel } from "../versioning/VersionManagementPanel";
import { ProjectCardActionsMenu } from "./projectCard/ProjectCardActionsMenu";
import { ProjectCardContent } from "./projectCard/ProjectCardContent";
import {
  ProjectCardEditTitleDialog,
  ProjectCardRenameDialog,
  ProjectCardStatusDialog,
} from "./projectCard/ProjectCardDialogs";
import { ProjectCardFooter } from "./projectCard/ProjectCardFooter";
import { ProjectCardHeader } from "./projectCard/ProjectCardHeader";
import {
  getDefaultManualProjectStatus,
  getManualProjectStatusOptions,
  getProjectStatusPresentation,
  isDevDomain,
  isStudioAccessibleProjectStatus,
} from "./projectCard/ProjectCard.helpers";
import { useProjectCardMutations } from "./projectCard/ProjectCard.mutations";
import type { ProjectCardProps } from "./ProjectCard.types";

export type { Project, VersionInfo } from "./ProjectCard.types";
export {
  getDefaultManualProjectStatus,
  getManualProjectStatusOptions,
  isStudioAccessibleProjectStatus,
} from "./projectCard/ProjectCard.helpers";

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
  const { data: membership } = trpc.organization.getMyMembership.useQuery(
    undefined,
    {
      enabled: !!session && config.hasHostOrganizationAccess,
    },
  );
  const isSuperAdmin = session?.user?.role === "super_admin";

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
  const [tagsPopoverAnchor, setTagsPopoverAnchor] = useState<
    "tags" | "actions"
  >("tags");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const suppressActionsCloseAutoFocusRef = useRef(false);
  const inlineTitleInputRef = useRef<HTMLInputElement>(null);
  const tagsAreaAnchorRef = useRef<HTMLDivElement>(null);
  const actionsMenuItemAnchorRef = useRef<Measurable>({
    getBoundingClientRect: () => new DOMRect(),
  });

  const versions = project.versions || [];
  const hasMultipleVersions = (project.totalVersions || 1) > 1;
  const totalVersions = project.totalVersions || 1;
  const selectedVersionInfo = versions.find(
    (version) => version.version === selectedVersion,
  );
  const selectedVersionStatus =
    selectedVersionInfo?.status ??
    (selectedVersion === project.currentVersion ? project.status : "unknown");
  const manualProjectStatusOptions = getManualProjectStatusOptions(
    project.source,
  );
  const [manualStatusInput, setManualStatusInput] = useState(() =>
    getDefaultManualProjectStatus(selectedVersionStatus, project.source),
  );

  const {
    deleteTagMutation,
    regenerateThumbnailMutation,
    renameSlugMutation,
    renameTagMutation,
    setCurrentVersionMutation,
    setPublicPreviewEnabledMutation,
    setStatusMutation,
    setTagColorMutation,
    updateTagsMutation,
    updateTitleMutation,
  } = useProjectCardMutations({
    projectSlug: project.slug,
    selectedVersion,
    onRenameSuccess: () => {
      setShowRenameDialog(false);
    },
    onTitleUpdateSuccess: (title) => {
      setShowEditTitleDialog(false);
      setIsInlineTitleEditing(false);
      setInlineTitleInput(title);
    },
  });

  const canManagePreview = membership?.organizationRole !== "client_editor";
  const canRenameProject = membership?.organizationRole !== "client_editor";
  const canOverrideProjectStatus =
    isSuperAdmin ||
    membership?.organizationRole === "owner" ||
    membership?.organizationRole === "admin";
  const isRenamePending = renameSlugMutation.isPending;
  const isTitleUpdatePending = updateTitleMutation.isPending;
  const publicPreviewEnabled = project.publicPreviewEnabled ?? true;
  const projectTags = project.tags ?? [];
  const isUrlProject = (project.source || "url") === "url";
  const displayTitle = project.title?.trim() || project.slug;
  const supportingDetail = isUrlProject ? project.url : "";
  const publishedUrl = project.publishedDomain
    ? `${isDevDomain(project.publishedDomain) ? "http" : "https"}://${project.publishedDomain}`
    : null;
  const canOpenStudio = isStudioAccessibleProjectStatus(selectedVersionStatus);
  const isCompleted = selectedVersionStatus === "completed";
  const isFailed = selectedVersionStatus === "failed";
  const isInitialGenerationPaused =
    selectedVersionStatus === "initial_generation_paused";
  const isProcessing =
    !isCompleted &&
    !isFailed &&
    !isInitialGenerationPaused &&
    selectedVersionStatus !== "unknown";
  const { label: statusLabel, color: statusColor } =
    getProjectStatusPresentation(selectedVersionStatus);
  const activeTagsPopoverAnchorRef: RefObject<Measurable> =
    (tagsPopoverAnchor === "actions"
      ? actionsMenuItemAnchorRef
      : tagsAreaAnchorRef) as unknown as RefObject<Measurable>;
  const projectPluginShortcuts = getProjectPluginShortcuts({
    enabledPluginIds: project.enabledPlugins ?? [],
    projectSlug: project.slug,
    surface: "project-card",
  });
  const enabledPluginEntries = (project.enabledPlugins ?? []).map((pluginId) =>
    getProjectPluginPresentation(pluginId, project.slug),
  );

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

  useEffect(() => {
    if (!isInlineTitleEditing) return;

    const frame = window.requestAnimationFrame(() => {
      inlineTitleInputRef.current?.focus();
      inlineTitleInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isInlineTitleEditing]);

  useEffect(() => {
    if (!showStatusDialog) return;
    setManualStatusInput(
      getDefaultManualProjectStatus(selectedVersionStatus, project.source),
    );
  }, [project.source, selectedVersionStatus, showStatusDialog]);

  const getColor = (tag: string) => getTagColor(tag, tagColorMap);

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

    navigator.clipboard.writeText(getPreviewUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVersionSelect = (version: number) => {
    setSelectedVersion(version);
    setCurrentVersionMutation.mutate({ slug: project.slug, version });
  };

  const openTagsPopover = (anchor: "tags" | "actions") => {
    setTagsPopoverAnchor(anchor);
    setTagsPopoverSessionKey((current) => current + 1);
    setTagsPopoverOpen(true);
  };

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

  return (
    <>
      <Card
        className={`group relative flex flex-col h-full overflow-hidden transition-all min-h-[160px] bg-card/50 border-border/50 shadow-sm hover:shadow-md ${
          isProcessing
            ? "border-primary/60 ring-1 ring-primary/20 animate-pulse duration-3000"
            : ""
        } ${
          canOpenStudio
            ? "cursor-pointer hover:border-primary/40 hover:bg-card"
            : ""
        }`}
        onClick={() => {
          if (canOpenStudio && !isRenamePending) {
            openProjectStudio();
          }
        }}
      >
        <ProjectCardActionsMenu
          project={project}
          publicPreviewEnabled={publicPreviewEnabled}
          copied={copied}
          projectPluginShortcuts={projectPluginShortcuts}
          actionsMenuOpen={actionsMenuOpen}
          onActionsMenuOpenChange={setActionsMenuOpen}
          suppressActionsCloseAutoFocusRef={suppressActionsCloseAutoFocusRef}
          actionsMenuItemAnchorRef={actionsMenuItemAnchorRef}
          canManagePreview={canManagePreview}
          canRenameProject={canRenameProject}
          canOverrideProjectStatus={canOverrideProjectStatus}
          isCompleted={isCompleted}
          isProcessing={isProcessing}
          isRegenerating={isRegenerating}
          isRenamePending={isRenamePending}
          isTitleUpdatePending={isTitleUpdatePending}
          isRegenerateThumbnailPending={regenerateThumbnailMutation.isPending}
          isSetPublicPreviewEnabledPending={
            setPublicPreviewEnabledMutation.isPending
          }
          isSetStatusPending={setStatusMutation.isPending}
          onOpenPreview={() => window.open(getPreviewUrl(), "_blank")}
          onCopyPreview={handleCopyPreview}
          onTogglePreviewEnabled={() =>
            setPublicPreviewEnabledMutation.mutate({
              slug: project.slug,
              enabled: !publicPreviewEnabled,
            })
          }
          onOpenOriginalWebsite={() => window.open(project.url, "_blank")}
          onOpenPlugins={() => navigate(ROUTES.PROJECT_PLUGINS(project.slug))}
          onOpenPluginShortcut={(path) => navigate(path)}
          onOpenTagsPopoverFromActions={() => openTagsPopover("actions")}
          onDownloadZip={() => {
            const baseUrl = import.meta.env.VITE_BACKEND_URL || "";
            window.open(
              `${baseUrl}/vivd-studio/api/download/${project.slug}/${selectedVersion}`,
              "_blank",
            );
          }}
          onRegenerateThumbnail={() =>
            regenerateThumbnailMutation.mutate({
              slug: project.slug,
              version: selectedVersion,
            })
          }
          onRegenerate={() => onRegenerate(project.slug, selectedVersion)}
          onManageVersions={() => setShowVersionManagement(true)}
          onOpenPublishDialog={() => setPublishDialogOpen(true)}
          onOpenEditTitleDialog={() => {
            setEditTitleInput(project.title ?? "");
            setShowEditTitleDialog(true);
          }}
          onOpenRenameDialog={() => {
            setRenameSlugInput(project.slug);
            setShowRenameDialog(true);
          }}
          onOpenStatusDialog={() => setShowStatusDialog(true)}
          onDelete={() => onDelete(project.slug)}
        />

        <ProjectCardHeader
          project={project}
          availableTags={availableTags}
          tagColorMap={tagColorMap}
          versions={versions}
          selectedVersion={selectedVersion}
          totalVersions={totalVersions}
          hasMultipleVersions={hasMultipleVersions}
          displayTitle={displayTitle}
          supportingDetail={supportingDetail}
          publishedUrl={publishedUrl}
          projectTags={projectTags}
          statusLabel={statusLabel}
          statusColor={statusColor}
          isCompleted={isCompleted}
          canRenameProject={canRenameProject}
          isRenamePending={isRenamePending}
          isTitleUpdatePending={isTitleUpdatePending}
          isInlineTitleEditing={isInlineTitleEditing}
          inlineTitleInput={inlineTitleInput}
          inlineTitleInputRef={inlineTitleInputRef}
          tagsPopoverOpen={tagsPopoverOpen}
          tagsPopoverSessionKey={tagsPopoverSessionKey}
          tagsPopoverAnchor={tagsPopoverAnchor}
          activeTagsPopoverAnchorRef={activeTagsPopoverAnchorRef}
          tagsAreaAnchorRef={tagsAreaAnchorRef}
          isTagsSaving={
            updateTagsMutation.isPending ||
            deleteTagMutation.isPending ||
            renameTagMutation.isPending ||
            setTagColorMutation.isPending
          }
          getColor={getColor}
          onInlineTitleInputChange={setInlineTitleInput}
          onStartInlineTitleEdit={startInlineTitleEdit}
          onCancelInlineTitleEdit={cancelInlineTitleEdit}
          onCommitInlineTitleEdit={commitInlineTitleEdit}
          onVersionSelect={handleVersionSelect}
          onManageVersions={() => setShowVersionManagement(true)}
          onTagsPopoverOpenChange={setTagsPopoverOpen}
          onOpenTagsPopover={() => openTagsPopover("tags")}
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
        />

        <ProjectCardContent
          projectSlug={project.slug}
          thumbnailUrl={project.thumbnailUrl}
          selectedVersionInfo={selectedVersionInfo}
          statusLabel={statusLabel}
          isCompleted={isCompleted}
          isFailed={isFailed}
          isInitialGenerationPaused={isInitialGenerationPaused}
          isProcessing={isProcessing}
          canOpenStudio={canOpenStudio}
          canOverrideProjectStatus={canOverrideProjectStatus}
          isSetStatusPending={setStatusMutation.isPending}
          onOpenProjectStudio={openProjectStudio}
          onOpenStatusDialog={() => setShowStatusDialog(true)}
        />

        <ProjectCardFooter
          enabledPluginEntries={enabledPluginEntries}
          isRenamePending={isRenamePending}
          onOpenPlugins={() => navigate(ROUTES.PROJECT_PLUGINS(project.slug))}
          onOpenPlugin={(path) => navigate(path)}
        />

        {isRenamePending ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Renaming project slug...
            </div>
          </div>
        ) : null}
      </Card>

      <ProjectCardStatusDialog
        open={showStatusDialog}
        onOpenChange={setShowStatusDialog}
        projectSlug={project.slug}
        selectedVersion={selectedVersion}
        manualStatusInput={manualStatusInput}
        selectedVersionStatus={selectedVersionStatus}
        manualProjectStatusOptions={manualProjectStatusOptions}
        isPending={setStatusMutation.isPending}
        onManualStatusInputChange={setManualStatusInput}
        onConfirm={() => {
          setStatusMutation.mutate({
            slug: project.slug,
            version: selectedVersion,
            status: manualStatusInput,
          });
          setShowStatusDialog(false);
        }}
      />

      <ProjectCardEditTitleDialog
        open={showEditTitleDialog}
        onOpenChange={(open) => {
          if (isTitleUpdatePending) return;
          setShowEditTitleDialog(open);
        }}
        currentTitle={project.title ?? ""}
        editTitleInput={editTitleInput}
        isPending={isTitleUpdatePending}
        onEditTitleInputChange={setEditTitleInput}
        onSave={() => {
          updateTitleMutation.mutate({
            slug: project.slug,
            title: editTitleInput.trim(),
          });
        }}
      />

      <ProjectCardRenameDialog
        open={showRenameDialog}
        onOpenChange={(open) => {
          if (isRenamePending) return;
          setShowRenameDialog(open);
        }}
        projectSlug={project.slug}
        renameSlugInput={renameSlugInput}
        isPending={isRenamePending}
        onRenameSlugInputChange={setRenameSlugInput}
        onConfirm={() => {
          const nextSlug = renameSlugInput.trim();
          renameSlugMutation.mutate({
            oldSlug: project.slug,
            newSlug: nextSlug,
            confirmationText: nextSlug,
          });
        }}
      />

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
