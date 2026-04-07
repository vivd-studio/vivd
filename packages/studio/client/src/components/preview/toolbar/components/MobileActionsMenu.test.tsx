import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileActionsMenu } from "./MobileActionsMenu";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function createProps() {
  return {
    viewportMode: "desktop" as const,
    setViewportMode: vi.fn(),
    selectedDevice: { name: "iPhone 14 Pro", width: 393, height: 852 } as const,
    setSelectedDevice: vi.fn(),
    projectSlug: "aurora-studio",
    selectedVersion: 1,
    originalUrl: "http://localhost/",
    copied: false,
    publicPreviewEnabled: true,
    currentPreviewPath: "/",
    navigatePreviewPath: vi.fn(),
    assetsOpen: false,
    setAssetsOpen: vi.fn(),
    chatOpen: true,
    setChatOpen: vi.fn(),
    sessionHistoryOpen: false,
    setSessionHistoryOpen: vi.fn(),
    editMode: false,
    hasUnsavedChanges: false,
    toggleEditMode: vi.fn(),
    handleRefresh: vi.fn(),
    handleCopy: vi.fn(),
    handleOpenPreviewUrl: vi.fn(),
    setPublishDialogOpen: vi.fn(),
    setHistoryPanelOpen: vi.fn(),
    hasGitChanges: false,
    isPublished: false,
    publishStatus: { mode: "standalone" as const, domain: null, lastTag: null },
    theme: "light" as const,
    setTheme: vi.fn(),
    colorTheme: "vivd-sharp" as const,
    setColorTheme: vi.fn(),
    canUseAgent: true,
    previewMode: "static" as const,
    handleRestartDevServer: vi.fn(),
    isRestartingDevServer: false,
    devServerRestartKind: null,
    embedded: false,
    onHardRestart: vi.fn(),
    isConnectedMode: false,
    handleTogglePreviewUrl: vi.fn(),
    isTogglingPreviewUrl: false,
    handleRegenerateThumbnail: vi.fn(),
    isRegeneratingThumbnail: false,
    handleDeleteProject: vi.fn(),
    isDeletingProject: false,
    projectPluginShortcuts: [],
    onTriggerProjectPluginShortcut: vi.fn(),
  };
}

describe("MobileActionsMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes color theme choices in the mobile menu and wires aurora selection", () => {
    const props = createProps();

    render(<MobileActionsMenu {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /aurora/i }));

    expect(props.setColorTheme).toHaveBeenCalledWith("aurora");
  });

  it("opens the shareable preview URL via the dedicated toolbar handler", () => {
    const props = createProps();

    render(<MobileActionsMenu {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /open in new tab/i }));

    expect(props.handleOpenPreviewUrl).toHaveBeenCalledTimes(1);
  });
});
