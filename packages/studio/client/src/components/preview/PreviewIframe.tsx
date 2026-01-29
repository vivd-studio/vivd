import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

interface PreviewIframeProps {
  src: string;
  refreshKey: number;
  className?: string;
  isMobile?: boolean;
  onLoad?: () => void;
}

const MAX_RETRY_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY_MS = 300;

const injectScrollbarStyles = (
  iframe: HTMLIFrameElement,
  isMobile: boolean
) => {
  try {
    const doc = iframe.contentDocument;
    if (doc) {
      const existing = doc.getElementById("vivd-scrollbar-styles");
      if (existing) existing.remove();

      const style = doc.createElement("style");
      style.id = "vivd-scrollbar-styles";
      style.textContent = isMobile
        ? `
          ::-webkit-scrollbar {
            display: none;
          }
          body {
            -ms-overflow-style: none;
            scrollbar-width: none;
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
    const retryCountRef = useRef(0);
    const lastRefreshKeyRef = useRef(refreshKey);
    const [internalRefreshKey, setInternalRefreshKey] = useState(0);

    useEffect(() => {
      if (refreshKey !== lastRefreshKeyRef.current) {
        retryCountRef.current = 0;
        lastRefreshKeyRef.current = refreshKey;
        setInternalRefreshKey(0);
      }
    }, [refreshKey]);

    const cacheBustedSrc = src
      ? `${src}${src.includes("?") ? "&" : "?"}_vivd=${refreshKey}_${internalRefreshKey}`
      : src;

    const handleLoad = (e: SyntheticEvent<HTMLIFrameElement>) => {
      const iframe = e.currentTarget;

      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const bodyText = doc.body?.textContent?.trim() || "";
          if (
            bodyText.includes('"error"') &&
            (bodyText.includes("Dev server proxy error") ||
              bodyText.includes("Dev server is starting"))
          ) {
            if (retryCountRef.current < MAX_RETRY_ATTEMPTS) {
              retryCountRef.current++;
              const delay =
                INITIAL_RETRY_DELAY_MS *
                Math.pow(2, retryCountRef.current - 1);
              setTimeout(() => {
                setInternalRefreshKey((prev) => prev + 1);
              }, delay);
              return;
            }
          }
        }
      } catch {
        // Cross-origin iframe
      }

      retryCountRef.current = 0;
      injectScrollbarStyles(iframe, isMobile);
      onLoad?.();
    };

    return (
      <iframe
        key={`${refreshKey}_${internalRefreshKey}`}
        ref={ref}
        src={cacheBustedSrc}
        className={`w-full h-full border-0 ${className}`}
        title="Preview"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
        onLoad={handleLoad}
      />
    );
  }
);
