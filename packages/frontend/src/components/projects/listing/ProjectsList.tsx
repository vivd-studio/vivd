import { trpc } from "@/lib/trpc";
import type { RouterInputs } from "@/lib/trpc";
import { getProjectLastModified } from "@/lib/project-utils";
import { useMutationState } from "@tanstack/react-query";
import { getMutationKey } from "@trpc/react-query";
import { useState, useMemo, useEffect } from "react";
import { ProjectCard } from "./ProjectCard";
import type { Project } from "./ProjectCard.types";
import { VersionDialog } from "../versioning/VersionDialog";
import { DeleteProjectDialog } from "../dialogs/DeleteProjectDialog";
import { toast } from "sonner";
import {
  Button,
  Callout,
  CalloutDescription,
  CalloutTitle,
  Input,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vivd/ui";

import { Search, X } from "lucide-react";
import { getTagColor } from "@/lib/tagColors";

type SortOption = "updated-desc" | "created-desc" | "name-asc" | "name-desc";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "updated-desc", label: "Last updated" },
  { value: "created-desc", label: "Recently created" },
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
];

const STORAGE_KEY = "vivd-projects-sort";

interface VersionDialogData {
  slug: string;
  url: string;
  currentVersion: number;
  totalVersions: number;
}

type DuplicateProjectInput = RouterInputs["project"]["duplicateProject"];

interface PendingDuplicateProjectMutation {
  variables: DuplicateProjectInput;
  submittedAt: number;
}

function createPendingDuplicateProject(
  pending: PendingDuplicateProjectMutation,
  sourceProject?: Project,
): Project {
  const createdAt = pending.submittedAt
    ? new Date(pending.submittedAt).toISOString()
    : new Date().toISOString();
  const targetSlug =
    pending.variables.slug?.trim() ||
    `${pending.variables.sourceSlug.trim()}-copy`;
  const targetTitle =
    pending.variables.title?.trim() ||
    `${sourceProject?.title?.trim() || sourceProject?.slug || pending.variables.sourceSlug} copy`;

  return {
    slug: targetSlug,
    url: sourceProject?.url ?? "",
    source: sourceProject?.source ?? "scratch",
    title: targetTitle,
    tags: sourceProject?.tags ?? [],
    status: "duplicating_project",
    createdAt,
    currentVersion: 1,
    totalVersions: 1,
    versions: [
      {
        version: 1,
        createdAt,
        status: "duplicating_project",
      },
    ],
    publishedDomain: null,
    publishedVersion: null,
    thumbnailUrl: null,
    publicPreviewEnabled: false,
    enabledPlugins: sourceProject?.enabledPlugins ?? [],
  };
}

