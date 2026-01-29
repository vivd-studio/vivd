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
import { trpc } from "@/lib/trpc";
import { DEVICE_PRESETS, type DevicePreset } from "./types";
import {
  collectVivdTextPatchesFromDocument,
  getI18nKeyForEditableElement,
  type VivdPatch,
} from "@/lib/patching";

interface PreviewContextValue {
  // State
  refreshKey: number;
  mobileView: boolean;
  setMobileView: (mobile: boolean) => void;
  selectedDevice: DevicePreset;
  setSelectedDevice: (device: DevicePreset) => void;
  mobileScale: number;
  editMode: boolean;
  iframeLoading: boolean;
  isPreviewLoading: boolean;
  hasUnsavedChanges: boolean;

  // Refs
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
  mobileContainerRef: RefObject<HTMLDivElement | null>;

  // Computed
  fullUrl: string;
  previewMode: "static" | "dev-server";
  devServerStatus: "ready" | "starting" | "installing" | "error" | "none";
  devServerError?: string;

  // Handlers
  handleRefresh: () => void;
  toggleEditMode: () => void;
  handleSave: () => void;
  handleCancelEdit: () => void;

  // Status
  isSaving: boolean;
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
}

export function PreviewProvider({ children }: PreviewProviderProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [mobileView, setMobileView] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DevicePreset>(
    DEVICE_PRESETS[0]
  );
  const [mobileScale, setMobileScale] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const editModeCleanupRef = useRef<(() => void) | null>(null);
  const mobileContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Query for preview info
  const { data: previewInfo, isLoading: isPreviewLoading } =
    trpc.preview.getInfo.useQuery(undefined, {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "starting" || status === "installing") {
          return 1000;
        }
        return false;
      },
    });

  const previewMode =
    previewInfo?.mode === "dev-server" ? "dev-server" : "static";
  const devServerStatus = isPreviewLoading
    ? "starting"
    : (previewInfo?.status ?? "none");
  const devServerError = previewInfo?.error;
  const fullUrl = previewInfo?.url ?? "";

  // Keep dev server alive
  const { mutate: keepAlive } = trpc.preview.keepAlive.useMutation();

  useEffect(() => {
    if (previewMode !== "dev-server" || devServerStatus !== "ready") return;

    const interval = setInterval(() => {
      keepAlive();
    }, 120000); // 2 minutes

    return () => clearInterval(interval);
  }, [previewMode, devServerStatus, keepAlive]);

  // Calculate scale for mobile view
  const calculateScale = useCallback(() => {
    if (!mobileContainerRef.current || !mobileView) return;

    const container = mobileContainerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const padding = 80;
    const availableWidth = containerWidth - padding;
    const availableHeight = containerHeight - padding;
    const deviceTotalWidth = selectedDevice.width + 16;
    const deviceTotalHeight = selectedDevice.height + 16;
    const scaleX = availableWidth / deviceTotalWidth;
    const scaleY = availableHeight / deviceTotalHeight;
    const scale = Math.min(scaleX, scaleY, 1);

    setMobileScale(scale);
  }, [mobileView, selectedDevice]);

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
        (sibling: Element) => sibling.tagName === currentTagName
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
    [getVivdSelector]
  );

  const handleCancelEdit = useCallback(() => {
    setEditMode(false);
    setHasUnsavedChanges(false);
    cleanupEditModeListeners();
    setRefreshKey((prev) => prev + 1);
    setIframeLoading(true);
  }, [cleanupEditModeListeners]);

  const toggleEditMode = useCallback(() => {
    if (editMode) {
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

    // Precompute selectors
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

      const astroSourceEl = el.closest(
        "[data-astro-source-file]"
      ) as HTMLElement | null;
      const astroSourceFile =
        astroSourceEl?.getAttribute("data-astro-source-file") ?? null;
      const astroSourceLoc =
        astroSourceEl?.getAttribute("data-astro-source-loc") ?? null;

      const directTextNodes = Array.from(el.childNodes).filter(
        (node): node is Text =>
          node.nodeType === Node.TEXT_NODE &&
          typeof node.nodeValue === "string" &&
          node.nodeValue.trim().length > 0
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
          original.length - suffix.length
        );

        const fragment = doc.createDocumentFragment();
        if (prefix) fragment.appendChild(doc.createTextNode(prefix));

        const span = doc.createElement("span");
        span.setAttribute("data-vivd-text-parent-selector", selector);
        span.setAttribute("data-vivd-text-node-index", String(index));
        span.setAttribute("data-vivd-text-baseline", coreText);
        if (i18nKey) span.setAttribute("data-vivd-i18n-key", i18nKey);

        if (astroSourceFile) {
          const srcMatch = astroSourceFile.match(/\/(src\/.*\.astro)$/i);
          if (srcMatch) {
            span.setAttribute("data-vivd-source-file", srcMatch[1]);
          } else {
            span.setAttribute("data-vivd-source-file", astroSourceFile);
          }
          if (astroSourceLoc) {
            span.setAttribute("data-vivd-source-loc", astroSourceLoc);
          }
        }

        span.setAttribute("contenteditable", "true");
        span.textContent = coreText;

        fragment.appendChild(span);
        if (suffix) fragment.appendChild(doc.createTextNode(suffix));

        node.parentNode?.replaceChild(fragment, node);
      });
    };

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
        '[data-vivd-editable-container="true"]'
      );
      if (!(container instanceof HTMLElement)) return;

      const firstEditable = container.querySelector<HTMLElement>(
        '[contenteditable="true"]'
      );
      if (!firstEditable) return;
      firstEditable.focus();
    };

    const handleInput = () => {
      setHasUnsavedChanges(true);
    };

    doc.addEventListener("keydown", handleKeyDown, true);
    doc.addEventListener("paste", handlePaste, true);
    doc.addEventListener("click", handleClick, true);
    doc.addEventListener("input", handleInput, true);

    editModeCleanupRef.current = () => {
      doc.removeEventListener("keydown", handleKeyDown, true);
      doc.removeEventListener("paste", handlePaste, true);
      doc.removeEventListener("click", handleClick, true);
      doc.removeEventListener("input", handleInput, true);
    };
  }, [
    editMode,
    handleCancelEdit,
    cleanupEditModeListeners,
    getElementSelector,
    getEditableTarget,
  ]);

  // Save mutation
  const { mutate: applyPatches } = trpc.edit.applyPatches.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        // Auto-commit and push
        gitSave({ message: "Edit from Vivd Studio" });
      } else {
        setIsSaving(false);
        console.error("Failed to apply patches:", data.errors);
      }
    },
    onError: (error) => {
      setIsSaving(false);
      console.error("Failed to save changes:", error.message);
    },
  });

  const { mutate: gitSave } = trpc.git.save.useMutation({
    onSuccess: () => {
      setIsSaving(false);
      setEditMode(false);
      setHasUnsavedChanges(false);
      cleanupEditModeListeners();
      setIframeLoading(true);
      setRefreshKey((prev) => prev + 1);
    },
    onError: (error) => {
      setIsSaving(false);
      console.error("Failed to save to git:", error.message);
    },
  });

  const handleSave = useCallback(() => {
    const iframeDoc = iframeRef.current?.contentDocument ?? null;
    const patches = iframeDoc
      ? collectVivdTextPatchesFromDocument(iframeDoc)
      : [];

    if (!patches.length) {
      setEditMode(false);
      setHasUnsavedChanges(false);
      cleanupEditModeListeners();
      setIframeLoading(true);
      setRefreshKey((prev) => prev + 1);
      return;
    }

    setIsSaving(true);
    applyPatches({
      file: "index.html",
      patches: patches as VivdPatch[],
    });
  }, [applyPatches, cleanupEditModeListeners]);

  const handleRefresh = useCallback(() => {
    setIframeLoading(true);
    setRefreshKey((prev) => prev + 1);
  }, []);

  // Global Escape key handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editMode) {
        handleCancelEdit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, handleCancelEdit]);

  const value: PreviewContextValue = {
    refreshKey,
    mobileView,
    setMobileView,
    selectedDevice,
    setSelectedDevice,
    mobileScale,
    editMode,
    iframeLoading,
    isPreviewLoading,
    hasUnsavedChanges,
    iframeRef,
    onIframeLoad: () => setIframeLoading(false),
    mobileContainerRef,
    fullUrl,
    previewMode,
    devServerStatus,
    devServerError,
    handleRefresh,
    toggleEditMode,
    handleSave,
    handleCancelEdit,
    isSaving,
  };

  return (
    <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
  );
}
