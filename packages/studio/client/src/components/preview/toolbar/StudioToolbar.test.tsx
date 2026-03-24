import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioToolbar } from "./StudioToolbar";

const mockUseToolbarState = vi.fn();
const mockUsePermissions = vi.fn();
const mockUseTheme = vi.fn();
const mockUseOpencodeSessionActivity = vi.fn();
const mockBuildProjectStudioPath = vi.fn(
  (_projectSlug: string, section: "plugins" | "analytics") => `/${section}`,
);
const mockOpenEmbeddedStudioPath = vi.fn();

vi.mock("@/components/projects/versioning", () => ({
  VersionSelector: () => <div data-testid="version-selector" />,
}));

vi.mock("@/components/theme", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
  useTheme: () => mockUseTheme(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => mockUsePermissions(),
}));

vi.mock("@/features/opencodeChat", () => ({
  useOpencodeSessionActivity: () => mockUseOpencodeSessionActivity(),
}));

vi.mock("./useToolbarState", () => ({
  useToolbarState: () => mockUseToolbarState(),
}));

vi.mock("./components", () => ({
  BrowserBar: () => <div data-testid="browser-bar" />,
  EditControls: () => <div data-testid="edit-controls" />,
  MobileActionsMenu: () => <div data-testid="mobile-actions-menu" />,
  QuickActions: () => <div data-testid="quick-actions" />,
  ToolbarDialogs: () => <div data-testid="toolbar-dialogs" />,
}));

vi.mock("./hostNavigation", () => ({
  buildProjectStudioPath: (...args: Parameters<typeof mockBuildProjectStudioPath>) =>
    mockBuildProjectStudioPath(...args),
  openEmbeddedStudioPath: (...args: Parameters<typeof mockOpenEmbeddedStudioPath>) =>
    mockOpenEmbeddedStudioPath(...args),
}));

function createToolbarState() {
  return {
    projectSlug: "bettinis-bikinis",
    embedded: false,
    originalUrl: null,
    copied: false,
    selectedVersion: 1,
    previewMode: "static",
    versions: [{ version: 1, status: "draft" }],
    hasMultipleVersions: false,
    analyticsAvailable: false,
    supportEmail: "support@example.com",
    handleVersionSelect: vi.fn(),
    viewportMode: "desktop",
    setViewportMode: vi.fn(),
    selectedDevice: { id: "desktop", label: "Desktop", width: 1280, height: 800 },
    setSelectedDevice: vi.fn(),
    assetsOpen: false,
    setAssetsOpen: vi.fn(),
    chatOpen: true,
    chatPanel: { width: 360 },
    setChatOpen: vi.fn(),
    requestNewSession: vi.fn(),
    sessionHistoryOpen: false,
    setSessionHistoryOpen: vi.fn(),
    editMode: false,
    hasUnsavedChanges: false,
    toggleEditMode: vi.fn(),
    fullUrl: "http://localhost/",
    currentPreviewPath: "/",
    handleCopy: vi.fn(),
    handleRefresh: vi.fn(),
    navigatePreviewPath: vi.fn(),
    historyPanelOpen: false,
    setHistoryPanelOpen: vi.fn(),
    publishDialogOpen: false,
    setPublishDialogOpen: vi.fn(),
    hasGitChanges: false,
    isPublished: false,
    publishStatus: { isPublished: false, mode: "disconnected" },
    publicPreviewEnabled: true,
    handleLoadVersion: vi.fn(),
    isLoadingVersion: false,
    loadingVersionHash: null,
    utils: {
      project: {
        gitHistory: { invalidate: vi.fn() },
        gitHasChanges: { invalidate: vi.fn() },
        gitWorkingCommit: { invalidate: vi.fn() },
      },
    },
    handleClose: vi.fn(),
    isConnectedMode: false,
    handleTogglePreviewUrl: vi.fn(),
    isTogglingPreviewUrl: false,
    handleRegenerateThumbnail: vi.fn(),
    isRegeneratingThumbnail: false,
    handleDeleteProject: vi.fn(),
    isDeletingProject: false,
    handleRestartDevServer: vi.fn(),
    isRestartingDevServer: false,
    devServerRestartKind: null,
  };
}

