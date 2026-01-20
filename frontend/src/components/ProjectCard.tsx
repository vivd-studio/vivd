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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Loader2,
  RotateCcw,
  Globe,
  Trash2,
  MoreVertical,
  Download,
  ExternalLink,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { VersionSelector } from "@/components/VersionSelector";
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
  status: string;
  createdAt: string;
  currentVersion?: number;
  totalVersions?: number;
  versions?: VersionInfo[];
  publishedDomain?: string | null;
  publishedVersion?: number | null;
}

interface ProjectCardProps {
  project: Project;
  onRegenerate: (slug: string, version?: number) => void;
  onDelete: (slug: string) => void;
  isRegenerating: boolean;
}

export function ProjectCard({
  project,
  onRegenerate,
  onDelete,
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
    project.currentVersion || 1,
  );
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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
  const isUrlProject = (project.source || "url") === "url";
  const subtitle = isUrlProject
    ? project.url
    : project.title
      ? `“${project.title}”`
      : "Start-from-scratch project";

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

  const projectEditorUrl = `/vivd-studio/projects/${project.slug}`;

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
            {!isCompleted && (
              <Badge
                variant={statusColor}
                className="shrink-0"
              >
                {statusLabel}
              </Badge>
            )}
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
                href={`https://${project.publishedDomain}`}
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
        <CardContent className="pb-1.5 px-4 grow flex items-center justify-center">
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
                    : "Force Reset (Admin)"}
                </Button>
              )}
            </div>
          )}

          {isFailed && (
            <div className="text-sm text-center text-destructive space-y-1">
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
          <DropdownMenu>
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
            >
              <DropdownMenuItem
                onClick={() => window.open(projectEditorUrl, "_blank")}
                disabled={!isCompleted}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in new tab
              </DropdownMenuItem>
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
    </>
  );
}
