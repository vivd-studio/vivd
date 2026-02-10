import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Check,
  Copy,
  ExternalLink,
  History,
  MoreHorizontal,
  RefreshCw,
  Rocket,
} from "lucide-react";

interface QuickActionsProps {
  projectSlug: string | undefined;
  fullUrl: string;
  originalUrl: string | null | undefined;
  copied: boolean;
  publicPreviewEnabled: boolean;
  handleCopy: () => void;
  handleRefresh: () => void;
  historyPanelOpen: boolean;
  setHistoryPanelOpen: (value: boolean) => void;
  publishDialogOpen: boolean;
  setPublishDialogOpen: (value: boolean) => void;
  hasGitChanges: boolean;
  isPublished: boolean;
  publishStatus?: {
    mode?: "connected" | "standalone";
    domain?: string | null;
    lastTag?: string | null;
  };
  gradientId?: string;
}

export function QuickActions({
  projectSlug,
  fullUrl,
  originalUrl,
  copied,
  publicPreviewEnabled,
  handleCopy,
  handleRefresh,
  historyPanelOpen,
  setHistoryPanelOpen,
  setPublishDialogOpen,
  hasGitChanges,
  isPublished,
  publishStatus,
  gradientId = "favicon-gradient",
}: QuickActionsProps) {
  const canCopyPreviewUrl = Boolean(projectSlug) && publicPreviewEnabled;
  return (
    <>
      {/* Publish Button */}
      {projectSlug && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPublishDialogOpen(true)}
              className="hidden sm:flex h-8 w-8 p-0"
            >
              <Rocket
                className="w-4 h-4"
                style={{
                  stroke: `url(#${gradientId})`,
                }}
              />
              <svg width="0" height="0" className="absolute">
                <defs>
                  <linearGradient
                    id={gradientId}
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#F59E0B" />
                  </linearGradient>
                </defs>
              </svg>
            </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isPublished
            ? publishStatus?.domain
              ? `Published: ${publishStatus.domain}`
              : publishStatus?.lastTag
                ? `Published: ${publishStatus.lastTag}`
                : "Published"
            : publishStatus?.mode === "connected"
              ? "Publish site"
              : "Create a git tag"}
        </TooltipContent>
      </Tooltip>
      )}

      {/* History/Snapshots button */}
      {projectSlug && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={historyPanelOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setHistoryPanelOpen(true)}
              className="hidden sm:flex h-8 w-8 p-0 relative"
            >
              <History className="w-4 h-4" />
              {hasGitChanges && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-amber-500 rounded-full" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {hasGitChanges
              ? "Snapshots (pending changes)"
              : "Snapshots & History"}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Refresh button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            className="hidden sm:flex h-8 w-8 p-0"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh Preview</TooltipContent>
      </Tooltip>

      {/* More Actions Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:flex h-8 w-8 p-0"
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleCopy} disabled={!canCopyPreviewUrl}>
            {copied ? (
              <Check className="w-4 h-4 mr-2 text-green-600" />
            ) : (
              <Copy className="w-4 h-4 mr-2" />
            )}
            {copied
              ? "Copied!"
              : publicPreviewEnabled
                ? "Copy preview URL"
                : "Preview URL disabled"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.open(fullUrl, "_blank")}>
            <ExternalLink className="w-4 h-4 mr-2" />
            Open in New Tab
          </DropdownMenuItem>
          {projectSlug && (
            <>
              {originalUrl && (
                <DropdownMenuItem
                  onClick={() => window.open(originalUrl, "_blank")}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Original Website
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
