import { useEffect, useRef, useState } from "react";
import { VersionSelector } from "@/components/projects/versioning";
import { ModeToggle, useTheme } from "@/components/theme";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import faviconSvg from "/favicon-transparent.svg";
import {
  FolderOpen,
  History,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelLeft,
  Plug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useToolbarState } from "./useToolbarState";
import {
  BrowserBar,
  EditControls,
  MobileActionsMenu,
  QuickActions,
  ToolbarDialogs,
} from "./components";

/**
 * StudioToolbar - Standalone toolbar for the single-instance studio.
 * Keeps the same look/feel as the studio toolbar, but without auth/profile UI.
 */
export function StudioToolbar() {
  const { setTheme, theme } = useTheme();
  const { canUseAgent } = usePermissions();

  const params = new URLSearchParams(window.location.search);
  const fullscreen = params.get("fullscreen") === "1";

  const state = useToolbarState();
  const {
    projectSlug,
    embedded,
    originalUrl,
    copied,
    selectedVersion,
    previewMode,
    versions,
    hasMultipleVersions,
    analyticsAvailable,
    handleVersionSelect,
    viewportMode,
    setViewportMode,
    selectedDevice,
    setSelectedDevice,
    assetsOpen,
    setAssetsOpen,
    pluginsOpen,
    setPluginsOpen,
    chatOpen,
    chatPanel,
    setChatOpen,
    sessionHistoryOpen,
    setSessionHistoryOpen,
    editMode,
    hasUnsavedChanges,
    toggleEditMode,
    fullUrl,
    currentPreviewPath,
    handleCopy,
    handleRefresh,
    navigatePreviewPath,
    historyPanelOpen,
    setHistoryPanelOpen,
    publishDialogOpen,
    setPublishDialogOpen,
    hasGitChanges,
    isPublished,
    publishStatus,
    publicPreviewEnabled,
    handleLoadVersion,
    isLoadingVersion,
    loadingVersionHash,
    utils,
    handleClose,
    isConnectedMode,
    handleTogglePreviewUrl,
    isTogglingPreviewUrl,
    handleRegenerateThumbnail,
    isRegeneratingThumbnail,
    handleDeleteProject,
    isDeletingProject,
    handleRestartDevServer,
    isRestartingDevServer,
    devServerRestartKind,
  } = state;

  const leadingContentRef = useRef<HTMLDivElement>(null);
  const workspaceControlsRef = useRef<HTMLDivElement>(null);
  const trailingActionsRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  const [leadingChromeWidth, setLeadingChromeWidth] = useState(0);
  const [workspaceControlsWidth, setWorkspaceControlsWidth] = useState(0);
  const [trailingChromeWidth, setTrailingChromeWidth] = useState(0);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const leadingNode = leadingContentRef.current;
    if (!leadingNode) return;

    const updateMetrics = () => {
      setLeadingChromeWidth(leadingNode.offsetWidth);
    };

    updateMetrics();

    const observer = new ResizeObserver(updateMetrics);
    if (leadingNode) observer.observe(leadingNode);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controlsNode = workspaceControlsRef.current;
    if (!controlsNode) return;

    const updateWidth = () => {
      setWorkspaceControlsWidth(controlsNode.offsetWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(controlsNode);

    return () => observer.disconnect();
  }, [
    projectSlug,
    canUseAgent,
    assetsOpen,
    pluginsOpen,
    chatOpen,
    sessionHistoryOpen,
    editMode,
  ]);

  useEffect(() => {
    const trailingNode = trailingActionsRef.current;
    if (!trailingNode) return;

    const updateWidth = () => {
      setTrailingChromeWidth(trailingNode.offsetWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(trailingNode);

    return () => observer.disconnect();
  }, [embedded, fullscreen]);

  const handleToggleChat = () => {
    if (chatOpen && !sessionHistoryOpen) {
      setChatOpen(false);
      return;
    }
    setChatOpen(true);
    setSessionHistoryOpen(false);
  };

  const handleToggleSessionHistory = () => {
    if (sessionHistoryOpen) {
      setSessionHistoryOpen(false);
      setChatOpen(true);
      return;
    }
    setChatOpen(true);
    setSessionHistoryOpen(true);
  };

  const handleTogglePlugins = () => {
    setPluginsOpen(!pluginsOpen);
  };

  const expandableToggleClass = (active: boolean, expandedWidth: string) =>
    cn(
      "h-8 justify-start gap-0 overflow-hidden rounded-lg px-0 transition-[width,background-color,color,box-shadow] duration-200 ease-out",
      active
        ? `${expandedWidth} bg-primary/10 text-primary shadow-sm`
        : "w-8 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    );

  const expandableToggleLabelClass = (active: boolean) =>
    cn(
      "overflow-hidden whitespace-nowrap text-[13px] font-medium transition-[max-width,opacity,padding] duration-200 ease-out",
      active ? "max-w-24 pl-0.5 pr-2.5 opacity-100" : "max-w-0 pl-0 pr-0 opacity-0",
    );

  const headerHorizontalPadding = 16;
  const collapsedPreviewInset = 6;
  const sessionExpandedWidth = 94;
  const explorerExpandedWidth = 96;
  const pluginExpandedWidth = 88;
  const sessionToggleGap = canUseAgent ? 4 : 0;
  const shouldReserveSessionSlot = chatOpen;
  const workspaceLeadingEdge = chatOpen
    ? chatPanel.width
    : leadingChromeWidth + headerHorizontalPadding + 12;
  const workspaceBarRightClearance = Math.max(
    0,
    trailingChromeWidth + headerHorizontalPadding + 6,
  );
  const previewWorkspaceWidth = Math.max(
    0,
    viewportWidth - workspaceLeadingEdge - workspaceBarRightClearance,
  );
  const shouldCollapseRightSideLabels = previewWorkspaceWidth < 340;
  const shouldExpandSessionLabel =
    previewWorkspaceWidth >= 280 && chatOpen && sessionHistoryOpen;
  const shouldExpandExplorerLabel =
    !shouldCollapseRightSideLabels && assetsOpen;
  const shouldExpandPluginsLabel =
    !shouldCollapseRightSideLabels && pluginsOpen;
  const sessionToggleWidth =
    canUseAgent && shouldReserveSessionSlot ? sessionExpandedWidth : 0;
  const workspaceControlStart = chatOpen
    ? chatPanel.width - (sessionToggleWidth + sessionToggleGap + 16)
    : leadingChromeWidth + headerHorizontalPadding + 12;
  const workspaceControlsOffset = workspaceControlStart - workspaceLeadingEdge;
  const workspaceBarLeftClearance = Math.max(
    0,
    workspaceControlsWidth + workspaceControlsOffset + 12,
  );
  const maxLeadingWidth = chatOpen
    ? Math.max(148, workspaceControlStart - headerHorizontalPadding - 12)
    : undefined;
  const shouldCompressLeadingIdentity =
    typeof maxLeadingWidth === "number" && maxLeadingWidth < 320;
  const slugMaxWidth = shouldCompressLeadingIdentity ? 112 : 220;

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

  const desktopWorkspaceControls = projectSlug ? (
    <div ref={workspaceControlsRef} className="flex items-center gap-1">
      {canUseAgent ? (
        <div
          className="flex justify-end transition-[width] duration-200 ease-out"
          style={{ width: shouldReserveSessionSlot ? sessionExpandedWidth : 32 }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleSessionHistory}
            className={expandableToggleClass(
              shouldExpandSessionLabel,
              `w-[${sessionExpandedWidth}px]`,
            )}
            title={chatOpen && sessionHistoryOpen ? "Hide sessions" : "Show sessions"}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <History className="h-4 w-4" />
            </span>
            <span
              aria-hidden="true"
              className={expandableToggleLabelClass(shouldExpandSessionLabel)}
            >
              Sessions
            </span>
            <span className="sr-only">
              {chatOpen && sessionHistoryOpen ? "Hide sessions" : "Show sessions"}
            </span>
          </Button>
        </div>
      ) : null}

      {canUseAgent ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleToggleChat}
          className={`h-8 w-8 rounded-lg ${
            chatOpen && !sessionHistoryOpen
              ? "bg-primary/10 text-primary shadow-sm"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          }`}
          title={chatOpen && !sessionHistoryOpen ? "Hide chat" : "Show chat"}
        >
          <MessageSquare className="h-4 w-4" />
          <span className="sr-only">
            {chatOpen && !sessionHistoryOpen ? "Hide chat" : "Show chat"}
          </span>
        </Button>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setAssetsOpen(!assetsOpen)}
        className={expandableToggleClass(
          shouldExpandExplorerLabel,
          `w-[${explorerExpandedWidth}px]`,
        )}
        title={assetsOpen ? "Hide explorer" : "Show explorer"}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center">
          <FolderOpen className="h-4 w-4" />
        </span>
        <span
          aria-hidden="true"
          className={expandableToggleLabelClass(shouldExpandExplorerLabel)}
        >
          Explorer
        </span>
        <span className="sr-only">
          {assetsOpen ? "Hide explorer" : "Show explorer"}
        </span>
      </Button>

      <EditControls
        projectSlug={projectSlug}
        editMode={editMode}
        hasUnsavedChanges={hasUnsavedChanges}
        toggleEditMode={toggleEditMode}
        expandLabel={!shouldCollapseRightSideLabels}
      />

      <Button
        variant="ghost"
        size="sm"
        onClick={handleTogglePlugins}
        className={expandableToggleClass(
          shouldExpandPluginsLabel,
          `w-[${pluginExpandedWidth}px]`,
        )}
        title={pluginsOpen ? "Hide plugins" : "Show plugins"}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center">
          <Plug className="h-4 w-4" />
        </span>
        <span
          aria-hidden="true"
          className={expandableToggleLabelClass(shouldExpandPluginsLabel)}
        >
          Plugins
        </span>
        <span className="sr-only">
          {pluginsOpen ? "Hide plugins" : "Show plugins"}
        </span>
      </Button>
    </div>
  ) : null;

  return (
    <>
      <header className="relative shrink-0 bg-background">
        <div className="flex flex-wrap items-center gap-1 px-3 py-1 md:flex-nowrap md:px-4">
          <div
            ref={leadingContentRef}
            className="flex min-w-0 shrink items-center gap-1 overflow-hidden"
            style={maxLeadingWidth ? { maxWidth: maxLeadingWidth } : undefined}
          >
            {embedded && !fullscreen ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={() => {
                  window.parent?.postMessage(
                    { type: "vivd:studio:toggleSidebar" },
                    "*",
                  );
                }}
              >
                <PanelLeft className="h-4 w-4" />
                <span className="sr-only">Toggle Sidebar</span>
              </Button>
            ) : (
              <div className="flex items-center">
                <img src={faviconSvg} alt="vivd" className="h-6 w-6 shrink-0" />
              </div>
            )}

            <div className="flex min-w-0 items-center gap-1 overflow-hidden">
              {projectSlug ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-w-0 max-w-full shrink rounded-md px-2 py-0 text-[13px] font-semibold"
                    >
                      <span
                        className="truncate"
                        style={{ maxWidth: `${slugMaxWidth}px` }}
                        title={projectSlug}
                      >
                        {projectSlug}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={handleClose}>
                      Back to Projects
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="hidden sm:inline text-sm font-medium text-muted-foreground">
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
                      ? "h-7 shrink-0 rounded-md px-1.5 py-0 text-[11px] font-normal cursor-pointer transition-colors hover:bg-secondary/80"
                      : "h-7 shrink-0 rounded-md px-1.5 py-0 text-[11px] font-normal"
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
          </div>

          <div className="order-3 w-full md:hidden">
            <BrowserBar
              viewportMode={viewportMode}
              setViewportMode={setViewportMode}
              currentPreviewPath={currentPreviewPath}
              onNavigatePath={navigatePreviewPath}
              onRefresh={handleRefresh}
            />
          </div>

          <div
            ref={trailingActionsRef}
            className="ml-auto flex shrink-0 items-center gap-1.5"
          >
            <QuickActions
              projectSlug={projectSlug}
              selectedVersion={selectedVersion}
              previewMode={previewMode}
              fullUrl={fullUrl}
              originalUrl={originalUrl}
              copied={copied}
              publicPreviewEnabled={publicPreviewEnabled}
              handleCopy={handleCopy}
              handleRestartDevServer={handleRestartDevServer}
              isRestartingDevServer={isRestartingDevServer}
              devServerRestartKind={devServerRestartKind}
              setHistoryPanelOpen={setHistoryPanelOpen}
              setPublishDialogOpen={setPublishDialogOpen}
              hasGitChanges={hasGitChanges}
              isPublished={isPublished}
              publishStatus={publishStatus}
              analyticsAvailable={analyticsAvailable}
              embedded={embedded}
              onHardRestart={handleHardRestart}
              pluginsOpen={pluginsOpen}
              setPluginsOpen={setPluginsOpen}
              isConnectedMode={isConnectedMode}
              handleTogglePreviewUrl={handleTogglePreviewUrl}
              isTogglingPreviewUrl={isTogglingPreviewUrl}
              handleRegenerateThumbnail={handleRegenerateThumbnail}
              isRegeneratingThumbnail={isRegeneratingThumbnail}
              handleDeleteProject={handleDeleteProject}
              isDeletingProject={isDeletingProject}
            />

            <div className="hidden md:block">
              <ModeToggle />
            </div>

            <MobileActionsMenu
              viewportMode={viewportMode}
              setViewportMode={setViewportMode}
              selectedDevice={selectedDevice}
              setSelectedDevice={setSelectedDevice}
              projectSlug={projectSlug}
              selectedVersion={selectedVersion}
              originalUrl={originalUrl}
              fullUrl={fullUrl}
              copied={copied}
              publicPreviewEnabled={publicPreviewEnabled}
              currentPreviewPath={currentPreviewPath}
              navigatePreviewPath={navigatePreviewPath}
              assetsOpen={assetsOpen}
              setAssetsOpen={setAssetsOpen}
              pluginsOpen={pluginsOpen}
              setPluginsOpen={setPluginsOpen}
              chatOpen={chatOpen}
              setChatOpen={setChatOpen}
              sessionHistoryOpen={sessionHistoryOpen}
              setSessionHistoryOpen={setSessionHistoryOpen}
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
              analyticsAvailable={analyticsAvailable}
              theme={theme}
              setTheme={setTheme}
              canUseAgent={canUseAgent}
              previewMode={previewMode}
              handleRestartDevServer={handleRestartDevServer}
              isRestartingDevServer={isRestartingDevServer}
              devServerRestartKind={devServerRestartKind}
              embedded={embedded}
              onHardRestart={handleHardRestart}
              isConnectedMode={isConnectedMode}
              handleTogglePreviewUrl={handleTogglePreviewUrl}
              isTogglingPreviewUrl={isTogglingPreviewUrl}
              handleRegenerateThumbnail={handleRegenerateThumbnail}
              isRegeneratingThumbnail={isRegeneratingThumbnail}
              handleDeleteProject={handleDeleteProject}
              isDeletingProject={isDeletingProject}
            />

            {embedded ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleFullscreen}
                className="h-8 w-8 rounded-lg p-0"
                title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {fullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
            ) : null}
          </div>
        </div>

        {projectSlug ? (
          <div className="pointer-events-none absolute inset-0 hidden md:block">
            <div
              className="pointer-events-auto absolute top-1/2 z-20 flex -translate-y-1/2 items-center gap-1"
              style={{ left: workspaceControlStart }}
            >
              {desktopWorkspaceControls}
            </div>

            <div
              className="absolute inset-y-0 z-10"
              style={{
                left: workspaceLeadingEdge,
                right: collapsedPreviewInset,
              }}
            >
              <div
                className="pointer-events-none flex h-full items-center justify-center px-2"
                style={{
                  paddingLeft: workspaceBarLeftClearance,
                  paddingRight: workspaceBarRightClearance,
                }}
              >
                <div className="pointer-events-auto w-full">
                  <BrowserBar
                    viewportMode={viewportMode}
                    setViewportMode={setViewportMode}
                    currentPreviewPath={currentPreviewPath}
                    onNavigatePath={navigatePreviewPath}
                    onRefresh={handleRefresh}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <ToolbarDialogs
        projectSlug={projectSlug}
        selectedVersion={selectedVersion}
        historyPanelOpen={historyPanelOpen}
        setHistoryPanelOpen={setHistoryPanelOpen}
        publishDialogOpen={publishDialogOpen}
        setPublishDialogOpen={setPublishDialogOpen}
        handleLoadVersion={handleLoadVersion}
        isLoadingVersion={isLoadingVersion}
        loadingVersionHash={loadingVersionHash}
        handleRefresh={handleRefresh}
        onPublished={() => {
          utils.project.publishStatus.invalidate({ slug: projectSlug! });
        }}
      />
    </>
  );
}
