import { VersionSelector } from "@/components/projects/versioning";
import { ModeToggle, useTheme } from "@/components/theme";
import { usePermissions } from "@/hooks/usePermissions";
import faviconSvg from "/favicon-transparent.svg";
import { Maximize2, Minimize2, PanelLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

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

  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  const fullscreen = params.get("fullscreen") === "1";

  const state = useToolbarState();
  const {
    projectSlug,
    embedded,
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
    publicPreviewEnabled,
    handleLoadVersion,
    utils,
    handleClose,
  } = state;

  const showClose = embedded || !!returnTo;

  const handleToggleFullscreen = () => {
    if (!embedded) return;
    window.parent?.postMessage(
      { type: fullscreen ? "vivd:studio:exitFullscreen" : "vivd:studio:fullscreen" },
      "*",
    );
  };

  const handleHardRestart = () => {
    if (!embedded) return;

    const message = hasUnsavedChanges
      ? "Hard restart the studio? You have unsaved changes that may be lost."
      : "Hard restart the studio? This may interrupt the current session.";
    if (!window.confirm(message)) return;

    window.parent?.postMessage(
      {
        type: "vivd:studio:hardRestart",
        slug: projectSlug,
        version: selectedVersion,
      },
      "*",
    );
  };

  return (
    <>
      <header className="px-2 md:px-4 py-2.5 border-b flex flex-row items-center gap-1 md:gap-2 shrink-0 z-30 bg-background overflow-x-auto">
        {/* Left Section: Sidebar Toggle (embedded) or App Icon */}
        {embedded && !fullscreen ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              window.parent?.postMessage(
                { type: "vivd:studio:toggleSidebar" },
                "*",
              );
            }}
          >
            <PanelLeft />
            <span className="sr-only">Toggle Sidebar</span>
          </Button>
        ) : (
          <div className="flex items-center">
            <img src={faviconSvg} alt="vivd" className="h-6 w-6 shrink-0" />
          </div>
        )}

        {/* Separator */}
        <div className="hidden sm:block h-5 w-px bg-border mx-1" />

        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          {embedded ? (
            <Breadcrumb className="hidden sm:flex">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <button
                      type="button"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      onClick={handleClose}
                    >
                      Projects
                    </button>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{projectSlug}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          ) : (
            <span className="hidden sm:inline font-medium text-muted-foreground">
              Preview
            </span>
          )}
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
            selectedVersion={selectedVersion}
            fullUrl={fullUrl}
            originalUrl={originalUrl}
            copied={copied}
            publicPreviewEnabled={publicPreviewEnabled}
            handleCopy={handleCopy}
            handleRefresh={handleRefresh}
            historyPanelOpen={historyPanelOpen}
            setHistoryPanelOpen={setHistoryPanelOpen}
            publishDialogOpen={publishDialogOpen}
            setPublishDialogOpen={setPublishDialogOpen}
            hasGitChanges={hasGitChanges}
            isPublished={isPublished}
            publishStatus={publishStatus}
            embedded={embedded}
            onHardRestart={handleHardRestart}
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
            publicPreviewEnabled={publicPreviewEnabled}
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

          {/* Embedded-only actions */}
          {embedded ? (
            <>
              <div className="hidden md:block h-5 w-px bg-border mx-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleFullscreen}
                className="h-8 w-8 p-0"
                title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {fullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
            </>
          ) : null}

          {showClose ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="h-8 w-8 p-0"
              title="Close"
            >
              <X className="w-4 h-4" />
            </Button>
          ) : null}
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
