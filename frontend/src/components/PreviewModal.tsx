import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  FolderOpen,
  Layers,
  ChevronDown,
} from "lucide-react";
import { useState, useEffect } from "react";
import { ChatPanel } from "./ChatSidepanel";
import { AssetExplorer } from "./AssetExplorer";
import { ResizeHandle } from "./ResizeHandle";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { trpc } from "@/lib/trpc";

interface PreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  originalUrl?: string | null;
  projectSlug?: string;
  version?: number;
}

export function PreviewModal({
  open,
  onOpenChange,
  url,
  originalUrl,
  projectSlug,
  version,
}: PreviewModalProps) {
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState(version || 1);

  const utils = trpc.useUtils();

  // Fetch project data to get version information
  const { data: projectsData } = trpc.project.list.useQuery(undefined, {
    enabled: open && !!projectSlug,
  });

  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const versions = project?.versions || [];
  const totalVersions = project?.totalVersions || 1;
  const hasMultipleVersions = totalVersions > 1;

  const setCurrentVersionMutation = trpc.project.setCurrentVersion.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
    },
  });

  // Sync selectedVersion with incoming version prop
  useEffect(() => {
    if (version && version !== selectedVersion) {
      setSelectedVersion(version);
    }
  }, [version]);

  const handleVersionSelect = (newVersion: number) => {
    setSelectedVersion(newVersion);
    if (projectSlug) {
      setCurrentVersionMutation.mutate({
        slug: projectSlug,
        version: newVersion,
      });
    }
    // Refresh iframe to show new version
    setRefreshKey((prev) => prev + 1);
  };

  const assetPanel = useResizablePanel({
    storageKey: "previewModal.assetPanelWidth",
    defaultWidth: 320,
    minWidth: 250,
    maxWidth: 500,
    side: "left",
  });

  const chatPanel = useResizablePanel({
    storageKey: "previewModal.chatPanelWidth",
    defaultWidth: 400,
    minWidth: 320,
    maxWidth: 600,
    side: "right",
  });

  if (!url) return null;

  // Build version-aware URL
  const baseUrl = projectSlug
    ? `/api/preview/${projectSlug}/v${selectedVersion}/index.html`
    : url.startsWith("http") || url.startsWith("/api")
    ? url
    : `/api${url}`;
  const fullUrl = baseUrl;

  const handleCopy = () => {
    const absoluteUrl = fullUrl.startsWith("http")
      ? fullUrl
      : `${window.location.origin}${fullUrl}`;

    navigator.clipboard.writeText(absoluteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTaskComplete = () => {
    // Refresh the iframe
    setRefreshKey((prev) => prev + 1);
  };

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] w-screen h-screen flex flex-col p-0 gap-0 overflow-hidden rounded-none border-0">
        <DialogHeader className="px-6 py-3 border-b flex flex-row items-center gap-4 space-y-0 shrink-0 z-10 bg-background">
          <DialogTitle className="flex items-center gap-3">
            Preview
            {projectSlug && hasMultipleVersions ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-xs px-2 py-0.5 font-normal cursor-pointer hover:bg-secondary/80 transition-colors"
                    title={`Click to select from ${totalVersions} versions`}
                  >
                    <Layers className="w-3 h-3 mr-1" />v{selectedVersion}
                    <ChevronDown className="w-3 h-3 ml-1" />
                  </Badge>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
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
            ) : projectSlug && totalVersions > 0 ? (
              <Badge
                variant="secondary"
                className="shrink-0 text-xs px-2 py-0.5 font-normal"
              >
                <Layers className="w-3 h-3 mr-1" />v{selectedVersion}
              </Badge>
            ) : null}
          </DialogTitle>
          <div className="flex items-center gap-2 ml-auto mr-4 md:mr-12 overflow-x-auto max-w-full">
            {originalUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(originalUrl, "_blank")}
                className="text-muted-foreground"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Original Website
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              title="Refresh Preview"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <Check className="w-4 h-4 mr-2" />
              ) : (
                <Copy className="w-4 h-4 mr-2" />
              )}
              {copied ? "Copied" : "Copy preview link"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(fullUrl, "_blank")}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Page
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 relative">
          {/* Asset Explorer Panel - Left side */}
          {projectSlug && version !== undefined && assetsOpen && (
            <div
              className="relative border-r bg-background flex flex-col h-full shadow-xl z-20"
              style={{ width: assetPanel.width }}
            >
              <AssetExplorer
                projectSlug={projectSlug}
                version={version}
                onClose={() => setAssetsOpen(false)}
              />
              <ResizeHandle
                side="left"
                onMouseDown={assetPanel.handleMouseDown}
              />
            </div>
          )}

          <div className="flex-1 relative bg-muted/20">
            <iframe
              key={refreshKey}
              src={fullUrl}
              className="w-full h-full border-0"
              title="Preview"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              onLoad={(e) => {
                const iframe = e.currentTarget;
                try {
                  const doc = iframe.contentDocument;
                  if (doc) {
                    const style = doc.createElement("style");
                    style.textContent = `
                                            ::-webkit-scrollbar {
                                                width: 14px;
                                                height: 14px;
                                            }
                                            ::-webkit-scrollbar-track {
                                                background: transparent;
                                            }
                                            ::-webkit-scrollbar-thumb {
                                                background-color: rgba(156, 163, 175, 0.5);
                                                border-radius: 5px;
                                                border: 2px solid transparent;
                                                background-clip: content-box;
                                            }
                                            ::-webkit-scrollbar-thumb:hover {
                                                background-color: rgba(156, 163, 175, 0.8);
                                            }
                                        `;
                    doc.head.appendChild(style);
                  }
                } catch (err) {
                  console.warn("Could not inject styles into iframe", err);
                }
              }}
            />

            {/* Floating Asset Button - Left side */}
            {projectSlug && version !== undefined && !assetsOpen && (
              <Button
                className="absolute bottom-8 left-8 rounded-full h-14 w-14 shadow-lg p-0 bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 border-none"
                onClick={() => setAssetsOpen(true)}
                title="Open Asset Explorer"
              >
                <FolderOpen className="w-6 h-6 text-white" />
              </Button>
            )}

            {/* Floating Chat Button - Right side */}
            {projectSlug && !chatOpen && (
              <Button
                className="absolute bottom-8 right-8 rounded-full h-14 w-14 shadow-lg p-0 bg-gradient-to-br from-indigo-600 to-violet-600 animate-bop animate-pulse-outline hover:from-indigo-500 hover:to-violet-500 border-none"
                onClick={() => setChatOpen(true)}
              >
                <img
                  src="/favicon-transparent.svg"
                  alt="App Logo"
                  className="w-10 h-10"
                />
              </Button>
            )}
          </div>

          {/* Chat Panel - Right side */}
          {projectSlug && chatOpen && (
            <div
              className="relative border-l bg-background flex flex-col h-full shadow-xl z-20"
              style={{ width: chatPanel.width }}
            >
              <ResizeHandle
                side="right"
                onMouseDown={chatPanel.handleMouseDown}
              />
              <ChatPanel
                key={`${projectSlug}-${version}`}
                projectSlug={projectSlug}
                version={version}
                onTaskComplete={handleTaskComplete}
                onClose={() => setChatOpen(false)}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
