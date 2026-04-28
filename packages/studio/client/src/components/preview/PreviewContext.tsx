import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type RefObject,
} from "react";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { usePreviewWorkspaceSurface } from "./usePreviewWorkspaceSurface";
import { usePreviewIframeLoading } from "./usePreviewIframeLoading";
import {
  usePreviewBridgeMessages,
  type SelectedElement,
} from "./usePreviewBridgeMessages";
import {
  usePreviewInlineEditing,
  type PendingImageDropChoiceRequest,
} from "./usePreviewInlineEditing";
import type { ImageDropChoiceKind } from "./imageDropPlan";
import { usePreviewRuntimeState } from "./usePreviewRuntimeState";
import {
  DEVICE_PRESETS,
  TABLET_PRESET,
  type DevicePreset,
  type PreviewMode,
  type ViewportMode,
} from "./types";
import {
  ASSETS_OPEN_STORAGE_KEY,
  CHAT_OPEN_STORAGE_KEY,
  VIEWPORT_MODE_STORAGE_KEY,
  getInitialPanelOpenState,
  getInitialViewportMode,
} from "./navigation";
import type { AssetItem, FileTreeNode } from "../asset-explorer/types";
import { sendPreviewLeaveBeacon } from "./previewLeave";

// Version info from project data
interface VersionInfo {
  version: number;
  status: string;
}

interface PreviewContextValue {
  // Props
  url: string | null;
  originalUrl?: string | null;
  projectSlug?: string;
  version?: number;
  publicPreviewEnabled: boolean;

  // State
  copied: boolean;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  assetsOpen: boolean;
  setAssetsOpen: (open: boolean) => void;
  cmsOpen: boolean;
  cmsMounted: boolean;
  setCmsOpen: (open: boolean) => void;
  sessionHistoryOpen: boolean;
  setSessionHistoryOpen: (open: boolean) => void;
  refreshKey: number;
  selectedVersion: number;
  viewportMode: ViewportMode;
  setViewportMode: (mode: ViewportMode) => void;
  selectedDevice: DevicePreset;
  setSelectedDevice: (device: DevicePreset) => void;
  mobileScale: number;
  editMode: boolean;
  iframeLoading: boolean;
  isPreviewLoading: boolean;
  hasUnsavedChanges: boolean;
  imageDropChoiceRequest: PendingImageDropChoiceRequest | null;
  resolveImageDropChoice: (choice: ImageDropChoiceKind | null) => void;
  currentPreviewPath: string;

  // Element Selector
  selectorMode: boolean;
  setSelectorMode: (mode: boolean) => void;
  selectedElement: SelectedElement | null;
  clearSelectedElement: () => void;

  // Refs
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeNavigateStart: () => void;
  onIframeLoad: () => void;
  mobileContainerRef: RefObject<HTMLDivElement | null>;

  // Computed
  fullUrl: string;
  devServerStatus: "ready" | "starting" | "installing" | "error" | "none";
  devServerError?: string;
  versions: VersionInfo[];
  totalVersions: number;
  hasMultipleVersions: boolean;
  enabledPlugins: string[];
  supportEmail: string | null;
  previewMode: PreviewMode;

  // Handlers
  handleVersionSelect: (version: number) => void;
  handleCopy: () => void;
  handleOpenPreviewUrl: () => void;
  handleRefresh: () => void;
  navigatePreviewPath: (path: string) => void;
  handlePreviewLocationChange: (href: string) => void;
  handleTaskComplete: () => void;
  toggleEditMode: () => void;
  handleSave: () => void;
  handleCancelEdit: () => void;
  handleClose: () => void;

  // Cross-component chat messaging
  initialGenerationRequested: boolean;
  requestedInitialSessionId: string | null;
  pendingChatMessage: {
    kind?: "task";
    message: string;
    startNewSession?: boolean;
  } | null;
  pendingNewSessionRequestId: number | null;
  sendChatMessage: (
    message: string,
    options?: { startNewSession?: boolean },
  ) => void;
  clearPendingChatMessage: () => void;
  requestNewSession: () => void;
  clearPendingNewSessionRequest: () => void;

