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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Layers,
  ChevronDown,
  Smartphone,
  Monitor,
  Edit3,
  MoreHorizontal,
  Globe,
  FolderOpen,
  MessageSquare,
} from "lucide-react";
import { usePreviewModal } from "./PreviewModalContext";
import { DEVICE_PRESETS } from "./types";

export function PreviewToolbar() {
  const {
    projectSlug,
    originalUrl,
    copied,
    selectedVersion,
    mobileView,
    setMobileView,
    selectedDevice,
    setSelectedDevice,
    editMode,
    hasUnsavedChanges,
    fullUrl,
    versions,
    hasMultipleVersions,
    handleVersionSelect,
    handleCopy,
    handleRefresh,
    toggleEditMode,
    assetsOpen,
    setAssetsOpen,
    chatOpen,
    setChatOpen,
  } = usePreviewModal();

  return (
    <DialogHeader className="px-4 py-2.5 border-b flex flex-row items-center gap-2 space-y-0 shrink-0 z-10 bg-background">
      {/* Left Section: Identity */}
      <DialogTitle className="flex items-center gap-2 shrink-0">
        <span className="font-semibold">Preview</span>
        {projectSlug && hasMultipleVersions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Badge
                variant="secondary"
                className="shrink-0 text-xs px-2 py-0.5 font-normal cursor-pointer hover:bg-secondary/80 transition-colors"
                title={`Click to select from ${versions.length} versions`}
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
                  className={selectedVersion === v.version ? "bg-accent" : ""}
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
        ) : projectSlug ? (
          <Badge
            variant="secondary"
            className="shrink-0 text-xs px-2 py-0.5 font-normal"
          >
            <Layers className="w-3 h-3 mr-1" />v{selectedVersion}
          </Badge>
        ) : null}
      </DialogTitle>

      {/* Separator */}
      <div className="h-5 w-px bg-border mx-1" />

      {/* Center Section: View Controls */}
      <div className="flex items-center gap-1">
        {/* Viewport Toggle */}
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={!mobileView ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMobileView(false)}
                className="rounded-r-none px-2.5"
              >
                <Monitor className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Desktop View</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={mobileView ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMobileView(true)}
                className="rounded-l-none border-l-0 px-2.5"
              >
                <Smartphone className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mobile View</TooltipContent>
          </Tooltip>
        </div>

        {/* Device Selector (only when mobile) */}
        {mobileView && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1 text-xs h-8">
                {selectedDevice.name}
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Select Device</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {DEVICE_PRESETS.map((device) => (
                <DropdownMenuItem
                  key={device.name}
                  onClick={() => setSelectedDevice(device)}
                  className={
                    selectedDevice.name === device.name ? "bg-accent" : ""
                  }
                >
                  <Check
                    className={`w-4 h-4 mr-2 ${
                      selectedDevice.name === device.name
                        ? "opacity-100"
                        : "opacity-0"
                    }`}
                  />
                  <span>{device.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {device.width}×{device.height}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-border mx-1" />

      {/* Edit Controls */}
      {projectSlug && (
        <div className="flex items-center gap-1">
          {/* Edit button - disabled when in edit mode or when there are unsaved changes */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant={editMode ? "secondary" : "outline"}
                  size="sm"
                  onClick={toggleEditMode}
                  disabled={hasUnsavedChanges && !editMode}
                  className={`h-8 ${
                    !editMode && !hasUnsavedChanges
                      ? "bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white border-none"
                      : ""
                  }`}
                >
                  <Edit3 className="w-4 h-4 mr-1.5" />
                  {editMode ? "Editing..." : "Edit Text"}
                </Button>
              </span>
            </TooltipTrigger>
            {hasUnsavedChanges && !editMode && (
              <TooltipContent>
                Save or discard image changes first
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      )}

      {/* Right Section: Panel Toggles + Quick Actions (pushed to right) */}
      <div className="flex items-center gap-1 ml-auto mr-4 md:mr-10">
        {/* Panel Toggles */}
        {projectSlug && (
          <>
            <Button
              variant={assetsOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => setAssetsOpen(!assetsOpen)}
              className={`h-8 ${
                !assetsOpen
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white border-none"
                  : ""
              }`}
            >
              <FolderOpen className="w-4 h-4 mr-1.5" />
              Assets
            </Button>

            <Button
              variant={chatOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => setChatOpen(!chatOpen)}
              className={`h-8 ${
                !chatOpen
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white border-none"
                  : ""
              }`}
            >
              <MessageSquare className="w-4 h-4 mr-1.5" />
              Agent
            </Button>

            <div className="h-5 w-px bg-border mx-1" />
          </>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh Preview</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-8 w-8 p-0"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied!" : "Copy Link"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(fullUrl, "_blank")}
              className="h-8 w-8 p-0"
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open in New Tab</TooltipContent>
        </Tooltip>

        {/* More Actions Dropdown */}
        {originalUrl && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => window.open(originalUrl, "_blank")}
              >
                <Globe className="w-4 h-4 mr-2" />
                View Original Website
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </DialogHeader>
  );
}