export function ProjectsList() {
  const {
    data: projectsData,
    isLoading,
    error,
  } = trpc.project.list.useQuery(undefined, {
    // Poll only while there are active generation states.
    // Avoid spamming the backend (and console) on auth/config errors.
    refetchInterval: (query) => {
      const projects = query.state.data?.projects ?? [];
      return projects.some(
        (p) =>
          p.status !== "completed" &&
          p.status !== "failed" &&
          p.status !== "initial_generation_paused",
      )
        ? 2000
        : false;
    },
  });
  const utils = trpc.useUtils();
  const { data: tagCatalogData } = trpc.project.listTags.useQuery();
  const pendingDuplicateProjects =
    useMutationState<PendingDuplicateProjectMutation>({
      filters: {
        mutationKey: getMutationKey(trpc.project.duplicateProject),
        status: "pending",
      },
      select: (mutation) => ({
        variables: mutation.state.variables as DuplicateProjectInput,
        submittedAt: mutation.state.submittedAt,
      }),
    });
  const { mutateAsync: regenerateProject } =
    trpc.project.regenerate.useMutation();
  const { mutateAsync: generateProject } = trpc.project.generate.useMutation();
  const [regeneratingSlug, setRegeneratingSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const deleteProjectMutation = trpc.project.delete.useMutation({
    onMutate: (variables) => {
      setDeletingSlug(variables.slug);
      toast.loading("Deleting project", {
        id: `delete-project-${variables.slug}`,
        description: variables.slug,
      });
    },
    onSuccess: async (data, variables) => {
      toast.success("Project Deleted", {
        id: `delete-project-${variables.slug}`,
        description: data.message,
      });
      await utils.project.list.invalidate();
      await utils.project.list.refetch();
    },
    onError: (error, variables) => {
      toast.error("Delete Failed", {
        id: `delete-project-${variables.slug}`,
        description: error.message,
      });
    },
    onSettled: (_data, _error, variables) => {
      setDeletingSlug((current) =>
        current === variables.slug ? null : current,
      );
    },
  });
  const [versionDialogData, setVersionDialogData] =
    useState<VersionDialogData | null>(null);
  const [deleteDialogSlug, setDeleteDialogSlug] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SORT_OPTIONS.some((opt) => opt.value === saved)) {
        return saved as SortOption;
      }
    }
    return "updated-desc";
  });

  // Persist sort option to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, sortOption);
  }, [sortOption]);

  const projectsWithPendingDuplicates = useMemo(() => {
    const projects = projectsData?.projects ?? [];
    if (pendingDuplicateProjects.length === 0) return projects;

    const projectsBySlug = new Map(
      projects.map((project) => [project.slug, project]),
    );
    const seenSlugs = new Set(projects.map((project) => project.slug));
    const pendingProjects = pendingDuplicateProjects
      .map((pending) =>
        createPendingDuplicateProject(
          pending,
          projectsBySlug.get(pending.variables.sourceSlug),
        ),
      )
      .filter((project) => {
        if (seenSlugs.has(project.slug)) return false;
        seenSlugs.add(project.slug);
        return true;
      });

    return [...pendingProjects, ...projects];
  }, [pendingDuplicateProjects, projectsData?.projects]);

  // Filter and sort projects
  const availableTags = useMemo(() => {
    return Array.from(
      new Set(
        projectsWithPendingDuplicates.flatMap((project) => project.tags ?? []),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [projectsWithPendingDuplicates]);

  const tagColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of tagCatalogData?.tags ?? []) {
      if (entry.colorId) {
        map[entry.tag] = entry.colorId;
      }
    }
    return map;
  }, [tagCatalogData?.tags]);

  useEffect(() => {
    setSelectedTag((current) =>
      current && availableTags.includes(current) ? current : null,
    );
  }, [availableTags]);

  const filteredAndSortedProjects = useMemo(() => {
    let projects = [...projectsWithPendingDuplicates];

    // Filter by selected tag
    if (selectedTag) {
      projects = projects.filter((project) => {
        const tags = project.tags ?? [];
        return tags.includes(selectedTag);
      });
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      projects = projects.filter(
        (p) =>
          p.slug.toLowerCase().includes(query) ||
          p.title?.toLowerCase().includes(query) ||
          p.url?.toLowerCase().includes(query),
      );
    }

    // Sort projects
    projects.sort((a, b) => {
      switch (sortOption) {
        case "updated-desc":
          return getProjectLastModified(b) - getProjectLastModified(a);
        case "created-desc":
          return (
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
          );
        case "name-asc": {
          const nameA = (a.title || a.slug).toLowerCase();
          const nameB = (b.title || b.slug).toLowerCase();
          return nameA.localeCompare(nameB);
        }
        case "name-desc": {
          const nameA = (a.title || a.slug).toLowerCase();
          const nameB = (b.title || b.slug).toLowerCase();
          return nameB.localeCompare(nameA);
        }
        default:
          return 0;
      }
    });

    return projects;
  }, [projectsWithPendingDuplicates, searchQuery, selectedTag, sortOption]);

  const handleCreateNewClick = (slug: string, version?: number) => {
    // Find the project to get its URL and version info
    const project = projectsWithPendingDuplicates.find((p) => p.slug === slug);
    if (project) {
      setVersionDialogData({
        slug: project.slug,
        url: project.url,
        currentVersion: version ?? project.currentVersion ?? 1,
        totalVersions: project.totalVersions ?? 1,
      });
    }
  };

  const handleCreateNewVersion = async () => {
    if (!versionDialogData) return;
    const { url } = versionDialogData;
    setVersionDialogData(null);

    setRegeneratingSlug(versionDialogData.slug);
    try {
      await generateProject({ url, createNewVersion: true });
    } catch (error) {
      console.error(error);
      toast.error("Failed to create new version", {
        description: (error as Error).message,
      });
    } finally {
      setRegeneratingSlug(null);
    }
  };

  const handleOverwriteCurrent = async () => {
    if (!versionDialogData) return;
    const { slug, currentVersion } = versionDialogData;
    setVersionDialogData(null);

    setRegeneratingSlug(slug);
    try {
      await regenerateProject({ slug, version: currentVersion });
    } catch (error) {
      console.error(error);
      toast.error(`Failed to regenerate ${slug}`, {
        description: (error as Error).message,
      });
    } finally {
      setRegeneratingSlug(null);
    }
  };

  const handleDeleteClick = (slug: string) => {
    setDeleteDialogSlug(slug);
  };

  const handleConfirmDelete = (confirmationText: string) => {
    if (!deleteDialogSlug) return;
    deleteProjectMutation.mutate({
      slug: deleteDialogSlug,
      confirmationText,
    });
    setDeleteDialogSlug(null);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-5">
        {[1, 2, 3].map((i) => (
          <Panel key={i} className="h-44 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Callout tone="danger">
        <CalloutTitle>Error loading projects</CalloutTitle>
        <CalloutDescription>{error.message}</CalloutDescription>
      </Callout>
    );
  }

  const hasProjects = projectsWithPendingDuplicates.length > 0;

  return (
    <div>
      {hasProjects && (
        <div className="mb-5 space-y-3 py-2">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={sortOption}
              onValueChange={(v) => setSortOption(v as SortOption)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {availableTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground mr-0.5">
                Filter:
              </span>
              {availableTags.map((tag) => {
                const active = selectedTag === tag;
                const color = getTagColor(tag, tagColorMap);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setSelectedTag((current) =>
                        current === tag ? null : tag,
                      )
                    }
                    aria-label={`Filter by tag ${tag}`}
                    aria-pressed={active}
                    className={`flex max-w-[10rem] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                      active
                        ? "bg-surface-sunken text-foreground"
                        : "text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color.bg }}
                    />
                    <span className="min-w-0 truncate">{tag}</span>
                  </button>
                );
              })}
              {selectedTag && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelectedTag(null)}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {!hasProjects ? (
        <Panel tone="dashed" className="py-16 text-center">
          <p className="text-muted-foreground">
            No projects yet. Click "New Project" to create one!
          </p>
        </Panel>
      ) : filteredAndSortedProjects.length === 0 ? (
        <Panel tone="dashed" className="py-16 text-center">
          <p className="text-muted-foreground">
            No projects match your current filters.
          </p>
        </Panel>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-5">
          {filteredAndSortedProjects.map((project) => (
            <ProjectCard
              key={project.slug}
              project={project}
              availableTags={availableTags}
              tagColorMap={tagColorMap}
              onRegenerate={handleCreateNewClick}
              onDelete={handleDeleteClick}
              isRegenerating={regeneratingSlug === project.slug}
              isDeleting={deletingSlug === project.slug}
            />
          ))}
        </div>
      )}

      <VersionDialog
        open={!!versionDialogData}
        onOpenChange={(open) => !open && setVersionDialogData(null)}
        onCreateNewVersion={handleCreateNewVersion}
        onOverwriteCurrent={handleOverwriteCurrent}
        projectName={versionDialogData?.slug}
        currentVersion={versionDialogData?.currentVersion ?? 1}
        totalVersions={versionDialogData?.totalVersions ?? 1}
      />

      <DeleteProjectDialog
        open={!!deleteDialogSlug}
        onOpenChange={(open) => !open && setDeleteDialogSlug(null)}
        onConfirmDelete={handleConfirmDelete}
        projectName={deleteDialogSlug ?? ""}
        isDeleting={deleteProjectMutation.isPending}
      />
    </div>
  );
}
