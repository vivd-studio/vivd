import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  getVivdStudioToken,
  resolveStudioRuntimePath,
  withVivdStudioTokenQuery,
} from "@/lib/studioAuth";
import { copyTextWithFallback, openUrlInNewTab } from "@/lib/browserActions";
import {
  POLLING_BACKGROUND,
  POLLING_DEV_SERVER_STARTING,
  POLLING_DEV_SERVER_KEEPALIVE,
} from "@/app/config/polling";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useImageDropZone } from "./useImageDropZone";
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
  buildPreviewUrl,
  getInitialPanelOpenState,
  getInitialViewportMode,
  getPreviewPathFromUrl,
  getPreviewRootUrl,
  normalizePreviewPathInput,
} from "./navigation";
import {
  getPreviewBridgeOrigin,
  isPreviewBridgeMessage,
} from "./bridge";
import {
  collectVivdTextPatchesFromDocument,
  getI18nKeyForEditableElement,
  type VivdPatch,
} from "@/lib/vivdPreviewTextPatching";
import {
  getVivdHostOrigin,
} from "@/lib/hostBridge";
import type { AssetItem, FileTreeNode } from "../asset-explorer/types";
import { sendPreviewLeaveBeacon } from "./previewLeave";
import { toAstroRuntimeAssetPath } from "./assetPathMapping";

// Version info from project data
interface VersionInfo {
  version: number;
  status: string;
}

// Selected element info from iframe
interface SelectedElement {
  description: string;
  selector: string;
  tagName: string;
  text: string;
  filename: string;
  astroSourceFile?: string | null;
  astroSourceLoc?: string | null;
}

