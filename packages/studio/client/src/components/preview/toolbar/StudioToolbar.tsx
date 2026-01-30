import { VersionSelector } from "@/components/projects/versioning";
import { ModeToggle, useTheme } from "@/components/theme";
import { usePermissions } from "@/hooks/usePermissions";
import faviconSvg from "/favicon-transparent.svg";

import { useToolbarState } from "./useToolbarState";
import {
  AgentButton,
  EditControls,
  MobileActionsMenu,
  QuickActions,
  ToolbarDialogs,
  ViewControls,
} from "./components";

/**
 * StudioToolbar - Standalone toolbar for the single-instance studio.
 * Keeps the same look/feel as the studio toolbar, but without auth/profile UI.
 */
export function StudioToolbar() {
  const { setTheme, theme } = useTheme();
  const { canUseAgent } = usePermissions();

  const state = useToolbarState();
  const {
    projectSlug,
    originalUrl,
    copied,
    selectedVersion,
    versions,
    hasMultipleVersions,
    handleVersionSelect,
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
    fullUrl,
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
        {/* Left Section: App Icon + Preview Identity */}
        <div className="flex items-center">
          <img src={faviconSvg} alt="vivd" className="h-6 w-6 shrink-0" />
        </div>

        {/* Separator */}
        <div className="hidden sm:block h-5 w-px bg-border mx-1" />

        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          <span className="hidden sm:inline font-medium text-muted-foreground">
            Preview
          </span>
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
        </div>

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
          />

          {/* Separator */}
          <div className="hidden md:block h-5 w-px bg-border mx-1" />

          {/* Theme Toggle */}
          <div className="hidden md:block">
            <ModeToggle />
          </div>

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
        </div>
      </header>

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
