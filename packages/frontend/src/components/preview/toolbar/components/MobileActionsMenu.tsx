import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Check,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FolderOpen,
  Globe,
  History,
  Laptop,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  Rocket,
  RefreshCw,
  Smartphone,
  Sun,
} from "lucide-react";
import { DEVICE_PRESETS } from "../../types";
import type { DevicePreset } from "../../types";
import { ROUTES } from "@/app/router";

interface MobileActionsMenuProps {
  // View state
  mobileView: boolean;
  setMobileView: (value: boolean) => void;
  selectedDevice: DevicePreset;
  setSelectedDevice: (device: DevicePreset) => void;

  // Project state
  projectSlug: string | undefined;
  selectedVersion: number;
  originalUrl: string | null | undefined;
  fullUrl: string;
  copied: boolean;

  // Edit state
  assetsOpen: boolean;
  setAssetsOpen: (value: boolean) => void;
  chatOpen: boolean;
  setChatOpen: (value: boolean) => void;
  editMode: boolean;
  hasUnsavedChanges: boolean;
  toggleEditMode: () => void;

  // Actions
  handleRefresh: () => void;
  handleCopy: () => void;
  setPublishDialogOpen: (value: boolean) => void;
  setHistoryPanelOpen: (value: boolean) => void;

  // Status
  hasGitChanges: boolean;
  isPublished: boolean;
  publishStatus?: { domain?: string | null };

  // Theme
  theme: string;
  setTheme: (theme: "light" | "dark" | "system") => void;

  // Permissions
  canUseAgent: boolean;

  // Optional: User menu items (for PreviewToolbar)
  userMenuContent?: React.ReactNode;
}

export function MobileActionsMenu({
  mobileView,
  setMobileView,
  selectedDevice,
  setSelectedDevice,
  projectSlug,
  selectedVersion,
  originalUrl,
  fullUrl,
  copied,
  assetsOpen,
  setAssetsOpen,
  chatOpen,
  setChatOpen,
  editMode,
  hasUnsavedChanges,
  toggleEditMode,
  handleRefresh,
  handleCopy,
  setPublishDialogOpen,
  setHistoryPanelOpen,
  hasGitChanges,
  isPublished,
  publishStatus,
  theme,
  setTheme,
  canUseAgent,
  userMenuContent,
}: MobileActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 md:hidden">
          <Menu className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* View Controls Group */}
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setMobileView(false)}>
          <Monitor className="w-4 h-4 mr-2" />
          Desktop View
          {!mobileView && <Check className="w-4 h-4 ml-auto" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMobileView(true)}>
          <Smartphone className="w-4 h-4 mr-2" />
          Mobile View
          {mobileView && <Check className="w-4 h-4 ml-auto" />}
        </DropdownMenuItem>

        {mobileView && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Smartphone className="w-4 h-4 mr-2" />
              Device: {selectedDevice.name}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {DEVICE_PRESETS.map((device) => (
                <DropdownMenuItem
                  key={device.name}
                  onClick={() => setSelectedDevice(device)}
                >
                  {selectedDevice.name === device.name && (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  <span
                    className={
                      selectedDevice.name === device.name ? "" : "ml-6"
                    }
                  >
                    {device.name}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {device.width}×{device.height}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />

        {/* Panels Group */}
        {projectSlug && (
          <>
            <DropdownMenuLabel>Panels</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setAssetsOpen(!assetsOpen)}>
              <FolderOpen className="w-4 h-4 mr-2" />
              {assetsOpen ? "Hide Assets" : "Show Assets"}
            </DropdownMenuItem>
            {canUseAgent && (
              <DropdownMenuItem onClick={() => setChatOpen(!chatOpen)}>
                <MessageSquare className="w-4 h-4 mr-2" />
                {chatOpen ? "Hide Agent" : "Show Agent"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={toggleEditMode}
              disabled={hasUnsavedChanges && !editMode}
            >
              <Edit3 className="w-4 h-4 mr-2" />
              {editMode ? "Stop Editing" : "Edit Text"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Quick Actions */}
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuItem onClick={handleRefresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh Preview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopy}>
          <Copy className="w-4 h-4 mr-2" />
          {copied ? "Copied!" : "Copy Link"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(fullUrl, "_blank")}>
          <ExternalLink className="w-4 h-4 mr-2" />
          Open in New Tab
        </DropdownMenuItem>

        {projectSlug && (
          <>
            <DropdownMenuItem
              onClick={() => {
                const baseUrl = import.meta.env.VITE_BACKEND_URL || "";
                window.open(
                  `${baseUrl}${ROUTES.API_DOWNLOAD(projectSlug, selectedVersion)}`,
                  "_blank"
                );
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Download as ZIP
            </DropdownMenuItem>
            {originalUrl && (
              <DropdownMenuItem
                onClick={() => window.open(originalUrl, "_blank")}
              >
                <Globe className="w-4 h-4 mr-2" />
                View Original Website
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Manage</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setPublishDialogOpen(true)}>
              <Rocket className="w-4 h-4 mr-2" />
              {isPublished
                ? `Live at ${publishStatus?.domain}`
                : "Publish to Web"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setHistoryPanelOpen(true)}>
              <History className="w-4 h-4 mr-2" />
              Snapshots & History
              {hasGitChanges && (
                <span className="ml-auto h-2 w-2 bg-amber-500 rounded-full" />
              )}
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />

        {/* Theme */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === "light" ? (
              <Sun className="w-4 h-4 mr-2" />
            ) : theme === "dark" ? (
              <Moon className="w-4 h-4 mr-2" />
            ) : (
              <Laptop className="w-4 h-4 mr-2" />
            )}
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="w-4 h-4 mr-2" />
              Light
              {theme === "light" && <Check className="w-4 h-4 ml-auto" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="w-4 h-4 mr-2" />
              Dark
              {theme === "dark" && <Check className="w-4 h-4 ml-auto" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Laptop className="w-4 h-4 mr-2" />
              System
              {theme === "system" && <Check className="w-4 h-4 ml-auto" />}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Optional user menu content (for PreviewToolbar) */}
        {userMenuContent}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
