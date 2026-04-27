import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@vivd/ui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioToolbar } from "./StudioToolbar";

const mockUseToolbarState = vi.fn();
const mockUsePermissions = vi.fn();
const mockUseTheme = vi.fn();
const mockUseOpencodeSessionActivity = vi.fn();
const mockBuildProjectStudioPath = vi.fn(
  (_projectSlug: string, section: "plugins") => `/${section}`,
);
const mockOpenEmbeddedStudioPath = vi.fn();
const mockParseVivdHostMessage = vi.fn();
const mockPostVivdHostMessage = vi.fn();

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

vi.mock("@/lib/hostBridge", () => ({
  parseVivdHostMessage: (...args: Parameters<typeof mockParseVivdHostMessage>) =>
    mockParseVivdHostMessage(...args),
  postVivdHostMessage: (...args: Parameters<typeof mockPostVivdHostMessage>) =>
    mockPostVivdHostMessage(...args),
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
    enabledPlugins: [],
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
    currentPreviewPath: "/",
    handleCopy: vi.fn(),
    handleOpenPreviewUrl: vi.fn(),
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

function renderToolbar() {
  return render(
    <TooltipProvider delayDuration={0}>
      <StudioToolbar />
    </TooltipProvider>,
  );
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
    window.history.replaceState({}, "", "/");
    mockUseToolbarState.mockReset();
    mockUsePermissions.mockReset();
    mockUseTheme.mockReset();
    mockUseOpencodeSessionActivity.mockReset();
    mockBuildProjectStudioPath.mockClear();
    mockOpenEmbeddedStudioPath.mockClear();
    mockParseVivdHostMessage.mockReset();
    mockPostVivdHostMessage.mockReset();

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
    mockParseVivdHostMessage.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
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

    renderToolbar();

    expect(
      screen.getByRole("button", { name: /another session is active/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("sessions-button-activity-indicator"),
      ).toBeInTheDocument();
  });

  it("does not show the Sessions button indicator when no session is active", () => {
    renderToolbar();

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

    renderToolbar();

    expect(
      screen.queryByText("Another session is active"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("sessions-button-activity-indicator"),
    ).not.toBeInTheDocument();
  });

  it("keeps inactive workspace controls compact instead of expanding on hover", () => {
    renderToolbar();

    const explorerButton = screen.getByRole("button", { name: "Show explorer" });
    const explorerLabel = explorerButton.querySelector(
      'span[aria-hidden="true"]',
    );

    expect(explorerButton.className).not.toContain("hover:w");
    expect(explorerButton.className).not.toContain(
      "w-[var(--toolbar-expanded-width)]",
    );
    expect(explorerLabel?.className).not.toContain("group-hover");
    expect(explorerLabel).toHaveClass("opacity-0");
  });

  it("expands workspace controls when their panel is active", () => {
    mockUseToolbarState.mockReturnValue({
      ...createToolbarState(),
      assetsOpen: true,
    });

    renderToolbar();

    const explorerButton = screen.getByRole("button", { name: "Hide explorer" });
    const explorerLabel = explorerButton.querySelector(
      'span[aria-hidden="true"]',
    );

    expect(explorerButton.className).toContain(
      "w-[var(--toolbar-expanded-width)]",
    );
    expect(explorerLabel).toHaveClass("opacity-100");
  });

  it("uses the embedded vivd-mark sidebar toggle without showing a separate fullscreen button", () => {
    mockUseToolbarState.mockReturnValue({
      ...createToolbarState(),
      embedded: true,
    });

    renderToolbar();

    const toggle = document.querySelector(
      '[data-sidebar-trigger-appearance="brand"]',
    );

    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAccessibleName(/Toggle Sidebar/);
    expect(toggle).toHaveAttribute("data-sidebar-trigger-appearance", "brand");
    expect(
      toggle?.querySelector('[data-sidebar-brand-glyph="brand"]'),
    ).toHaveClass("!size-6");
    expect(screen.queryByTitle(/fullscreen/i)).not.toBeInTheDocument();
  });

  it("does not show a tooltip on the embedded sidebar toggle", async () => {
    mockUseToolbarState.mockReturnValue({
      ...createToolbarState(),
      embedded: true,
    });

    renderToolbar();

    const toggle = document.querySelector(
      '[data-sidebar-trigger-appearance="brand"]',
    ) as HTMLElement | null;

    expect(toggle).toBeInTheDocument();

    fireEvent.pointerMove(toggle!);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("requests the host immersive peek when hovering the embedded vivd-mark toggle", () => {
    mockUseToolbarState.mockReturnValue({
      ...createToolbarState(),
      embedded: true,
    });

    renderToolbar();

    const toggle = document.querySelector(
      '[data-sidebar-trigger-appearance="brand"]',
    ) as HTMLElement | null;

    expect(toggle).toBeInTheDocument();

    fireEvent.pointerEnter(toggle!);

    expect(mockPostVivdHostMessage).toHaveBeenCalledTimes(1);
    expect(mockPostVivdHostMessage).toHaveBeenNthCalledWith(1, {
      type: "vivd:studio:showSidebarPeek",
    });
  });

  it("uses the plain sidebar toggle when the host sidebar is already open", () => {
    window.history.replaceState({}, "", "/?sidebarOpen=1");
    mockUseToolbarState.mockReturnValue({
      ...createToolbarState(),
      embedded: true,
    });

    renderToolbar();

    const toggle = document.querySelector(
      '[data-sidebar-trigger-appearance="panel"]',
    );

    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAccessibleName(/Toggle Sidebar/);
    expect(screen.queryByRole("img", { name: "vivd" })).not.toBeInTheDocument();
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

    renderToolbar();

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

    renderToolbar();

    expect(screen.queryByRole("button", { name: "Projects" })).not.toBeInTheDocument();
  });

  it("renders the vivd mark inline instead of relying on a root-path image asset", () => {
    renderToolbar();

    expect(screen.getByRole("img", { name: "vivd" })).toBeInTheDocument();
    expect(document.querySelector('img[alt="vivd"]')).toBeNull();
  });

  it("always shows the Analytics toolbar button", () => {
    renderToolbar();

    expect(
      screen.getByRole("button", { name: "Analytics requires activation" }),
    ).toBeInTheDocument();
  });

  it("shows a support prompt when analytics is not enabled", () => {
    renderToolbar();

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
      enabledPlugins: ["analytics"],
      embedded: true,
    });

    renderToolbar();

    expect(screen.getByRole("button", { name: "Open analytics" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open analytics" }));

    expect(mockOpenEmbeddedStudioPath).toHaveBeenCalledWith(
      "/vivd-studio/projects/bettinis-bikinis/plugins/analytics",
      true,
    );
  });
});