  // Status
  isSaving: boolean;

  // Text Editor in preview area
  editingTextFile: string | null;
  setEditingTextFile: (path: string | null) => void;

  // Image Viewer in preview area
  viewingImagePath: string | null;
  setViewingImagePath: (path: string | null) => void;

  // PDF Viewer in preview area
  viewingPdfPath: string | null;
  setViewingPdfPath: (path: string | null) => void;

  // Asset actions (shared between AssetExplorer and ImageViewerPanel)
  editingAsset: AssetItem | FileTreeNode | null;
  setEditingAsset: (asset: AssetItem | FileTreeNode | null) => void;
  pendingDeleteAsset: AssetItem | FileTreeNode | null;
  setPendingDeleteAsset: (asset: AssetItem | FileTreeNode | null) => void;

  // Resizable panels
  assetPanel: ReturnType<typeof useResizablePanel>;
  chatPanel: ReturnType<typeof useResizablePanel>;

  // Mode
  embedded: boolean;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

export function usePreview() {
  const context = useContext(PreviewContext);
  if (!context) {
    throw new Error("usePreview must be used within a PreviewProvider");
  }
  return context;
}

/**
 * Returns the PreviewContext value if inside a PreviewProvider, or null otherwise.
 * Use this when a component may or may not be rendered within a PreviewProvider.
 */
export function useOptionalPreview() {
  return useContext(PreviewContext);
}

interface PreviewProviderProps {
  children: ReactNode;
  url: string | null;
  originalUrl?: string | null;
  projectSlug?: string;
  version?: number;
  publicPreviewEnabled?: boolean;
  onClose: () => void;
  embedded?: boolean;
}

export function PreviewProvider({
  children,
  url,
  originalUrl,
  projectSlug,
  version,
  publicPreviewEnabled = true,
  onClose,
  embedded = false,
}: PreviewProviderProps) {
  const initialPanelState =
    typeof window === "undefined"
      ? { chatOpen: true, assetsOpen: false }
      : getInitialPanelOpenState(window.localStorage);
  const [chatOpenState, setChatOpenState] = useState(initialPanelState.chatOpen);
  const [assetsOpenState, setAssetsOpenState] = useState(
    initialPanelState.assetsOpen,
  );
  const [sessionHistoryOpenState, setSessionHistoryOpenState] = useState(false);
  const {
    cmsOpenState,
    cmsMountedState,
    setCmsOpen,
    editingTextFileState,
    setEditingTextFile,
    viewingImagePathState,
    setViewingImagePath,
    viewingPdfPathState,
    setViewingPdfPath,
  } = usePreviewWorkspaceSurface();
  const {
    iframeLoading,
    beginIframeLoading,
    beginIframeNavigationLoading,
    endIframeLoading,
  } = usePreviewIframeLoading();
  const [viewportMode, setViewportModeState] = useState<ViewportMode>(() => {
    if (typeof window === "undefined") return "desktop";
    return getInitialViewportMode(window.localStorage);
  });
  const [selectedDevice, setSelectedDevice] = useState<DevicePreset>(
    DEVICE_PRESETS[0],
  );
  const [mobileScale, setMobileScale] = useState(1);

  const setChatOpen = useCallback((open: boolean) => {
    setChatOpenState(open);
    if (!open) {
      setSessionHistoryOpenState(false);
    }
  }, []);

  const [pendingChatMessage, setPendingChatMessage] = useState<{
    kind?: "task";
    message: string;
    startNewSession?: boolean;
  } | null>(null);
  const [pendingNewSessionRequestId, setPendingNewSessionRequestId] = useState<
    number | null
  >(null);
  const [editingAsset, setEditingAsset] = useState<
    AssetItem | FileTreeNode | null
  >(null);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState<
    AssetItem | FileTreeNode | null
  >(null);
  const mobileContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initialGenerationRequested =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("initialGeneration") === "1";
  const requestedInitialSessionId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("sessionId")?.trim() || null
      : null;

  const setAssetsOpen = useCallback((open: boolean) => {
    setAssetsOpenState(open);
  }, []);

  const setSessionHistoryOpen = useCallback((open: boolean) => {
    if (open) {
      setChatOpenState(true);
    }
    setSessionHistoryOpenState(open);
  }, []);

  const setViewportMode = useCallback((mode: ViewportMode) => {
    setViewportModeState(mode);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAT_OPEN_STORAGE_KEY, String(chatOpenState));
  }, [chatOpenState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ASSETS_OPEN_STORAGE_KEY, String(assetsOpenState));
  }, [assetsOpenState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIEWPORT_MODE_STORAGE_KEY, viewportMode);
  }, [viewportMode]);

  // Calculate scale to fit phone in container
  const calculateScale = useCallback(() => {
    if (!mobileContainerRef.current || viewportMode === "desktop") return;

    const container = mobileContainerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const activeFrame = viewportMode === "tablet" ? TABLET_PRESET : selectedDevice;

    // Add padding (40px on each side)
    const padding = 80;
    const availableWidth = containerWidth - padding;
    const availableHeight = containerHeight - padding;

    // Device dimensions include the border (8px on each side)
    const deviceTotalWidth = activeFrame.width + 16;
    const deviceTotalHeight = activeFrame.height + 16;

    // Calculate scale to fit both dimensions
    const scaleX = availableWidth / deviceTotalWidth;
    const scaleY = availableHeight / deviceTotalHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Never scale up

    setMobileScale(scale);
  }, [viewportMode, selectedDevice]);

  // Recalculate scale when container size changes or device changes
  useEffect(() => {
    calculateScale();

    const container = mobileContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      calculateScale();
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [calculateScale]);

  const {
    copied,
    refreshKey,
    selectedVersion,
    currentPreviewPath,
    fullUrl,
    previewMode,
    devServerStatus,
    devServerError,
    versions,
    totalVersions,
    hasMultipleVersions,
    enabledPlugins,
    supportEmail,
    isPreviewLoading,
    hasGitChanges,
    handleVersionSelect: handleRuntimeVersionSelect,
    handleCopy,
    handleOpenPreviewUrl,
    handleRefresh,
    navigatePreviewPath,
    handlePreviewLocationChange,
    handleTaskComplete,
    refreshPreview,
  } = usePreviewRuntimeState({
    url,
    originalUrl,
    projectSlug,
    version,
    publicPreviewEnabled,
    beginIframeLoading,
  });

  const {
    editMode,
    hasUnsavedChanges,
    isSaving,
    toggleEditMode,
    handleSave,
    handleCancelEdit,
    clearPendingPatches,
    imageDropChoiceRequest,
    resolveImageDropChoice,
  } = usePreviewInlineEditing({
    iframeRef,
    projectSlug,
    selectedVersion,
    previewMode,
    beginIframeLoading,
    refreshPreview,
  });

  const handleVersionSelect = useCallback(
    (newVersion: number) => {
      clearPendingPatches();
      handleRuntimeVersionSelect(newVersion);
    },
    [clearPendingPatches, handleRuntimeVersionSelect],
  );

  const handleClose = () => {
    onClose();
  };

  const assetPanel = useResizablePanel({
    storageKey: "previewModal.assetPanelWidth",
    defaultWidth: 320,
    minWidth: 250,
    maxWidth: 500,
    side: "left",
  });

  const chatPanel = useResizablePanel({
    storageKey: "previewModal.chatPanelWidth",
    defaultWidth: 400,
    minWidth: 320,
    maxWidth: 1200,
    side: "left",
  });

  const {
    selectorMode,
    setSelectorMode,
    selectedElement,
    clearSelectedElement,
  } = usePreviewBridgeMessages({
    iframeRef,
    fullUrl,
    beginIframeNavigationLoading,
    endIframeLoading,
    handlePreviewLocationChange,
    setChatOpen,
  });

  // Cross-component chat messaging: allows PublishDialog to send messages to chat
  const sendChatMessage = useCallback(
    (message: string, options?: { startNewSession?: boolean }) => {
      setChatOpen(true);
      setPendingChatMessage({
        kind: "task",
        message,
        startNewSession: options?.startNewSession,
      });
    },
    [],
  );

  const clearPendingChatMessage = useCallback(() => {
    setPendingChatMessage(null);
  }, []);

  const requestNewSession = useCallback(() => {
    setChatOpen(true);
    setSessionHistoryOpenState(false);
    setPendingNewSessionRequestId(Date.now());
  }, [setChatOpen]);

  const clearPendingNewSessionRequest = useCallback(() => {
    setPendingNewSessionRequestId(null);
  }, []);

  // Global Escape key handler to exit edit mode and selector mode
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (editMode) {
          handleCancelEdit();
        }
        if (selectorMode) {
          setSelectorMode(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, selectorMode, setSelectorMode]);

  // Warn user before leaving page if there are unsaved git changes
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasGitChanges) {
        event.preventDefault();
        // Modern browsers require returnValue to be set
        event.returnValue = "";
        return "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasGitChanges]);

  // Stop OpenCode only on real page unloads. A plain React unmount can happen during
  // StrictMode verification or host-side remounts and must not be treated as
  // "the user left Studio".
  useEffect(() => {
    if (!projectSlug) return;

    const handleBeforeUnload = () => {
      sendPreviewLeaveBeacon({
        projectSlug,
        version: selectedVersion,
      });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [projectSlug, selectedVersion]);

  const value: PreviewContextValue = {
    // Props
    url,
    originalUrl,
    projectSlug,
    version,

    // State
    copied,
    chatOpen: chatOpenState,
    setChatOpen,
    assetsOpen: assetsOpenState,
    setAssetsOpen,
    cmsOpen: cmsOpenState,
    cmsMounted: cmsMountedState,
    setCmsOpen,
    sessionHistoryOpen: sessionHistoryOpenState,
    setSessionHistoryOpen,
    refreshKey,
    selectedVersion,
    viewportMode,
    setViewportMode,
    selectedDevice,
    setSelectedDevice,
    mobileScale,
    editMode,
    iframeLoading,
    isPreviewLoading,
    hasUnsavedChanges,
    imageDropChoiceRequest,
    resolveImageDropChoice,
    currentPreviewPath,

    // Element Selector
    selectorMode,
    setSelectorMode,
    selectedElement,
    clearSelectedElement,

    // Refs
    iframeRef,
    onIframeNavigateStart: beginIframeNavigationLoading,
    onIframeLoad: endIframeLoading,
    mobileContainerRef,

    // Computed
    fullUrl,
    previewMode,
    devServerStatus,
    devServerError,
    versions,
    totalVersions,
    hasMultipleVersions,
    enabledPlugins,
    supportEmail,

    // Handlers
    handleVersionSelect,
    handleCopy,
    handleOpenPreviewUrl,
    handleRefresh,
    navigatePreviewPath,
    handlePreviewLocationChange,
    handleTaskComplete,
    toggleEditMode,
    handleSave,
    handleCancelEdit,
    handleClose,

    isSaving,

    // Cross-component chat messaging
    initialGenerationRequested,
    requestedInitialSessionId,
    pendingChatMessage,
    pendingNewSessionRequestId,
    sendChatMessage,
    clearPendingChatMessage,
    requestNewSession,
    clearPendingNewSessionRequest,

    // Text Editor in preview area
    editingTextFile: editingTextFileState,
    setEditingTextFile,

    // Image Viewer in preview area
    viewingImagePath: viewingImagePathState,
    setViewingImagePath,

    // PDF Viewer in preview area
    viewingPdfPath: viewingPdfPathState,
    setViewingPdfPath,

    // Asset actions
    editingAsset,
    setEditingAsset,
    pendingDeleteAsset,
    setPendingDeleteAsset,

    // Resizable panels
    assetPanel,
    chatPanel,

    // Mode
    embedded,
    publicPreviewEnabled,
  };

  return (
    <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
  );
}
