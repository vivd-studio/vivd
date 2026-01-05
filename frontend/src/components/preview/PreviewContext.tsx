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
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useImageDropZone } from "./useImageDropZone";
import { DEVICE_PRESETS, type DevicePreset } from "./types";

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
}

interface PreviewContextValue {
  // Props
  url: string | null;
  originalUrl?: string | null;
  projectSlug?: string;
  version?: number;

  // State
  copied: boolean;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  assetsOpen: boolean;
  setAssetsOpen: (open: boolean) => void;
  refreshKey: number;
  selectedVersion: number;
  mobileView: boolean;
  setMobileView: (mobile: boolean) => void;
  selectedDevice: DevicePreset;
  setSelectedDevice: (device: DevicePreset) => void;
  mobileScale: number;
  editMode: boolean;
  iframeLoading: boolean;
  hasUnsavedChanges: boolean;

  // Element Selector
  selectorMode: boolean;
  setSelectorMode: (mode: boolean) => void;
  selectedElement: SelectedElement | null;
  clearSelectedElement: () => void;

  // Refs
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
  mobileContainerRef: RefObject<HTMLDivElement | null>;

  // Computed
  fullUrl: string;
  versions: VersionInfo[];
  totalVersions: number;
  hasMultipleVersions: boolean;

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
    options?: { startNewSession?: boolean }
  ) => void;
  clearPendingChatMessage: () => void;

  // Mutations
  saveFileMutation: ReturnType<typeof trpc.project.saveFile.useMutation>;

  // Resizable panels
  assetPanel: ReturnType<typeof useResizablePanel>;
  chatPanel: ReturnType<typeof useResizablePanel>;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

export function usePreview() {
  const context = useContext(PreviewContext);
  if (!context) {
    throw new Error("usePreview must be used within a PreviewProvider");
  }
  return context;
}

interface PreviewProviderProps {
  children: ReactNode;
  url: string | null;
  originalUrl?: string | null;
  projectSlug?: string;
  version?: number;
  onClose: () => void;
}

