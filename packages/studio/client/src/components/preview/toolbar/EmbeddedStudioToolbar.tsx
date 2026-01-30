import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Maximize2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { VersionSelector } from "@/components/projects/versioning";
import { ModeToggle, useTheme } from "@/components/theme";
import { usePermissions } from "@/hooks/usePermissions";
import { HeaderProfileMenu } from "@/components/shell";

import { useToolbarState } from "./useToolbarState";
import {
  ViewControls,
  EditControls,
  AgentButton,
  QuickActions,
  MobileActionsMenu,
  ToolbarDialogs,
} from "./components";

/**
 * EmbeddedStudioToolbar - A unified toolbar for embedded studio views that combines:
 * - Layout elements: SidebarTrigger, Breadcrumbs
 * - PreviewToolbar elements: View controls, edit buttons, actions
 *
 * Replaces the dual-header (Layout header + PreviewToolbar) with a single toolbar.
 */
export function EmbeddedStudioToolbar() {
  const { setTheme, theme } = useTheme();
  const { canUseAgent } = usePermissions();

  const state = useToolbarState();
  const {
    projectSlug,
    selectedVersion,
    versions,
    hasMultipleVersions,
    handleVersionSelect,
    handleClose,
    mobileView,
    setMobileView,
    selectedDevice,
    setSelectedDevice,
    assetsOpen,
    setAssetsOpen,
    chatOpen,
    setChatOpen,
    editMode,
    hasUnsavedChanges,
    toggleEditMode,
    originalUrl,
    fullUrl,
    copied,
    handleCopy,
    handleRefresh,
    historyPanelOpen,
    setHistoryPanelOpen,
    publishDialogOpen,
    setPublishDialogOpen,
    hasGitChanges,
    isPublished,
    publishStatus,
    handleLoadVersion,
    utils,
  } = state;

  return (
    <>
      <header className="px-2 md:px-4 py-2.5 border-b flex flex-row items-center gap-1 md:gap-2 shrink-0 z-10 bg-background overflow-x-auto">
        {/* Left Section: SidebarTrigger + Breadcrumbs */}
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-4 hidden sm:block" />

        <Breadcrumb className="hidden sm:flex">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/vivd-studio">Projects</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{projectSlug}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Version selector */}
        {projectSlug && (
          <VersionSelector
            selectedVersion={selectedVersion}
            versions={versions}
            onSelect={handleVersionSelect}
            triggerVariant="secondary"
            triggerClassName={
              hasMultipleVersions
                ? "shrink-0 text-xs px-2 py-0.5 font-normal cursor-pointer hover:bg-secondary/80 transition-colors"
                : "shrink-0 text-xs px-2 py-0.5 font-normal"
            }
            triggerTitle={
              hasMultipleVersions
                ? `Click to select from ${versions.length} versions`
                : undefined
            }
            align="start"
            label="Select Version"
          />
        )}

        {/* Separator */}
        <div className="hidden md:block h-5 w-px bg-border mx-1" />

        {/* View Controls */}
        <ViewControls
          mobileView={mobileView}
          setMobileView={setMobileView}
          selectedDevice={selectedDevice}
          setSelectedDevice={setSelectedDevice}
        />

        {/* Separator */}
        <div className="hidden md:block h-5 w-px bg-border mx-1" />

        {/* Edit Controls */}
        <EditControls
          projectSlug={projectSlug}
          assetsOpen={assetsOpen}
          setAssetsOpen={setAssetsOpen}
          editMode={editMode}
          hasUnsavedChanges={hasUnsavedChanges}
          toggleEditMode={toggleEditMode}
        />

        {/* Right Section */}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {/* Agent Button */}
          <AgentButton
            projectSlug={projectSlug}
            chatOpen={chatOpen}
            setChatOpen={setChatOpen}
            canUseAgent={canUseAgent}
          />

          {/* Quick Actions */}
          <QuickActions
            projectSlug={projectSlug}
            selectedVersion={selectedVersion}
            fullUrl={fullUrl}
            originalUrl={originalUrl}
            copied={copied}
            handleCopy={handleCopy}
            handleRefresh={handleRefresh}
            historyPanelOpen={historyPanelOpen}
            setHistoryPanelOpen={setHistoryPanelOpen}
            publishDialogOpen={publishDialogOpen}
            setPublishDialogOpen={setPublishDialogOpen}
            hasGitChanges={hasGitChanges}
            isPublished={isPublished}
            publishStatus={publishStatus}
            gradientId="favicon-gradient-embedded"
          />

          {/* Separator */}
          <div className="hidden md:block h-5 w-px bg-border mx-1" />

          {/* Theme Toggle */}
          <div className="hidden md:block">
            <ModeToggle />
          </div>

          {/* Profile Menu */}
          <HeaderProfileMenu />

          {/* Separator */}
          <div className="hidden md:block h-5 w-px bg-border mx-1" />

          {/* Mobile Menu Button */}
          <MobileActionsMenu
            mobileView={mobileView}
            setMobileView={setMobileView}
            selectedDevice={selectedDevice}
            setSelectedDevice={setSelectedDevice}
            projectSlug={projectSlug}
            selectedVersion={selectedVersion}
            originalUrl={originalUrl}
            fullUrl={fullUrl}
            copied={copied}
            assetsOpen={assetsOpen}
            setAssetsOpen={setAssetsOpen}
            chatOpen={chatOpen}
            setChatOpen={setChatOpen}
            editMode={editMode}
            hasUnsavedChanges={hasUnsavedChanges}
            toggleEditMode={toggleEditMode}
            handleRefresh={handleRefresh}
            handleCopy={handleCopy}
            setPublishDialogOpen={setPublishDialogOpen}
            setHistoryPanelOpen={setHistoryPanelOpen}
            hasGitChanges={hasGitChanges}
            isPublished={isPublished}
            publishStatus={publishStatus}
            theme={theme}
            setTheme={setTheme}
            canUseAgent={canUseAgent}
          />

          {/* Fullscreen Button */}
          {projectSlug && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                  <Link to={`/vivd-studio/projects/${projectSlug}/fullscreen`}>
                    <Maximize2 className="w-4 h-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fullscreen</TooltipContent>
            </Tooltip>
          )}

          {/* Close Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleClose}
              >
                <X className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Dialogs */}
      <ToolbarDialogs
        projectSlug={projectSlug}
        selectedVersion={selectedVersion}
        historyPanelOpen={historyPanelOpen}
        setHistoryPanelOpen={setHistoryPanelOpen}
        publishDialogOpen={publishDialogOpen}
        setPublishDialogOpen={setPublishDialogOpen}
        handleLoadVersion={handleLoadVersion}
        handleRefresh={handleRefresh}
        onPublished={() => {
          utils.project.publishStatus.invalidate({ slug: projectSlug! });
        }}
      />
    </>
  );
}
