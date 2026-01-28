import { Button } from "@/components/ui/button";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, Settings, Shield, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { VersionSelector } from "@/components/projects/versioning";
import { ModeToggle, useTheme } from "@/components/theme";
import { authClient } from "@/lib/auth-client";
import { usePermissions } from "@/hooks/usePermissions";
import { ROUTES } from "@/app/router";
import faviconSvg from "/favicon-transparent.svg";

import { useToolbarState } from "./useToolbarState";
import {
  ViewControls,
  EditControls,
  AgentButton,
  QuickActions,
  MobileActionsMenu,
  ToolbarDialogs,
} from "./components";

export function PreviewToolbar() {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const { setTheme, theme } = useTheme();
  const { canUseAgent, isClientEditor } = usePermissions();

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

  const handleLogout = async () => {
    await authClient.signOut();
    navigate(ROUTES.LOGIN);
  };

  // User menu content for mobile actions menu
  const userMenuContent = session ? (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="font-normal">
        <div className="flex flex-col space-y-1">
          <p className="text-sm font-medium leading-none">{session.user.name}</p>
          <p className="text-xs leading-none text-muted-foreground">
            {session.user.email}
          </p>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuItem asChild>
        <Link to={ROUTES.SETTINGS} className="cursor-pointer">
          <Settings className="mr-2 h-4 w-4" />
          <span>Settings</span>
        </Link>
      </DropdownMenuItem>
      {session?.user?.role === "admin" && (
        <DropdownMenuItem asChild>
          <Link to={ROUTES.ADMIN} className="cursor-pointer">
            <Shield className="mr-2 h-4 w-4" />
            <span>Admin Panel</span>
          </Link>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={handleLogout}>
        <LogOut className="mr-2 h-4 w-4" />
        <span>Log out</span>
      </DropdownMenuItem>
    </>
  ) : null;

  return (
    <>
      <header className="px-2 md:px-4 py-2.5 border-b flex flex-row items-center gap-1 md:gap-2 shrink-0 z-10 bg-background overflow-x-auto">
        {/* Left Section: App Icon + Preview Identity */}
        {isClientEditor ? (
          <div className="flex items-center">
            <img src={faviconSvg} alt="vivd" className="h-6 w-6 shrink-0" />
          </div>
        ) : (
          <button
            onClick={handleClose}
            className="hover:opacity-80 transition-opacity focus:outline-none cursor-pointer"
          >
            <img src={faviconSvg} alt="vivd" className="h-6 w-6 shrink-0" />
          </button>
        )}

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
          />

          {/* Separator */}
          <div className="hidden md:block h-5 w-px bg-border mx-1" />

          {/* Theme Toggle */}
          <div className="hidden md:block">
            <ModeToggle />
          </div>

          {/* Profile Avatar */}
          {session && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="hidden md:flex relative h-8 w-8 rounded-full"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage
                      src={session.user.image || undefined}
                      alt={session.user.name}
                    />
                    <AvatarFallback>
                      {session.user.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {session.user.name}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {session.user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={ROUTES.SETTINGS} className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </Link>
                </DropdownMenuItem>
                {session?.user?.role === "admin" && (
                  <DropdownMenuItem asChild>
                    <Link to={ROUTES.ADMIN} className="cursor-pointer">
                      <Shield className="mr-2 h-4 w-4" />
                      <span>Admin Panel</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

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
            userMenuContent={userMenuContent}
          />

          {/* Close/Back Button */}
          {!isClientEditor && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                  className="h-8 w-8 p-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back to Dashboard</TooltipContent>
            </Tooltip>
          )}
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