export function PreviewProvider({
  children,
  url,
  originalUrl,
  projectSlug,
  version,
  onClose,
}: PreviewProviderProps) {
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState(version || 1);
  const [mobileView, setMobileView] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DevicePreset>(
    DEVICE_PRESETS[0]
  );
  const [mobileScale, setMobileScale] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [selectorMode, setSelectorModeState] = useState(false);
  const [selectedElement, setSelectedElement] =
    useState<SelectedElement | null>(null);
  const [pendingChatMessage, setPendingChatMessage] = useState<{
    message: string;
    startNewSession?: boolean;
  } | null>(null);
  const mobileContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const utils = trpc.useUtils();

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

  // Query for git changes (unsaved work)
  const { data: changesData } = trpc.project.gitHasChanges.useQuery(
    { slug: projectSlug!, version: selectedVersion },
    { enabled: !!projectSlug, refetchInterval: 5000 }
  );
  const hasGitChanges = changesData?.hasChanges || false;

  const setCurrentVersionMutation = trpc.project.setCurrentVersion.useMutation({
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

  // Enable image drag-and-drop from Asset Explorer (disabled during text editing)
  useImageDropZone({
    iframeRef,
    projectSlug,
    enabled: !!projectSlug && !editMode,
    onImageDropped: () => {
      // Mark as having unsaved changes when an image is dropped
      setHasUnsavedChanges(true);
    },
  });

  const handleVersionSelect = (newVersion: number) => {
    setSelectedVersion(newVersion);
    if (projectSlug) {
      setCurrentVersionMutation.mutate({
        slug: projectSlug,
        version: newVersion,
      });
    }
    // Refresh iframe to show new version
    setIframeLoading(true);
    setRefreshKey((prev) => prev + 1);
  };

  const saveFileMutation = trpc.project.saveFile.useMutation({
    onSuccess: () => {
      toast.success("Changes saved successfully");
      setEditMode(false);
      setHasUnsavedChanges(false);
      setHasUnsavedChanges(false);
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
    setHasUnsavedChanges(false);
    setRefreshKey((prev) => prev + 1);
    toast.info("Changes discarded");
    setIframeLoading(true);
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
    `;
    doc.head.appendChild(style);

    // 1. Always editable text blocks
    const textBlocks = doc.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, cite"
    );
    textBlocks.forEach((el) => {
      el.setAttribute("contenteditable", "true");
    });

    // 2. Conditionally editable containers
    const structuralTags = [
      "DIV",
      "P",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "UL",
      "OL",
      "TABLE",
      "IMG",
      "SECTION",
      "ARTICLE",
      "HEADER",
      "FOOTER",
      "NAV",
      "ASIDE",
      "MAIN",
    ];

    const potentialTextContainers = doc.querySelectorAll(
      "a, span, button, td, th, div, b, i, strong, em, small"
    );

    potentialTextContainers.forEach((element) => {
      const el = element as HTMLElement;
      if (el.isContentEditable) return;

      const hasStructuralChildren = Array.from(el.children).some((child) =>
        structuralTags.includes(child.tagName)
      );

      if (!hasStructuralChildren) {
        if (el.innerText.trim().length > 0 || el.children.length > 0) {
          el.setAttribute("contenteditable", "true");
        }
      }
    });

    // Prevent link navigation
    const links = doc.querySelectorAll("a");
    links.forEach((linkElement) => {
      const link = linkElement as HTMLAnchorElement;
      link.setAttribute("data-href-backup", link.getAttribute("href") || "");
      link.removeAttribute("href");
      link.style.cursor = "text";
    });

    toast.info("Edit Mode Enabled: Click text to edit");
  };

  /**
   * Clean up ALL injected content from the iframe DOM before saving.
   * This ensures no preview-specific scripts, styles, or attributes are persisted.
   */
  const cleanupInjectedContent = (doc: Document) => {
    // 1. Remove injected scripts
    const scriptsToRemove = ["vivd-highlight-script", "vivd-selector-script"];
    scriptsToRemove.forEach((id) => {
      const script = doc.getElementById(id);
      if (script) script.remove();
    });

    // 2. Remove injected styles
    const stylesToRemove = [
      "edit-mode-styles",
      "vivd-scrollbar-styles",
      "image-drop-zone-styles",
    ];
    stylesToRemove.forEach((id) => {
      const style = doc.getElementById(id);
      if (style) style.remove();
    });

    // 3. Remove contenteditable attributes
    const editable = doc.querySelectorAll('[contenteditable="true"]');
    editable.forEach((el) => el.removeAttribute("contenteditable"));

    // 4. Restore links (edit mode backup)
    const links = doc.querySelectorAll("a[data-href-backup]");
    links.forEach((linkElement) => {
      const link = linkElement as HTMLAnchorElement;
      link.setAttribute("href", link.getAttribute("data-href-backup") || "");
      link.removeAttribute("data-href-backup");
      link.style.cursor = "";
    });

    // 5. Remove image drop zone attributes
    const imagesWithDropTarget = doc.querySelectorAll("img[data-drop-target]");
    imagesWithDropTarget.forEach((img) => {
      img.removeAttribute("data-drop-target");
      img.removeAttribute("data-original-src");
    });

    // 6. Remove drag-mode-active class from body
    if (doc.body) {
      doc.body.classList.remove("drag-mode-active");
    }
  };

  const handleSave = () => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument || !projectSlug) return;

    const doc = iframe.contentDocument;
    cleanupInjectedContent(doc);

    const htmlContent = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;

    saveFileMutation.mutate({
      slug: projectSlug,
      version: selectedVersion,
      filePath: "index.html",
      content: htmlContent,
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
    side: "right",
  });

  // Build version-aware URL
  const baseUrl = projectSlug
    ? `/vivd-studio/api/preview/${projectSlug}/v${selectedVersion}/index.html`
    : url?.startsWith("http") || url?.startsWith("/vivd-studio/api")
    ? url
    : `/vivd-studio/api${url}`;
  const fullUrl = baseUrl || "";

  const handleCopy = () => {
    const absoluteUrl = fullUrl.startsWith("http")
      ? fullUrl
      : `${window.location.origin}${fullUrl}`;

    navigator.clipboard.writeText(absoluteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTaskComplete = () => {
    // Refresh the iframe
    setRefreshKey((prev) => prev + 1);
    setIframeLoading(true);
  };

  const handleRefresh = () => {
    setIframeLoading(true);
    setRefreshKey((prev) => prev + 1);
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
          "*"
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
    []
  );

  const clearPendingChatMessage = useCallback(() => {
    setPendingChatMessage(null);
  }, []);

  // Listen for element selection from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "vivd-element-selected") {
        const { description, selector, tagName, text, filename } =
          event.data.data;
        setSelectedElement({
          description,
          selector,
          tagName,
          text,
          filename: filename || "index.html",
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
    refreshKey,
    selectedVersion,
    mobileView,
    setMobileView,
    selectedDevice,
    setSelectedDevice,
    mobileScale,
    editMode,
    iframeLoading,
    hasUnsavedChanges,

    // Element Selector
    selectorMode,
    setSelectorMode,
    selectedElement,
    clearSelectedElement,

    // Refs
    iframeRef,
    onIframeLoad: () => setIframeLoading(false),
    mobileContainerRef,

    // Computed
    fullUrl,
    versions,
    totalVersions,
    hasMultipleVersions,

    // Handlers
    handleVersionSelect,
    handleCopy,
    handleRefresh,
    handleTaskComplete,
    toggleEditMode,
    handleSave,
    handleCancelEdit,
    handleClose,

    // Cross-component chat messaging
    pendingChatMessage,
    sendChatMessage,
    clearPendingChatMessage,

    // Mutations
    saveFileMutation,

    // Resizable panels
    assetPanel,
    chatPanel,
  };

  return (
    <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
  );
}
