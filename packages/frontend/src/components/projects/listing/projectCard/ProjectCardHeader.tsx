import type { RefObject } from "react";
import type { Measurable } from "@radix-ui/rect";
import { Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { TagColor } from "@/lib/tagColors";
import { VersionSelector } from "../../versioning/VersionSelector";
import { ProjectTagsPopover, TagChip } from "../ProjectTagsPopover";
import type { Project, VersionInfo } from "../ProjectCard.types";
import type { ProjectStatusBadgeVariant } from "./ProjectCard.helpers";

interface ProjectCardHeaderProps {
  project: Project;
  availableTags: string[];
  tagColorMap: Record<string, string>;
  versions: VersionInfo[];
  selectedVersion: number;
  totalVersions: number;
  hasMultipleVersions: boolean;
  displayTitle: string;
  supportingDetail: string;
  publishedUrl: string | null;
  projectTags: string[];
  statusLabel: string;
  statusColor: ProjectStatusBadgeVariant;
  isCompleted: boolean;
  canRenameProject: boolean;
  isRenamePending: boolean;
  isTitleUpdatePending: boolean;
  isInlineTitleEditing: boolean;
  inlineTitleInput: string;
  inlineTitleInputRef: RefObject<HTMLInputElement | null>;
  tagsPopoverOpen: boolean;
  tagsPopoverSessionKey: number;
  tagsPopoverAnchor: "tags" | "actions";
  activeTagsPopoverAnchorRef: RefObject<Measurable>;
  tagsAreaAnchorRef: RefObject<HTMLDivElement | null>;
  isTagsSaving: boolean;
  getColor: (tag: string) => TagColor;
  onInlineTitleInputChange: (value: string) => void;
  onStartInlineTitleEdit: () => void;
  onCancelInlineTitleEdit: () => void;
  onCommitInlineTitleEdit: () => void;
  onVersionSelect: (version: number) => void;
  onManageVersions: () => void;
  onTagsPopoverOpenChange: (open: boolean) => void;
  onOpenTagsPopover: () => void;
  onCommitTags: (tags: string[]) => void;
  onDeleteTags: (tags: string[]) => void;
  onRenameTags: (renames: Array<{ fromTag: string; toTag: string }>) => void;
  onSetTagColor: (tag: string, colorId: string) => void;
}

export function ProjectCardHeader({
  project,
  availableTags,
  tagColorMap,
  versions,
  selectedVersion,
  totalVersions,
  hasMultipleVersions,
  displayTitle,
  supportingDetail,
  publishedUrl,
  projectTags,
  statusLabel,
  statusColor,
  isCompleted,
  canRenameProject,
  isRenamePending,
  isTitleUpdatePending,
  isInlineTitleEditing,
  inlineTitleInput,
  inlineTitleInputRef,
  tagsPopoverOpen,
  tagsPopoverSessionKey,
  tagsPopoverAnchor,
  activeTagsPopoverAnchorRef,
  tagsAreaAnchorRef,
  isTagsSaving,
  getColor,
  onInlineTitleInputChange,
  onStartInlineTitleEdit,
  onCancelInlineTitleEdit,
  onCommitInlineTitleEdit,
  onVersionSelect,
  onManageVersions,
  onTagsPopoverOpenChange,
  onOpenTagsPopover,
  onCommitTags,
  onDeleteTags,
  onRenameTags,
  onSetTagColor,
}: ProjectCardHeaderProps) {
  return (
    <CardHeader className="pl-4 pr-10 pb-3 pt-4">
      <div className="flex min-h-[44px] items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isInlineTitleEditing ? (
            <Input
              ref={inlineTitleInputRef}
              value={inlineTitleInput}
              onChange={(event) => onInlineTitleInputChange(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onBlur={onCommitInlineTitleEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCommitInlineTitleEdit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelInlineTitleEdit();
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
                onStartInlineTitleEdit();
              }}
            >
              {displayTitle}
            </CardTitle>
          )}
          {totalVersions > 0 ? (
            hasMultipleVersions ? (
              <VersionSelector
                selectedVersion={selectedVersion}
                versions={versions}
                onSelect={onVersionSelect}
                stopPropagation
                triggerVariant="secondary"
                triggerClassName="shrink-0 text-xs px-1.5 py-0 font-normal cursor-pointer hover:bg-secondary/80 transition-colors"
                triggerTitle={`Click to select from ${totalVersions} versions`}
                align="start"
                label="Select Version"
                onManageVersions={onManageVersions}
              />
            ) : (
              <VersionSelector
                selectedVersion={selectedVersion}
                versions={versions}
                onSelect={onVersionSelect}
                stopPropagation
                triggerVariant="secondary"
                triggerClassName="shrink-0 text-xs px-1.5 py-0 font-normal"
                triggerTitle={`${totalVersions} version`}
              />
            )
          ) : null}
        </div>
        <div className="grid shrink-0 content-start justify-items-end gap-1">
          <ProjectTagsPopover
            key={`${project.slug}:${tagsPopoverSessionKey}`}
            open={tagsPopoverOpen}
            onOpenChange={onTagsPopoverOpenChange}
            anchorVirtualRef={activeTagsPopoverAnchorRef}
            sideOffset={tagsPopoverAnchor === "actions" ? -6 : 6}
            suppressInitialOutsideInteraction={
              tagsPopoverOpen && tagsPopoverAnchor === "actions"
            }
            projectTags={projectTags}
            availableTags={availableTags}
            colorMap={tagColorMap}
            isSaving={isTagsSaving}
            onCommitTags={onCommitTags}
            onDeleteTags={onDeleteTags}
            onRenameTags={onRenameTags}
            onSetTagColor={onSetTagColor}
          >
            <div
              ref={tagsAreaAnchorRef}
              className="flex h-[22px] max-w-[200px] cursor-pointer flex-nowrap justify-end gap-1 overflow-hidden text-right"
              title="Click to edit labels"
              onClick={(event) => {
                if (isRenamePending) return;
                event.stopPropagation();
                onOpenTagsPopover();
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
                  {projectTags.length > 4 ? (
                    <span className="inline-flex shrink-0 items-center rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      +{projectTags.length - 4}
                    </span>
                  ) : null}
                </>
              ) : null}
            </div>
          </ProjectTagsPopover>
          <div className="flex min-h-5 items-center justify-end">
            {!isCompleted ? (
              <Badge variant={statusColor} className="shrink-0">
                {statusLabel}
              </Badge>
            ) : null}
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
                onClick={(event) => event.stopPropagation()}
              >
                {project.publishedDomain}
                {project.publishedVersion ? (
                  <span className="ml-1 text-muted-foreground">
                    (v{project.publishedVersion})
                  </span>
                ) : null}
              </a>
            </>
          ) : null}
        </div>
      </div>
    </CardHeader>
  );
}
