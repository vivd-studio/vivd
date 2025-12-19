import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Loader2,
  Layers,
  Check,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export interface VersionInfo {
  version: number;
  createdAt: string;
  status: string;
}

export interface Project {
  slug: string;
  url: string;
  status: string;
  createdAt: string;
  currentVersion?: number;
  totalVersions?: number;
  versions?: VersionInfo[];
}

interface ProjectCardProps {
  project: Project;
  onRegenerate: (slug: string, version?: number) => void;
  isRegenerating: boolean;
}

export function ProjectCard({
  project,
  onRegenerate,
  isRegenerating,
}: ProjectCardProps) {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user?.role === "admin";
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

  const [selectedVersion, setSelectedVersion] = useState(
    project.currentVersion || 1
  );

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
    (v) => v.version === selectedVersion
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

  // Calculate progress and label
  let statusLabel = "Pending";
  let statusColor: "default" | "secondary" | "destructive" | "outline" =
    "secondary";

  switch (project.status) {
    case "pending":
      statusLabel = "Pending";
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

  // Version-aware preview URL
  const previewUrl = `/api/preview/${project.slug}/v${selectedVersion}/index.html`;

  return (
    <Card
      className={`flex flex-col h-full overflow-hidden transition-all hover:shadow-md min-h-[190px] ${
        isProcessing
          ? "border-primary ring-1 ring-primary/20 animate-pulse duration-3000"
          : ""
      } ${isCompleted ? "cursor-pointer hover:border-primary/50" : ""}`}
      onClick={() => {
        if (isCompleted) {
          navigate(`/vivd-studio/projects/${project.slug}`);
        }
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CardTitle
              className="text-lg font-medium truncate"
              title={project.slug}
            >
              {project.slug}
            </CardTitle>
            {totalVersions > 0 &&
              (hasMultipleVersions ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Badge
                      variant="secondary"
                      className="shrink-0 text-xs px-1.5 py-0 font-normal cursor-pointer hover:bg-secondary/80 transition-colors"
                      title={`Click to select from ${totalVersions} versions`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Layers className="w-3 h-3 mr-1" />v{selectedVersion}
                      <ChevronDown className="w-3 h-3 ml-1" />
                    </Badge>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuLabel>Select Version</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {versions.map((v) => (
                      <DropdownMenuItem
                        key={v.version}
                        onClick={() => handleVersionSelect(v.version)}
                        className={
                          selectedVersion === v.version ? "bg-accent" : ""
                        }
                      >
                        <Check
                          className={`w-4 h-4 mr-2 ${
                            selectedVersion === v.version
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                        />
                        <span>v{v.version}</span>
                        <span
                          className={`ml-auto text-xs ${
                            v.status === "completed"
                              ? "text-green-600"
                              : v.status === "failed"
                              ? "text-red-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {v.status === "completed"
                            ? "✓"
                            : v.status === "failed"
                            ? "✗"
                            : "..."}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Badge
                  variant="secondary"
                  className="shrink-0 text-xs px-1.5 py-0 font-normal"
                  title={`${totalVersions} version`}
                >
                  <Layers className="w-3 h-3 mr-1" />v{selectedVersion}
                </Badge>
              ))}
          </div>
          <Badge
            variant={statusColor}
            className={`shrink-0 ${
              isCompleted
                ? "bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 border-green-500/20"
                : ""
            }`}
          >
            {statusLabel}
          </Badge>
        </div>
        <div
          className="text-xs text-muted-foreground truncate"
          title={project.url}
        >
          {project.url}
        </div>
      </CardHeader>
      <CardContent className="pb-3 grow flex items-center justify-center">
        {isProcessing && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-medium">{statusLabel}...</span>
            </div>
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (
                    confirm(
                      `Force reset ${project.slug} v${selectedVersion} to 'failed' status?`
                    )
                  ) {
                    resetMutation.mutate({
                      slug: project.slug,
                      version: selectedVersion,
                    });
                  }
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
                  : "Force Reset (Admin)"}
              </Button>
            )}
          </div>
        )}

        {isFailed && (
          <div className="text-sm text-center text-destructive">
            Generation failed
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-0 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-muted-foreground hover:text-primary"
            disabled={!isCompleted}
            onClick={(e) => {
              e.stopPropagation();
              window.open(previewUrl, "_blank");
            }}
          >
            Open in new tab
          </Button>
          <span className="text-muted-foreground/30">•</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-muted-foreground hover:text-primary"
            disabled={!isCompleted}
            onClick={(e) => {
              e.stopPropagation();
              window.open(project.url, "_blank");
            }}
          >
            Original Website
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-1.5 border-indigo-300 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-400 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950 dark:hover:text-indigo-300"
          disabled={isProcessing || isRegenerating}
          onClick={(e) => {
            e.stopPropagation();
            onRegenerate(project.slug, selectedVersion);
          }}
          title="Create new version"
        >
          <Plus className={`w-4 h-4 ${isRegenerating ? "animate-spin" : ""}`} />
          <span className="text-xs font-medium">New</span>
        </Button>
      </CardFooter>
    </Card>
  );
}
