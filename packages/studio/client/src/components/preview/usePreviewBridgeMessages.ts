import {
  useCallback,
  useEffect,
  useState,
  type RefObject,
} from "react";
import { toast } from "sonner";
import {
  getPreviewBridgeOrigin,
  isPreviewBridgeMessage,
} from "./bridge";

export interface SelectedElement {
  description: string;
  selector: string;
  tagName: string;
  text: string;
  filename: string;
  astroSourceFile?: string | null;
  astroSourceLoc?: string | null;
}

interface UsePreviewBridgeMessagesOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  fullUrl: string;
  beginIframeNavigationLoading: () => void;
  endIframeLoading: () => void;
  handlePreviewLocationChange: (href: string) => void;
  setChatOpen: (open: boolean) => void;
}

export function usePreviewBridgeMessages({
  iframeRef,
  fullUrl,
  beginIframeNavigationLoading,
  endIframeLoading,
  handlePreviewLocationChange,
  setChatOpen,
}: UsePreviewBridgeMessagesOptions) {
  const [selectorMode, setSelectorModeState] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);

  const setSelectorMode = useCallback(
    (mode: boolean) => {
      setSelectorModeState(mode);
      if (!mode) {
        const iframe = iframeRef.current;
        const targetOrigin = getPreviewBridgeOrigin(fullUrl) ?? window.location.origin;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(
            { type: "vivd-cleanup-selector" },
            targetOrigin,
          );
        }
      }
    },
    [fullUrl, iframeRef],
  );

  const clearSelectedElement = useCallback(() => {
    setSelectedElement(null);
  }, []);

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
    iframeRef,
    setChatOpen,
  ]);

  return {
    selectorMode,
    setSelectorMode,
    selectedElement,
    clearSelectedElement,
  };
}