type WorkspaceSurface =
  | { kind: "none" }
  | { kind: "cms" }
  | { kind: "text"; path: string }
  | { kind: "image"; path: string }
  | { kind: "pdf"; path: string };

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
  const [copied, setCopied] = useState(false);
  const initialPanelState =
    typeof window === "undefined"
      ? { chatOpen: true, assetsOpen: false }
      : getInitialPanelOpenState(window.localStorage);
  const [chatOpenState, setChatOpenState] = useState(initialPanelState.chatOpen);
  const [assetsOpenState, setAssetsOpenState] = useState(
    initialPanelState.assetsOpen,
  );
  const [cmsOpenState, setCmsOpenState] = useState(false);
  const [sessionHistoryOpenState, setSessionHistoryOpenState] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(true);
  const iframeLoadingDelayTimerRef = useRef<number | null>(null);
  const iframeLoadWatchdogRef = useRef<number | null>(null);
  const [selectedVersion, setSelectedVersion] = useState(version || 1);
  const [viewportMode, setViewportModeState] = useState<ViewportMode>(() => {
    if (typeof window === "undefined") return "desktop";
    return getInitialViewportMode(window.localStorage);
  });
  const [selectedDevice, setSelectedDevice] = useState<DevicePreset>(
    DEVICE_PRESETS[0],
  );
  const [mobileScale, setMobileScale] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentPreviewPath, setCurrentPreviewPath] = useState("/");
  const [iframePreviewPath, setIframePreviewPath] = useState("/");

  const setChatOpen = useCallback((open: boolean) => {
    setChatOpenState(open);
    if (!open) {
      setSessionHistoryOpenState(false);
    }
  }, []);

  type SavePatch =
    | VivdPatch
    | { type: "setAttr"; selector: string; name: "src"; value: string };

  type ImagePatch =
    | Extract<SavePatch, { type: "setAttr" }>
    | Extract<SavePatch, { type: "setAstroText" }>;

  const pendingImagePatchesRef = useRef<
    Map<string, ImagePatch>
  >(new Map());
  const baselineSrcRef = useRef<Map<string, string | null>>(new Map());
  const editModeCleanupRef = useRef<(() => void) | null>(null);

  const [selectorMode, setSelectorModeState] = useState(false);
  const [selectedElement, setSelectedElement] =
    useState<SelectedElement | null>(null);
  const [pendingChatMessage, setPendingChatMessage] = useState<{
    kind?: "task";
    message: string;
    startNewSession?: boolean;
  } | null>(null);
  const [pendingNewSessionRequestId, setPendingNewSessionRequestId] = useState<
    number | null
  >(null);
  const [editingTextFileState, setEditingTextFileState] = useState<string | null>(
    null,
  );
  const [viewingImagePathState, setViewingImagePathState] = useState<string | null>(
    null,
  );
  const [viewingPdfPathState, setViewingPdfPathState] = useState<string | null>(null);
  const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceSurface[]>([]);
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

  const utils = trpc.useUtils();

  const setAssetsOpen = useCallback((open: boolean) => {
    setAssetsOpenState(open);
  }, []);

  const currentWorkspace = useMemo<WorkspaceSurface>(() => {
    if (editingTextFileState) {
      return { kind: "text", path: editingTextFileState };
    }
    if (viewingImagePathState) {
      return { kind: "image", path: viewingImagePathState };
    }
    if (viewingPdfPathState) {
      return { kind: "pdf", path: viewingPdfPathState };
    }
    if (cmsOpenState) {
      return { kind: "cms" };
    }
    return { kind: "none" };
  }, [
    cmsOpenState,
    editingTextFileState,
    viewingImagePathState,
    viewingPdfPathState,
  ]);

  const applyWorkspaceSurface = useCallback((surface: WorkspaceSurface) => {
    setCmsOpenState(surface.kind === "cms");
    setEditingTextFileState(surface.kind === "text" ? surface.path : null);
    setViewingImagePathState(surface.kind === "image" ? surface.path : null);
    setViewingPdfPathState(surface.kind === "pdf" ? surface.path : null);
  }, []);

  const isSameWorkspaceSurface = useCallback(
    (left: WorkspaceSurface, right: WorkspaceSurface) => {
      if (left.kind !== right.kind) return false;
      if (
        left.kind === "text" ||
        left.kind === "image" ||
        left.kind === "pdf"
      ) {
        return left.path === (right as typeof left).path;
      }
      return true;
    },
    [],
  );

  const openWorkspaceSurface = useCallback(
    (
      nextSurface: Exclude<WorkspaceSurface, { kind: "none" }>,
      mode: "root" | "push" | "replace",
    ) => {
      if (isSameWorkspaceSurface(currentWorkspace, nextSurface)) {
        if (mode === "root" && workspaceHistory.length > 0) {
          setWorkspaceHistory([]);
        }
        applyWorkspaceSurface(nextSurface);
        return;
      }

      if (mode === "root") {
        setWorkspaceHistory([]);
      } else if (mode === "push" && currentWorkspace.kind !== "none") {
        setWorkspaceHistory([...workspaceHistory, currentWorkspace]);
      }

      applyWorkspaceSurface(nextSurface);
    },
    [
      applyWorkspaceSurface,
      currentWorkspace,
      isSameWorkspaceSurface,
      workspaceHistory,
    ],
  );

  const closeWorkspaceSurface = useCallback(
    (kind: WorkspaceSurface["kind"]) => {
      if (currentWorkspace.kind !== kind) {
        return;
      }

      if (workspaceHistory.length === 0) {
        applyWorkspaceSurface({ kind: "none" });
        return;
      }

      const nextHistory = workspaceHistory.slice(0, -1);
      const previousSurface = workspaceHistory[workspaceHistory.length - 1]!;
      setWorkspaceHistory(nextHistory);
      applyWorkspaceSurface(previousSurface);
    },
    [applyWorkspaceSurface, currentWorkspace.kind, workspaceHistory],
  );

  const setCmsOpen = useCallback(
    (open: boolean) => {
      if (open) {
        openWorkspaceSurface({ kind: "cms" }, "root");
        return;
      }
      if (currentWorkspace.kind !== "cms") {
        return;
      }
      setWorkspaceHistory([]);
      applyWorkspaceSurface({ kind: "none" });
    },
    [applyWorkspaceSurface, currentWorkspace.kind, openWorkspaceSurface],
  );

  const setEditingTextFile = useCallback(
    (path: string | null) => {
      if (!path) {
        closeWorkspaceSurface("text");
        return;
      }

      const openMode =
        currentWorkspace.kind === "none"
          ? "root"
          : currentWorkspace.kind === "cms"
            ? "push"
            : "replace";
      openWorkspaceSurface({ kind: "text", path }, openMode);
    },
    [closeWorkspaceSurface, currentWorkspace.kind, openWorkspaceSurface],
  );

  const setViewingImagePath = useCallback(
    (path: string | null) => {
      if (!path) {
        closeWorkspaceSurface("image");
        return;
      }

      const openMode =
        currentWorkspace.kind === "none"
          ? "root"
          : currentWorkspace.kind === "cms"
            ? "push"
            : "replace";
      openWorkspaceSurface({ kind: "image", path }, openMode);
    },
    [closeWorkspaceSurface, currentWorkspace.kind, openWorkspaceSurface],
  );

  const setViewingPdfPath = useCallback(
    (path: string | null) => {
      if (!path) {
        closeWorkspaceSurface("pdf");
        return;
      }

      const openMode =
        currentWorkspace.kind === "none"
          ? "root"
          : currentWorkspace.kind === "cms"
            ? "push"
            : "replace";
      openWorkspaceSurface({ kind: "pdf", path }, openMode);
    },
    [closeWorkspaceSurface, currentWorkspace.kind, openWorkspaceSurface],
  );

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

  const clearIframeLoadingDelayTimer = useCallback(() => {
    if (iframeLoadingDelayTimerRef.current === null) return;
    window.clearTimeout(iframeLoadingDelayTimerRef.current);
    iframeLoadingDelayTimerRef.current = null;
  }, []);

  const clearIframeLoadWatchdog = useCallback(() => {
    if (iframeLoadWatchdogRef.current === null) return;
    window.clearTimeout(iframeLoadWatchdogRef.current);
    iframeLoadWatchdogRef.current = null;
  }, []);

  const startIframeLoadWatchdog = useCallback(() => {
    clearIframeLoadWatchdog();
    iframeLoadWatchdogRef.current = window.setTimeout(() => {
      iframeLoadWatchdogRef.current = null;
      setIframeLoading(false);
    }, 25_000);
  }, [clearIframeLoadWatchdog]);

  const beginIframeLoading = useCallback(() => {
    clearIframeLoadingDelayTimer();
    clearIframeLoadWatchdog();
    setIframeLoading(true);
    startIframeLoadWatchdog();
  }, [clearIframeLoadingDelayTimer, startIframeLoadWatchdog]);

  const beginIframeNavigationLoading = useCallback(() => {
    clearIframeLoadingDelayTimer();
    // Avoid flicker for fast navigations.
    iframeLoadingDelayTimerRef.current = window.setTimeout(() => {
      iframeLoadingDelayTimerRef.current = null;
      setIframeLoading(true);
      startIframeLoadWatchdog();
    }, 150);
  }, [clearIframeLoadingDelayTimer, startIframeLoadWatchdog]);

  const endIframeLoading = useCallback(() => {
    clearIframeLoadingDelayTimer();
    clearIframeLoadWatchdog();
    setIframeLoading(false);
  }, [clearIframeLoadingDelayTimer, clearIframeLoadWatchdog]);

  useEffect(() => {
    return () => {
      clearIframeLoadingDelayTimer();
      clearIframeLoadWatchdog();
    };
  }, [clearIframeLoadingDelayTimer, clearIframeLoadWatchdog]);

  const syncUnsavedChangesState = useCallback(() => {
    setHasUnsavedChanges(pendingImagePatchesRef.current.size > 0);
  }, []);

  const clearPendingPatches = useCallback(() => {
    pendingImagePatchesRef.current.clear();
    baselineSrcRef.current.clear();
    syncUnsavedChangesState();
  }, [syncUnsavedChangesState]);

  const cleanupEditModeListeners = useCallback(() => {
    editModeCleanupRef.current?.();
    editModeCleanupRef.current = null;
  }, []);

  const getEditableTarget = useCallback((target: EventTarget | null) => {
    const asNode = target as Node | null;
    const start =
      target instanceof HTMLElement
        ? target
        : asNode?.parentElement instanceof HTMLElement
          ? asNode.parentElement
          : null;
    if (!start) return null;
    if (start.isContentEditable) return start;
    const closest = start.closest?.('[contenteditable="true"]');
    return closest instanceof HTMLElement ? closest : null;
  }, []);

  const getVivdSelector = useCallback((el: Element, doc: Document) => {
    if (el instanceof HTMLElement && el.id) {
      return `//*[@id="${el.id}"]`;
    }

    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== doc.body) {
      const parentElement: HTMLElement | null = current.parentElement;
      if (!parentElement) break;

      const currentTagName = current.tagName;
      const tagName = currentTagName.toLowerCase();
      const siblings = Array.from(parentElement.children).filter(
        (sibling: Element) => sibling.tagName === currentTagName,
      );

      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tagName}[${index}]`);
      } else {
        parts.unshift(tagName);
      }

      current = parentElement;
    }

    if (!parts.length) return null;
    return `/${parts.join("/")}`;
  }, []);

  const getElementSelector = useCallback(
    (el: Element, doc: Document) => {
      const stored = el.getAttribute?.("data-vivd-selector");
      if (stored) return stored;

      const selector = getVivdSelector(el, doc);
      if (selector) {
        (el as HTMLElement).setAttribute?.("data-vivd-selector", selector);
      }
      return selector;
    },
    [getVivdSelector],
  );

  const normalizeAstroSourceFile = useCallback((astroSourceFile: string) => {
    const srcMatch = astroSourceFile.match(/\/(src\/.*\.astro)$/i);
    return srcMatch ? srcMatch[1] : astroSourceFile;
  }, []);

  const getOriginalAssetUrlFromPreviewUrl = useCallback(
    (src: string | null) => {
      if (!src) return null;

      // Preserve relative URLs (e.g. "images/foo.png") as-is
      let normalized = src;
      if (
        normalized.startsWith("http://") ||
        normalized.startsWith("https://")
      ) {
        try {
          normalized = new URL(normalized).pathname;
        } catch {
          // ignore
        }
      }

      if (!projectSlug) return normalized;

      const prefixes = [
        resolveStudioRuntimePath(
          `/vivd-studio/api/preview/${projectSlug}/v${selectedVersion}`,
        ),
        resolveStudioRuntimePath(
          `/vivd-studio/api/projects/${projectSlug}/v${selectedVersion}`,
        ),
      ];

      for (const prefix of prefixes) {
        if (normalized.startsWith(prefix + "/")) {
          return normalized.slice(prefix.length);
        }
      }

      return normalized;
    },
    [projectSlug, selectedVersion],
  );

  const collectTextPatchesFromDocument = useCallback(
    (doc: Document): VivdPatch[] => {
      return collectVivdTextPatchesFromDocument(doc);
    },
    [],
  );

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

  // Fetch project data to get version information
  const { data: projectsData } = trpc.project.list.useQuery(undefined, {
    enabled: !!projectSlug,
  });

  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const versions = project?.versions || [];
  const totalVersions = project?.totalVersions || 1;
  const hasMultipleVersions = totalVersions > 1;
  const enabledPlugins = project?.enabledPlugins ?? [];
  const supportEmail = projectsData?.supportEmail ?? null;

  // Query for git changes (unsaved work)
  const { data: changesData } = trpc.project.gitHasChanges.useQuery(
    { slug: projectSlug!, version: selectedVersion },
    { enabled: !!projectSlug, refetchInterval: POLLING_BACKGROUND },
  );
  const hasGitChanges = changesData?.hasChanges || false;

  const { mutate: setCurrentVersion } =
    trpc.project.setCurrentVersion.useMutation({
      onSuccess: () => {
        utils.project.list.invalidate();
      },
    });

  // Sync selectedVersion with incoming version prop
  useEffect(() => {
    if (version && version !== selectedVersion) {
      setSelectedVersion(version);
    }
  }, [version]);

  // Query for preview info (mode + URL)
  const { data: previewInfo, isLoading: isPreviewLoading } =
    trpc.project.getPreviewInfo.useQuery(
      { slug: projectSlug!, version: selectedVersion },
      {
        enabled: !!projectSlug,
        refetchOnWindowFocus: true,
        refetchInterval: (query) => {
          // Keep polling while dev server is starting
          const status = query.state.data?.status;
          if (status === "starting" || status === "installing") {
            return POLLING_DEV_SERVER_STARTING;
          }
          return false;
        },
      },
    );

  const shareablePreviewOrigin = useMemo(() => getVivdHostOrigin(), []);
  const { data: shareablePreviewUrl } = trpc.project.getShareablePreviewUrl.useQuery(
    {
      slug: projectSlug!,
      version: selectedVersion,
      origin: shareablePreviewOrigin,
    },
    {
      enabled: !!projectSlug,
    },
  );

  // Before query returns, assume we're loading (prevents flash of static content)
  const previewMode = previewInfo?.mode ?? "static";
  const devServerStatus = isPreviewLoading
    ? "starting"
    : (previewInfo?.status ?? "ready");
  const devServerError =
    previewInfo?.mode === "devserver" ? previewInfo.error : undefined;

  // Mutation to keep dev server alive while preview is open
  const { mutate: keepAliveDevServer } =
    trpc.project.keepAliveDevServer.useMutation();

  // Keep dev server alive while preview is open by pinging every 2 minutes
  // The backend idle timeout is 5 minutes, so 2 minutes gives us a safe margin
  useEffect(() => {
    if (
      !projectSlug ||
      previewMode !== "devserver" ||
      devServerStatus !== "ready"
    ) {
      return;
    }

    const interval = setInterval(() => {
      keepAliveDevServer({ slug: projectSlug, version: selectedVersion });
    }, POLLING_DEV_SERVER_KEEPALIVE);

    return () => clearInterval(interval);
  }, [
    projectSlug,
    selectedVersion,
    previewMode,
    devServerStatus,
    keepAliveDevServer,
  ]);

  // Enable image drag-and-drop from Asset Explorer (disabled during text editing)
  useImageDropZone({
    iframeRef,
    projectSlug,
    version: selectedVersion,
    enabled: !!projectSlug && !editMode,
    onImageDropped: (assetPath, targetImg, previousSrcAttr) => {
      if (!iframeRef.current?.contentDocument) return;
      const doc = iframeRef.current.contentDocument;
      const selector = getElementSelector(targetImg, doc);
      if (!selector) return;

      const key = `setAttr:${selector}:src`;
      if (!baselineSrcRef.current.has(key)) {
        baselineSrcRef.current.set(
          key,
          getOriginalAssetUrlFromPreviewUrl(previousSrcAttr),
        );
      }

      const baseline = baselineSrcRef.current.get(key) ?? null;

      // If this is an Astro dev server element, patch the source .astro file instead of index.html.
      const astroSourceEl = targetImg.closest(
        "[data-astro-source-file]",
      ) as HTMLElement | null;
      const astroSourceFileRaw =
        astroSourceEl?.getAttribute("data-astro-source-file") ?? null;
      const astroSourceLoc =
        astroSourceEl?.getAttribute("data-astro-source-loc") ?? null;

      if (astroSourceFileRaw) {
        const sourceFile = normalizeAstroSourceFile(astroSourceFileRaw);
        if (!baseline) {
          toast.error(
            "This image doesn't have a source src value, so Vivd can't save the change for Astro projects.",
          );
          syncUnsavedChangesState();
          return;
        }
        const newValue = toAstroRuntimeAssetPath(assetPath, baseline);
        if (baseline === newValue) {
          pendingImagePatchesRef.current.delete(key);
        } else {
          pendingImagePatchesRef.current.set(key, {
            type: "setAstroText",
            sourceFile,
            sourceLoc: astroSourceLoc ?? undefined,
            oldValue: baseline,
            newValue,
          });
        }
        syncUnsavedChangesState();
        return;
      }

      // Static HTML projects: patch the HTML output directly.
      if (baseline === assetPath) {
        pendingImagePatchesRef.current.delete(key);
      } else {
        pendingImagePatchesRef.current.set(key, {
          type: "setAttr",
          selector,
          name: "src",
          value: assetPath,
        });
      }
      syncUnsavedChangesState();
    },
  });

  const handleVersionSelect = (newVersion: number) => {
    setSelectedVersion(newVersion);
    if (projectSlug) {
      setCurrentVersion({
        slug: projectSlug,
        version: newVersion,
      });
    }
    clearPendingPatches();
    // Refresh iframe to show new version
    setIframePreviewPath(currentPreviewPath);
    beginIframeLoading();
    setRefreshKey((prev) => prev + 1);
  };

  const { mutate: applyHtmlPatches, isPending: isSaving } =
    trpc.project.applyHtmlPatches.useMutation({
      onSuccess: (data) => {
        const errors = data.errors ?? [];
        const errorCount = errors.length;
        const hasMissingElements = errors.some(
          (e) => e.reason === "Element not found",
        );
        const hasAstroTextNotFound = errors.some((e) =>
          e.reason.startsWith("Text not found:"),
        );
        const hasMatchFailures = hasMissingElements || hasAstroTextNotFound;
        if (data.noChanges) {
          if (errorCount > 0) {
            toast.error(
              hasMatchFailures
                ? "We couldn't change this text (it's generated/data-driven). Please ask the agent to update it."
                : "We couldn't apply these changes here. Please ask the agent to update the source.",
            );
          } else {
            toast.info("No changes to save");
          }
        } else if (errorCount > 0) {
          toast.success(
            hasMissingElements
              ? "Saved (some edited text is generated by JavaScript and can't be saved here — ask the agent to update it)"
              : hasAstroTextNotFound
                ? "Saved (some edited text is data-driven and can't be saved here — ask the agent to update it)"
                : "Saved (some edits were skipped — ask the agent to update the missing ones)",
          );
        } else {
          toast.success("Changes saved successfully");
        }
        setEditMode(false);
        clearPendingPatches();
        cleanupEditModeListeners();
        beginIframeLoading();
        setRefreshKey((prev) => prev + 1);
        utils.project.gitHasChanges.invalidate();
      },
      onError: (error) => {
        toast.error(`Failed to save changes: ${error.message}`);
      },
    });

  const handleCancelEdit = () => {
    // Revert changes by reloading the iframe
    setEditMode(false);
    clearPendingPatches();
    cleanupEditModeListeners();
    setRefreshKey((prev) => prev + 1);
    toast.info("Changes discarded");
    beginIframeLoading();
  };

  const handleClose = () => {
    onClose();
  };

  const toggleEditMode = () => {
    if (editMode) {
      // If disabling edit mode via the toggle button, treated as cancel
      handleCancelEdit();
      return;
    }

    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;

    const doc = iframe.contentDocument;
    setEditMode(true);

    cleanupEditModeListeners();

    // Enable Edit Mode
    const style = doc.createElement("style");
    style.id = "edit-mode-styles";
    style.textContent = `
        [contenteditable="true"] {
          outline: 2px dashed #3b82f6 !important;
          cursor: text !important;
        }
        [contenteditable="true"]:hover {
          outline: 2px solid #2563eb !important;
          background-color: rgba(59, 130, 246, 0.1);
        }
        [contenteditable="true"]:focus {
          outline: 2px solid #2563eb !important;
          background-color: rgba(59, 130, 246, 0.05);
        }
        [data-vivd-editable-container="true"] {
          cursor: text !important;
        }
        [data-vivd-editable-container="true"]:hover {
          outline: 2px dashed #3b82f6 !important;
          background-color: rgba(59, 130, 246, 0.06);
        }
        [data-vivd-editable-container="true"]:focus-within {
          outline: 2px solid #2563eb !important;
          background-color: rgba(59, 130, 246, 0.04);
        }
    `;
    doc.head.appendChild(style);

    // Precompute selectors before we insert any helper spans. Our selector scheme uses sibling indexes,
    // so inserting spans would otherwise change selectors for existing elements and break patching.
    const allBodyElements = Array.from(doc.body.querySelectorAll("*"));
    allBodyElements.forEach((el) => {
      getElementSelector(el, doc);
    });

    const SKIP_TAGS = new Set([
      "script",
      "style",
      "noscript",
      "svg",
      "select",
      "option",
      "textarea",
    ]);
    const makeEditable = (element: Element) => {
      const el = element as HTMLElement;
      if (!el || el.isContentEditable) return;
      if (SKIP_TAGS.has(el.tagName.toLowerCase())) return;
      if (el.closest?.("svg")) return;

      const selector = getElementSelector(el, doc);
      if (!selector) return;
      const i18nKey = getI18nKeyForEditableElement(el);

      // Capture Astro source file info if available (from Astro dev server)
      // Walk up to find the nearest element with source info
      const astroSourceEl = el.closest(
        "[data-astro-source-file]",
      ) as HTMLElement | null;
      const astroSourceFile =
        astroSourceEl?.getAttribute("data-astro-source-file") ?? null;
      const astroSourceLoc =
        astroSourceEl?.getAttribute("data-astro-source-loc") ?? null;

      // Wrap direct non-whitespace text nodes in a contenteditable <span> and save via `setTextNode`.
      // This preserves existing child markup (icons, <strong>, <span>, etc.) and keeps diffs small.
      const directTextNodes = Array.from(el.childNodes).filter(
        (node): node is Text =>
          node.nodeType === Node.TEXT_NODE &&
          typeof node.nodeValue === "string" &&
          node.nodeValue.trim().length > 0,
      );

      if (!directTextNodes.length) return;
      el.setAttribute("data-vivd-editable-container", "true");

      directTextNodes.forEach((node, idx) => {
        const index = idx + 1;
        const original = node.nodeValue ?? "";
        const match = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const prefix = match?.[1] ?? "";
        const suffix = match?.[3] ?? "";
        const coreText = original.slice(
          prefix.length,
          original.length - suffix.length,
        );

        const fragment = doc.createDocumentFragment();
        if (prefix) fragment.appendChild(doc.createTextNode(prefix));

        const span = doc.createElement("span");
        span.setAttribute("data-vivd-text-parent-selector", selector);
        span.setAttribute("data-vivd-text-node-index", String(index));
        span.setAttribute("data-vivd-text-baseline", coreText);
        if (i18nKey) span.setAttribute("data-vivd-i18n-key", i18nKey);

        // Store Astro source info if available (for setAstroText patches)
        if (astroSourceFile) {
          // Convert absolute path to relative path from project root
          // The path from Astro is absolute, e.g. "/app/projects/a7koop/v1/src/components/Hero.astro"
          // We need to extract the relative part starting from "src/"
          const srcMatch = astroSourceFile.match(/\/(src\/.*\.astro)$/i);
          if (srcMatch) {
            span.setAttribute("data-vivd-source-file", srcMatch[1]);
          } else {
            // Fallback: just use the filename if we can't extract path
            span.setAttribute("data-vivd-source-file", astroSourceFile);
          }
          if (astroSourceLoc) {
            span.setAttribute("data-vivd-source-loc", astroSourceLoc);
          }
        }

        span.setAttribute("contenteditable", "true");
        span.textContent = coreText;
        span.addEventListener("click", (e) => e.stopPropagation());
        span.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
          }
        });

        fragment.appendChild(span);
        if (suffix) fragment.appendChild(doc.createTextNode(suffix));

        node.parentNode?.replaceChild(fragment, node);
      });
    };

    // Make all body elements with direct text editable (except skip tags).
    allBodyElements.forEach(makeEditable);

    // Prevent link navigation
    const links = doc.querySelectorAll("a");
    links.forEach((linkElement) => {
      const link = linkElement as HTMLAnchorElement;
      link.setAttribute("data-href-backup", link.getAttribute("href") || "");
      link.removeAttribute("href");
      link.style.cursor = "text";
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = getEditableTarget(event.target);
      if (!target) return;

      if (event.key === "Enter") {
        event.preventDefault();
      }
    };

    const handlePaste = (event: ClipboardEvent) => {
      const target = getEditableTarget(event.target);
      if (!target) return;

      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      doc.execCommand("insertText", false, text);
    };

    const handleClick = (event: MouseEvent) => {
      if (getEditableTarget(event.target)) return;

      const start =
        event.target instanceof HTMLElement
          ? event.target
          : (event.target as Node | null)?.parentElement instanceof HTMLElement
            ? (event.target as Node).parentElement
            : null;
      if (!start) return;

      const container = start.closest?.(
        '[data-vivd-editable-container="true"]',
      );
      const clickable = start.closest?.("[onclick], [role='link']");

      const focusRoot =
        (container instanceof HTMLElement ? container : null) ??
        (clickable instanceof HTMLElement ? clickable : null);
      if (!focusRoot) return;

      const firstEditable =
        focusRoot.querySelector<HTMLElement>('[contenteditable="true"]') ?? null;
      if (!firstEditable) return;
      event.preventDefault();
      event.stopPropagation();
      firstEditable.focus();
    };

    doc.addEventListener("keydown", handleKeyDown, true);
    doc.addEventListener("paste", handlePaste, true);
    doc.addEventListener("click", handleClick, true);

    editModeCleanupRef.current = () => {
      doc.removeEventListener("keydown", handleKeyDown, true);
      doc.removeEventListener("paste", handlePaste, true);
      doc.removeEventListener("click", handleClick, true);
    };

    toast.info("Edit Mode Enabled: Click text to edit");
  };

  const handleSave = () => {
    if (!projectSlug) return;

    const iframeDoc = iframeRef.current?.contentDocument ?? null;
    const textPatches = iframeDoc
      ? collectTextPatchesFromDocument(iframeDoc)
      : [];
    const imagePatches = Array.from(pendingImagePatchesRef.current.values());
    const patches = [...imagePatches, ...textPatches];

    if (!patches.length) {
      toast.info("No changes to save");
      setEditMode(false);
      clearPendingPatches();
      cleanupEditModeListeners();
      beginIframeLoading();
      setRefreshKey((prev) => prev + 1);
      return;
    }

    const getActiveHtmlFilePath = (): string => {
      if (previewMode !== "static") return "index.html";

      const iframe = iframeRef.current;
      const win = iframe?.contentWindow ?? null;
      let pathname = "";
      try {
        pathname = win?.location?.pathname ?? "";
      } catch {
        // Cross-origin iframe or blocked access.
        return "index.html";
      }
      if (!pathname) return "index.html";

      const bases = [
        resolveStudioRuntimePath(
          `/vivd-studio/api/preview/${projectSlug}/v${selectedVersion}`,
        ),
        resolveStudioRuntimePath(
          `/vivd-studio/api/projects/${projectSlug}/v${selectedVersion}`,
        ),
      ];

      let relative = pathname;
      for (const base of bases) {
        if (relative === base || relative.startsWith(`${base}/`)) {
          relative = relative.slice(base.length);
          break;
        }
      }

      relative = relative.replace(/^\/+/, "");
      if (!relative) return "index.html";

      try {
        relative = decodeURIComponent(relative);
      } catch {
        // ignore
      }

      if (relative.endsWith("/")) {
        relative = `${relative}index.html`;
      }

      // If there is no extension, treat it as a clean URL and append .html.
      if (!/\.[a-z0-9]+$/i.test(relative)) {
        relative = `${relative}.html`;
      }

      // Only patch HTML files; fall back to index.html otherwise.
      if (!/\.html?$/i.test(relative)) return "index.html";

      return relative;
    };

    applyHtmlPatches({
      slug: projectSlug,
      version: selectedVersion,
      filePath: getActiveHtmlFilePath(),
      patches,
    });
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
    maxWidth: 600,
    side: "left",
  });

  const livePreviewRootUrl = useMemo(() => {
    const candidate = originalUrl ?? url ?? previewInfo?.url ?? "/";
    if (!candidate) return "";
    return getPreviewRootUrl(resolveStudioRuntimePath(candidate), previewMode);
  }, [originalUrl, previewInfo?.url, previewMode, url]);

  const fallbackPublishPreviewUrl = useMemo(() => {
    if (!projectSlug) return "";
    return new URL(
      `/vivd-studio/api/preview/${projectSlug}/v${selectedVersion}/`,
      shareablePreviewOrigin,
    ).toString();
  }, [projectSlug, selectedVersion, shareablePreviewOrigin]);

  const stablePublishPreviewUrl = useMemo(() => {
    const candidate = shareablePreviewUrl?.url || fallbackPublishPreviewUrl;
    if (!candidate) return "";

    try {
      return new URL(candidate, shareablePreviewOrigin).toString();
    } catch {
      return candidate;
    }
  }, [fallbackPublishPreviewUrl, shareablePreviewOrigin, shareablePreviewUrl?.url]);

  const activePreviewRootUrl = livePreviewRootUrl;

  const fullUrl = activePreviewRootUrl
    ? withVivdStudioTokenQuery(
        buildPreviewUrl(activePreviewRootUrl, iframePreviewPath),
        getVivdStudioToken(),
      )
    : "";

  const navigatePreviewPath = useCallback(
    (path: string) => {
      const normalized = normalizePreviewPathInput(path);
      setCurrentPreviewPath(normalized);
      setIframePreviewPath(normalized);
      if (normalized === currentPreviewPath) {
        beginIframeLoading();
        setRefreshKey((prev) => prev + 1);
        return;
      }

      beginIframeLoading();
    },
    [beginIframeLoading, currentPreviewPath],
  );

  const handlePreviewLocationChange = useCallback(
    (href: string) => {
      if (!activePreviewRootUrl) return;
      const nextPath = getPreviewPathFromUrl(href, activePreviewRootUrl);
      setCurrentPreviewPath((prev) => (prev === nextPath ? prev : nextPath));
    },
    [activePreviewRootUrl],
  );

  useEffect(() => {
    setCurrentPreviewPath("/");
    setIframePreviewPath("/");
  }, [projectSlug]);

  const markPreviewUrlCopied = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleCopy = useCallback(() => {
    if (!publicPreviewEnabled) {
      toast.error("Preview URL is disabled for this project");
      return;
    }

    if (!stablePublishPreviewUrl) {
      toast.error("Preview URL is not ready yet");
      return;
    }

    copyTextWithFallback(stablePublishPreviewUrl)
      .then(() => {
        markPreviewUrlCopied();
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to copy preview URL", { description: message });
      });
  }, [markPreviewUrlCopied, publicPreviewEnabled, stablePublishPreviewUrl]);

  const handleOpenPreviewUrl = useCallback(() => {
    if (!publicPreviewEnabled) {
      toast.error("Preview URL is disabled for this project");
      return;
    }

    if (!stablePublishPreviewUrl) {
      toast.error("Preview URL is not ready yet");
      return;
    }

    openUrlInNewTab(stablePublishPreviewUrl);
  }, [publicPreviewEnabled, stablePublishPreviewUrl]);

  const handleTaskComplete = () => {
    // Refresh the iframe
    setIframePreviewPath(currentPreviewPath);
    setRefreshKey((prev) => prev + 1);
    beginIframeLoading();
  };

  const handleRefresh = () => {
    setIframePreviewPath(currentPreviewPath);
    beginIframeLoading();
    setRefreshKey((prev) => prev + 1);
    // Invalidate to restart dev server if it was shut down
    if (projectSlug) {
      // Cancel any in-flight previewInfo request first so a hung fetch doesn't
      // keep the UI stuck in a loading state until a full page reload.
      utils.project.getPreviewInfo.cancel({
        slug: projectSlug,
        version: selectedVersion,
      });
      utils.project.getPreviewInfo.invalidate({
        slug: projectSlug,
        version: selectedVersion,
      });
    }
  };

  // Element Selector Mode
  const setSelectorMode = useCallback((mode: boolean) => {
    setSelectorModeState(mode);
    if (!mode) {
      // Clean up selector in iframe
      const iframe = iframeRef.current;
      const targetOrigin = getPreviewBridgeOrigin(fullUrl) ?? window.location.origin;
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          { type: "vivd-cleanup-selector" },
          targetOrigin,
        );
      }
    }
  }, [fullUrl]);

  const clearSelectedElement = useCallback(() => {
    setSelectedElement(null);
  }, []);

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

  // Listen for element selection from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;

      if (isPreviewBridgeMessage(event.data)) {
        if (!iframeWindow || event.source !== iframeWindow) return;

        const previewOrigin = getPreviewBridgeOrigin(fullUrl);
        if (!previewOrigin || event.origin !== previewOrigin) return;

        if (event.data.type === "vivd:preview:navigation-start") {
          beginIframeNavigationLoading();
        }

        if (event.data.type === "vivd:preview:ready") {
          return;
        }

        if (event.data.type === "vivd:preview:location-change") {
          handlePreviewLocationChange(event.data.location.href);
          return;
        }

        if (event.data.type === "vivd:preview:navigation-complete") {
          handlePreviewLocationChange(event.data.location.href);
          endIframeLoading();
          return;
        }

        if (event.data.type === "vivd:preview:runtime-error") {
          endIframeLoading();
          const message =
            event.data.error?.message?.trim() || "Preview runtime error";
          toast.error(message, {
            description: event.data.error?.stack || event.data.kind || undefined,
          });
          return;
        }
      }

      if (iframeWindow && event.source !== iframeWindow) return;
      const previewOrigin = getPreviewBridgeOrigin(fullUrl);
      if (!previewOrigin || event.origin !== previewOrigin) return;

      if (event.data?.type === "vivd-element-selected") {
        const {
          description,
          selector,
          tagName,
          text,
          filename,
          astroSourceFile,
          astroSourceLoc,
        } = event.data.data;
        setSelectedElement({
          description,
          selector,
          tagName,
          text,
          filename: filename || "index.html",
          astroSourceFile,
          astroSourceLoc,
        });
        setSelectorModeState(false);
        // Open chat panel when element is selected
        setChatOpen(true);
      } else if (event.data?.type === "vivd-selector-cancelled") {
        setSelectorModeState(false);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    beginIframeNavigationLoading,
    endIframeLoading,
    fullUrl,
    handlePreviewLocationChange,
    setSelectorMode,
    setChatOpen,
  ]);

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
