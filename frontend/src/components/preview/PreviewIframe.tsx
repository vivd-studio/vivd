import { forwardRef, type SyntheticEvent } from "react";

interface PreviewIframeProps {
  src: string;
  refreshKey: number;
  className?: string;
  isMobile?: boolean;
  onLoad?: () => void;
}

// Scrollbar style injection for the iframe
const injectScrollbarStyles = (
  iframe: HTMLIFrameElement,
  isMobile: boolean
) => {
  try {
    const doc = iframe.contentDocument;
    if (doc) {
      const style = doc.createElement("style");
      style.textContent = isMobile
        ? `
          ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          ::-webkit-scrollbar-track {
            background: transparent;
          }
          ::-webkit-scrollbar-thumb {
            background-color: rgba(156, 163, 175, 0.5);
            border-radius: 4px;
          }
          ::-webkit-scrollbar-thumb:hover {
            background-color: rgba(156, 163, 175, 0.8);
          }
        `
        : `
          ::-webkit-scrollbar {
            width: 14px;
            height: 14px;
          }
          ::-webkit-scrollbar-track {
            background: transparent;
          }
          ::-webkit-scrollbar-thumb {
            background-color: rgba(156, 163, 175, 0.5);
            border-radius: 5px;
            border: 2px solid transparent;
            background-clip: content-box;
          }
          ::-webkit-scrollbar-thumb:hover {
            background-color: rgba(156, 163, 175, 0.8);
          }
        `;
      doc.head.appendChild(style);
    }
  } catch (err) {
    console.warn("Could not inject styles into iframe", err);
  }
};

export const PreviewIframe = forwardRef<HTMLIFrameElement, PreviewIframeProps>(
  function PreviewIframe(
    { src, refreshKey, className = "", isMobile = false, onLoad },
    ref
  ) {
    const handleLoad = (e: SyntheticEvent<HTMLIFrameElement>) => {
      injectScrollbarStyles(e.currentTarget, isMobile);
      onLoad?.();
    };

    return (
      <iframe
        key={refreshKey}
        ref={ref}
        src={src}
        className={`w-full h-full border-0 ${className}`}
        title="Preview"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        onLoad={handleLoad}
      />
    );
  }
);
