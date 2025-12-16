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
import {
  DEVICE_PRESETS,
  type DevicePreset,
  type PreviewModalProps,
} from "./types";

// Version info from project data
interface VersionInfo {
  version: number;
  status: string;
}

interface PreviewModalContextValue {
  // Props
  open: boolean;
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
  hasUnsavedChanges: boolean;
  showExitConfirmation: boolean;
  setShowExitConfirmation: (show: boolean) => void;

  // Refs
  iframeRef: RefObject<HTMLIFrameElement | null>;
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
  handleClose: (open: boolean) => void;
  handleDiscardAndClose: () => void;
  handleSaveAndClose: () => void;

  // Mutations
  saveFileMutation: ReturnType<typeof trpc.project.saveFile.useMutation>;

  // Resizable panels
  assetPanel: ReturnType<typeof useResizablePanel>;
  chatPanel: ReturnType<typeof useResizablePanel>;
}

const PreviewModalContext = createContext<PreviewModalContextValue | null>(
  null
);

export function usePreviewModal() {
  const context = useContext(PreviewModalContext);
  if (!context) {
    throw new Error(
      "usePreviewModal must be used within a PreviewModalProvider"
    );
  }
  return context;
}

interface PreviewModalProviderProps extends PreviewModalProps {
  children: ReactNode;
}

export function PreviewModalProvider({
  children,
  open,
  onOpenChange,
  url,
  originalUrl,
  projectSlug,
  version,
}: PreviewModalProviderProps) {
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState(version || 1);
  const [mobileView, setMobileView] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DevicePreset>(
    DEVICE_PRESETS[0]
  );
  const [mobileScale, setMobileScale] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showExitConfirmation, setShowExitConfirmation] = useState(false);
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
    enabled: open && !!projectSlug,
  });

  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const versions = project?.versions || [];
  const totalVersions = project?.totalVersions || 1;
  const hasMultipleVersions = totalVersions > 1;

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
    enabled: open && !!projectSlug && !editMode,
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
    setRefreshKey((prev) => prev + 1);
  };

  const saveFileMutation = trpc.project.saveFile.useMutation({
    onSuccess: () => {
      toast.success("Changes saved successfully");
      setEditMode(false);
      setHasUnsavedChanges(false);
      setShowExitConfirmation(false);
      setRefreshKey((prev) => prev + 1);
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
  };

  const handleClose = (newOpen: boolean) => {
    if (!newOpen && (editMode || hasUnsavedChanges)) {
      setShowExitConfirmation(true);
    } else {
      onOpenChange(newOpen);
    }
  };

  const handleDiscardAndClose = () => {
    setEditMode(false);
    setHasUnsavedChanges(false);
    setShowExitConfirmation(false);
    onOpenChange(false);
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

  const cleanupEditMode = (doc: Document) => {
    const style = doc.getElementById("edit-mode-styles");
    if (style) style.remove();

    const editable = doc.querySelectorAll('[contenteditable="true"]');
    editable.forEach((el) => el.removeAttribute("contenteditable"));

    // Restore links
    const links = doc.querySelectorAll("a[data-href-backup]");
    links.forEach((linkElement) => {
      const link = linkElement as HTMLAnchorElement;
      link.setAttribute("href", link.getAttribute("data-href-backup") || "");
      link.removeAttribute("data-href-backup");
      link.style.cursor = "";
    });
  };

  const handleSave = () => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument || !projectSlug) return;

    const doc = iframe.contentDocument;
    cleanupEditMode(doc);

    const htmlContent = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;

    saveFileMutation.mutate({
      slug: projectSlug,
      version: selectedVersion,
      filePath: "index.html",
      content: htmlContent,
    });
  };

  const handleSaveAndClose = () => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument || !projectSlug) return;

    const doc = iframe.contentDocument;
    cleanupEditMode(doc);

    const htmlContent = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;

    saveFileMutation.mutate(
      {
        slug: projectSlug,
        version: selectedVersion,
        filePath: "index.html",
        content: htmlContent,
      },
      {
        onSuccess: () => {
          toast.success("Changes saved successfully");
          setEditMode(false);
          setHasUnsavedChanges(false);
          setShowExitConfirmation(false);
          onOpenChange(false); // Close the main modal
          setRefreshKey((prev) => prev + 1);
        },
      }
    );
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
    ? `/api/preview/${projectSlug}/v${selectedVersion}/index.html`
    : url?.startsWith("http") || url?.startsWith("/api")
    ? url
    : `/api${url}`;
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
  };

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const value: PreviewModalContextValue = {
    // Props
    open,
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
    hasUnsavedChanges,
    showExitConfirmation,
    setShowExitConfirmation,

    // Refs
    iframeRef,
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
    handleDiscardAndClose,
    handleSaveAndClose,

    // Mutations
    saveFileMutation,

    // Resizable panels
    assetPanel,
    chatPanel,
  };

  return (
    <PreviewModalContext.Provider value={value}>
      {children}
    </PreviewModalContext.Provider>
  );
}
