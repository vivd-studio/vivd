import { trpc } from "@/lib/trpc";
import { useState, useMemo, useEffect } from "react";
import { ProjectCard } from "./ProjectCard";
import { VersionDialog } from "./VersionDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";

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

export function ProjectsList() {
  const {
    data: projectsData,
    isLoading,
    error,
  } = trpc.project.list.useQuery(undefined, {
    refetchInterval: 2000, // Poll every 2 seconds to check status
  });
  const { mutateAsync: regenerateProject } =
    trpc.project.regenerate.useMutation();
  const { mutateAsync: generateProject } = trpc.project.generate.useMutation();
  const deleteProjectMutation = trpc.project.delete.useMutation({
    onSuccess: (data) => {
      toast.success("Project Deleted", {
        description: data.message,
      });
      utils.project.list.invalidate();
    },
    onError: (error) => {
      toast.error("Delete Failed", {
        description: error.message,
      });
    },
  });
  const utils = trpc.useUtils();
  const [regeneratingSlug, setRegeneratingSlug] = useState<string | null>(null);
  const [versionDialogData, setVersionDialogData] =
    useState<VersionDialogData | null>(null);
  const [deleteDialogSlug, setDeleteDialogSlug] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
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

  // Filter and sort projects
  const filteredAndSortedProjects = useMemo(() => {
    if (!projectsData?.projects) return [];

    let projects = [...projectsData.projects];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      projects = projects.filter(
        (p) =>
          p.slug.toLowerCase().includes(query) ||
          p.title?.toLowerCase().includes(query) ||
          p.url?.toLowerCase().includes(query)
      );
    }

    // Sort projects
    projects.sort((a, b) => {
      switch (sortOption) {
        case "updated-desc": {
          // Prefer updatedAt, fallback to latest version createdAt, then project createdAt
          const getLastModified = (project: typeof a) => {
            if (project.updatedAt) {
              return new Date(project.updatedAt).getTime();
            }
            if (project.versions && project.versions.length > 0) {
              const latestVersion = project.versions.reduce((latest, version) => {
                const versionDate = new Date(version.createdAt || 0).getTime();
                const latestDate = new Date(latest.createdAt || 0).getTime();
                return versionDate > latestDate ? version : latest;
              });
              return new Date(latestVersion.createdAt || 0).getTime();
            }
            return new Date(project.createdAt || 0).getTime();
          };
          return getLastModified(b) - getLastModified(a);
        }
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
  }, [projectsData?.projects, searchQuery, sortOption]);

  const handleCreateNewClick = (slug: string, version?: number) => {
    // Find the project to get its URL and version info
    const project = projectsData?.projects.find((p) => p.slug === slug);
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-44 rounded-lg border bg-card text-card-foreground shadow-sm animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error)
    return <div className="text-destructive">Error loading projects</div>;

  const hasProjects = (projectsData?.projects?.length ?? 0) > 0;

  return (
    <div>
      {hasProjects && (
        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
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
      )}

      {!hasProjects ? (
        <div className="text-center py-16 border border-dashed rounded-lg bg-muted/30">
          <p className="text-muted-foreground">
            No projects yet. Click "New Project" to create one!
          </p>
        </div>
      ) : filteredAndSortedProjects.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg bg-muted/30">
          <p className="text-muted-foreground">
            No projects match your search.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
          {filteredAndSortedProjects.map((project) => (
            <ProjectCard
              key={project.slug}
              project={project}
              onRegenerate={handleCreateNewClick}
              onDelete={handleDeleteClick}
              isRegenerating={regeneratingSlug === project.slug}
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