describe("StudioToolbar", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  beforeEach(() => {
    mockUseToolbarState.mockReset();
    mockUsePermissions.mockReset();
    mockUseTheme.mockReset();
    mockUseOpencodeSessionActivity.mockReset();
    mockBuildProjectStudioPath.mockClear();
    mockOpenEmbeddedStudioPath.mockClear();

    mockUseToolbarState.mockReturnValue(createToolbarState());
    mockUsePermissions.mockReturnValue({ canUseAgent: true });
    mockUseTheme.mockReturnValue({
      theme: "light",
      setTheme: vi.fn(),
      colorTheme: "vivd-sharp",
      setColorTheme: vi.fn(),
    });
    mockUseOpencodeSessionActivity.mockReturnValue({
      selectedSessionId: "session-1",
      activeSessionIds: [],
      selectedSessionIsActive: false,
      otherActiveSessionIds: [],
      otherActiveSessionCount: 0,
      hasAnyActiveSession: false,
      hasOtherActiveSessions: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows an activity indicator on the Sessions button when another session is active", () => {
    mockUseOpencodeSessionActivity.mockReturnValue({
      selectedSessionId: "session-1",
      activeSessionIds: ["session-2"],
      selectedSessionIsActive: false,
      otherActiveSessionIds: ["session-2"],
      otherActiveSessionCount: 1,
      hasAnyActiveSession: true,
      hasOtherActiveSessions: true,
    });

    render(<StudioToolbar />);

    expect(
      screen.getByRole("button", { name: /another session is active/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("sessions-button-activity-indicator"),
    ).toBeInTheDocument();
  });

  it("does not show the Sessions button indicator when no other session is active", () => {
    render(<StudioToolbar />);

    expect(
      screen.queryByText("Another session is active"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("sessions-button-activity-indicator"),
    ).not.toBeInTheDocument();
  });

  it("does not show the Sessions button indicator when only the selected session is active", () => {
    mockUseOpencodeSessionActivity.mockReturnValue({
      selectedSessionId: "session-1",
      activeSessionIds: ["session-1"],
      selectedSessionIsActive: true,
      otherActiveSessionIds: [],
      otherActiveSessionCount: 0,
      hasAnyActiveSession: true,
      hasOtherActiveSessions: false,
    });

    render(<StudioToolbar />);

    expect(
      screen.queryByText("Another session is active"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("sessions-button-activity-indicator"),
    ).not.toBeInTheDocument();
  });

  it("shows an inline Projects breadcrumb when the toolbar has enough room", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1280,
    });

    mockUseToolbarState.mockReturnValue({
      ...createToolbarState(),
      chatOpen: true,
      chatPanel: { width: 560 },
    });

    render(<StudioToolbar />);

    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
  });

  it("hides the inline Projects breadcrumb when the viewport gets too narrow", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 920,
    });

    mockUseToolbarState.mockReturnValue({
      ...createToolbarState(),
      chatOpen: true,
    });

    render(<StudioToolbar />);

    expect(screen.queryByRole("button", { name: "Projects" })).not.toBeInTheDocument();
  });

  it("always shows the Analytics toolbar button", () => {
    render(<StudioToolbar />);

    expect(
      screen.getByRole("button", { name: "Analytics requires activation" }),
    ).toBeInTheDocument();
  });

  it("shows a support prompt when analytics is not enabled", () => {
    render(<StudioToolbar />);

    fireEvent.click(
      screen.getByRole("button", { name: "Analytics requires activation" }),
    );

    expect(screen.getByText("Analytics needs activation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Email Vivd support" })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:support@example.com"),
    );
    expect(mockOpenEmbeddedStudioPath).not.toHaveBeenCalled();
  });

  it("opens the analytics page from the toolbar when analytics is enabled", () => {
    mockUseToolbarState.mockReturnValue({
      ...createToolbarState(),
      analyticsAvailable: true,
      embedded: true,
    });

    render(<StudioToolbar />);

    expect(screen.getByRole("button", { name: "Open analytics" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open analytics" }));

    expect(mockBuildProjectStudioPath).toHaveBeenCalledWith(
      "bettinis-bikinis",
      "analytics",
    );
    expect(mockOpenEmbeddedStudioPath).toHaveBeenCalledWith("/analytics", true);
  });
});
