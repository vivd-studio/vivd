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
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { getVivdStudioToken, withVivdStudioTokenQuery } from "@/lib/studioAuth";
import {
  POLLING_BACKGROUND,
  POLLING_DEV_SERVER_STARTING,
  POLLING_DEV_SERVER_KEEPALIVE,
} from "@/app/config/polling";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useImageDropZone } from "./useImageDropZone";
import { DEVICE_PRESETS, type DevicePreset } from "./types";
import {
  collectVivdTextPatchesFromDocument,
  getI18nKeyForEditableElement,
  type VivdPatch,
} from "@/lib/vivdPreviewTextPatching";
import type { AssetItem, FileTreeNode } from "../asset-explorer/types";

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

export type PanelLayoutMode = "assets-left" | "agent-left";

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
  panelLayoutMode: PanelLayoutMode;
  setPanelLayoutMode: (mode: PanelLayoutMode) => void;
  refreshKey: number;
  selectedVersion: number;
  mobileView: boolean;
  setMobileView: (mobile: boolean) => void;
  selectedDevice: DevicePreset;
  setSelectedDevice: (device: DevicePreset) => void;
  mobileScale: number;
  editMode: boolean;
  iframeLoading: boolean;
  isPreviewLoading: boolean;
  hasUnsavedChanges: boolean;

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
  previewMode: "static" | "devserver";
  devServerStatus: "ready" | "starting" | "installing" | "error" | "none";
  devServerError?: string;
  versions: VersionInfo[];
  totalVersions: number;
  hasMultipleVersions: boolean;
  enabledPlugins: string[];
  analyticsAvailable: boolean;
  assetPanelSide: "left" | "right";
  chatPanelSide: "left" | "right";

  // Handlers
  handleVersionSelect: (version: number) => void;
  handleCopy: () => void;
  handleRefresh: () => void;
  handleTaskComplete: () => void;
  toggleEditMode: () => void;
  handleSave: () => void;
  handleCancelEdit: () => void;
  handleClose: () => void;

  // Cross-component chat messaging
  pendingChatMessage: { message: string; startNewSession?: boolean } | null;
  sendChatMessage: (
    message: string,
    options?: { startNewSession?: boolean },
  ) => void;
  clearPendingChatMessage: () => void;

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
  const [chatOpen, setChatOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [panelLayoutMode, setPanelLayoutMode] = useState<PanelLayoutMode>(
    () => {
      if (typeof window === "undefined") return "assets-left";
      const stored = window.localStorage.getItem("previewModal.panelLayoutMode");
      return stored === "agent-left" || stored === "assets-left"
        ? stored
        : "assets-left";
    },
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(true);
  const iframeLoadingDelayTimerRef = useRef<number | null>(null);
  const [selectedVersion, setSelectedVersion] = useState(version || 1);
  const [mobileView, setMobileView] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DevicePreset>(
    DEVICE_PRESETS[0],
  );
  const [mobileScale, setMobileScale] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const assetPanelSide = panelLayoutMode === "assets-left" ? "left" : "right";
  const chatPanelSide = panelLayoutMode === "assets-left" ? "right" : "left";

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("previewModal.panelLayoutMode", panelLayoutMode);
  }, [panelLayoutMode]);

  const clearIframeLoadingDelayTimer = useCallback(() => {
    if (iframeLoadingDelayTimerRef.current === null) return;
    window.clearTimeout(iframeLoadingDelayTimerRef.current);
    iframeLoadingDelayTimerRef.current = null;
  }, []);

  const beginIframeLoading = useCallback(() => {
    clearIframeLoadingDelayTimer();
    setIframeLoading(true);
  }, [clearIframeLoadingDelayTimer]);

  const beginIframeNavigationLoading = useCallback(() => {
    clearIframeLoadingDelayTimer();
    // Avoid flicker for fast navigations.
    iframeLoadingDelayTimerRef.current = window.setTimeout(() => {
      iframeLoadingDelayTimerRef.current = null;
      setIframeLoading(true);
    }, 150);
  }, [clearIframeLoadingDelayTimer]);

  const endIframeLoading = useCallback(() => {
    clearIframeLoadingDelayTimer();
    setIframeLoading(false);
  }, [clearIframeLoadingDelayTimer]);

  useEffect(() => {
    return () => clearIframeLoadingDelayTimer();
  }, [clearIframeLoadingDelayTimer]);

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
    message: string;
    startNewSession?: boolean;
  } | null>(null);
  const [editingTextFile, setEditingTextFile] = useState<string | null>(null);
  const [viewingImagePath, setViewingImagePath] = useState<string | null>(null);
  const [viewingPdfPath, setViewingPdfPath] = useState<string | null>(null);
  const [editingAsset, setEditingAsset] = useState<
    AssetItem | FileTreeNode | null
  >(null);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState<
    AssetItem | FileTreeNode | null
  >(null);
  const mobileContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const utils = trpc.useUtils();

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
        `/vivd-studio/api/devpreview/${projectSlug}/v${selectedVersion}`,
        `/vivd-studio/api/preview/${projectSlug}/v${selectedVersion}`,
        `/vivd-studio/api/projects/${projectSlug}/v${selectedVersion}`,
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

  const toPublicUrlPath = useCallback(
    (assetPath: string, baseline: string | null) => {
      const withoutLeadingSlash = assetPath.replace(/^\/+/, "");
      const withoutPublicPrefix = withoutLeadingSlash.replace(/^public\//, "");
      const baselineHasLeadingSlash = (baseline ?? "").startsWith("/");
      return baselineHasLeadingSlash
        ? `/${withoutPublicPrefix}`
        : withoutPublicPrefix;
    },
    [],
  );

  const collectTextPatchesFromDocument = useCallback(
    (doc: Document): VivdPatch[] => {
      return collectVivdTextPatchesFromDocument(doc);
    },
    [],
  );

  // Calculate scale to fit phone in container
  const calculateScale = useCallback(() => {
    if (!mobileContainerRef.current || !mobileView) return;

    const container = mobileContainerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Add padding (40px on each side)
    const padding = 80;
    const availableWidth = containerWidth - padding;
    const availableHeight = containerHeight - padding;

    // Device dimensions include the border (8px on each side)
    const deviceTotalWidth = selectedDevice.width + 16;
    const deviceTotalHeight = selectedDevice.height + 16;

    // Calculate scale to fit both dimensions
    const scaleX = availableWidth / deviceTotalWidth;
    const scaleY = availableHeight / deviceTotalHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Never scale up

    setMobileScale(scale);
  }, [mobileView, selectedDevice]);

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
  const analyticsAvailable = enabledPlugins.includes("analytics");

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

  // Track current values in refs for cleanup (avoids stale closures)
  const projectSlugRef = useRef(projectSlug);
  const selectedVersionRef = useRef(selectedVersion);

  useEffect(() => {
    projectSlugRef.current = projectSlug;
    selectedVersionRef.current = selectedVersion;
  }, [projectSlug, selectedVersion]);

  // Stop server when component unmounts
  // Uses sendBeacon for reliable delivery even during React teardown
  useEffect(() => {
    return () => {
      const slug = projectSlugRef.current;
      const version = selectedVersionRef.current;
      if (slug && version !== undefined) {
        const payload = JSON.stringify({ slug, version });
        // Must use Blob with correct content-type for express.json() to parse it
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(
          withVivdStudioTokenQuery(
            "/vivd-studio/api/cleanup/preview-leave",
            getVivdStudioToken(),
          ),
          blob,
        );
      }
    };
  }, []);

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
        const newValue = toPublicUrlPath(assetPath, baseline);
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
        `/vivd-studio/api/preview/${projectSlug}/v${selectedVersion}`,
        `/vivd-studio/api/projects/${projectSlug}/v${selectedVersion}`,
        "/preview",
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
    side: assetPanelSide,
  });

  const chatPanel = useResizablePanel({
    storageKey: "previewModal.chatPanelWidth",
    defaultWidth: 400,
    minWidth: 320,
    maxWidth: 600,
    side: chatPanelSide,
  });

  // Build version-aware URL - use dynamic URL from previewInfo if available
  const baseUrl = previewInfo?.url
    ? previewInfo.url
    : isPreviewLoading
      ? ""
      : projectSlug
        ? `/vivd-studio/api/preview/${projectSlug}/v${selectedVersion}/index.html`
        : url?.startsWith("http") || url?.startsWith("/vivd-studio/api")
          ? url
          : `/vivd-studio/api${url}`;
  const fullUrl = baseUrl || "";

  const getShareablePreviewOrigin = () => {
    const params = new URLSearchParams(window.location.search);

    // Prefer explicit hostOrigin param set by the parent app.
    const hostOrigin = params.get("hostOrigin");
    if (hostOrigin) {
      try {
        return new URL(hostOrigin).origin;
      } catch {
        // Ignore invalid values.
      }
    }

    // Fallback: extract origin from returnTo URL.
    const returnTo = params.get("returnTo");
    if (returnTo) {
      try {
        return new URL(returnTo).origin;
      } catch {
        // Ignore invalid returnTo values.
      }
    }

    if (document.referrer) {
      try {
        return new URL(document.referrer).origin;
      } catch {
        // Ignore invalid referrers.
      }
    }

    return window.location.origin;
  };

  const handleCopy = () => {
    // Always copy the external preview URL, not the internal dev server URL
    if (!projectSlug) return;
    if (!publicPreviewEnabled) {
      toast.error("Preview URL is disabled for this project");
      return;
    }

    const origin = getShareablePreviewOrigin();
    utils.project
      .getShareablePreviewUrl
      .fetch({ slug: projectSlug, version: selectedVersion, origin })
      .then((data) => {
        const absoluteUrl = new URL(data.url, origin).toString();
        return navigator.clipboard.writeText(absoluteUrl);
      })
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to copy preview URL", { description: message });
      });
  };

  const handleTaskComplete = () => {
    // Refresh the iframe
    setRefreshKey((prev) => prev + 1);
    beginIframeLoading();
  };

  const handleRefresh = () => {
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
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          { type: "vivd-cleanup-selector" },
          "*",
        );
      }
    }
  }, []);

  const clearSelectedElement = useCallback(() => {
    setSelectedElement(null);
  }, []);

  // Cross-component chat messaging: allows PublishDialog to send messages to chat
  const sendChatMessage = useCallback(
    (message: string, options?: { startNewSession?: boolean }) => {
      setChatOpen(true);
      setPendingChatMessage({
        message,
        startNewSession: options?.startNewSession,
      });
    },
    [],
  );

  const clearPendingChatMessage = useCallback(() => {
    setPendingChatMessage(null);
  }, []);

  // Listen for element selection from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
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

  // Stop opencode server on tab/window close using sendBeacon for reliable delivery
  // sendBeacon is specifically designed for page unload - browser guarantees delivery
  useEffect(() => {
    if (!projectSlug) return;

    const handleBeforeUnload = () => {
      const payload = JSON.stringify({
        slug: projectSlug,
        version: selectedVersion,
      });
      // Must use Blob with correct content-type for express.json() to parse it
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(
        withVivdStudioTokenQuery(
          "/vivd-studio/api/cleanup/preview-leave",
          getVivdStudioToken(),
        ),
        blob,
      );
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
    chatOpen,
    setChatOpen,
    assetsOpen,
    setAssetsOpen,
    panelLayoutMode,
    setPanelLayoutMode,
    refreshKey,
    selectedVersion,
    mobileView,
    setMobileView,
    selectedDevice,
    setSelectedDevice,
    mobileScale,
    editMode,
    iframeLoading,
    isPreviewLoading,
    hasUnsavedChanges,

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
    analyticsAvailable,
    assetPanelSide,
    chatPanelSide,

    // Handlers
    handleVersionSelect,
    handleCopy,
    handleRefresh,
    handleTaskComplete,
    toggleEditMode,
    handleSave,
    handleCancelEdit,
    handleClose,

    isSaving,

    // Cross-component chat messaging
    pendingChatMessage,
    sendChatMessage,
    clearPendingChatMessage,

    // Text Editor in preview area
    editingTextFile,
    setEditingTextFile,

    // Image Viewer in preview area
    viewingImagePath,
    setViewingImagePath,

    // PDF Viewer in preview area
    viewingPdfPath,
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
