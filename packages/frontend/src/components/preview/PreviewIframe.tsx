import { forwardRef, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { ELEMENT_SELECTOR_SCRIPT } from "../chat/ElementSelector";

interface PreviewIframeProps {
  src: string;
  refreshKey: number;
  className?: string;
  isMobile?: boolean;
  onLoad?: () => void;
  selectorMode?: boolean;
}

// Retry configuration for dev server proxy errors
const MAX_RETRY_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY_MS = 300;

// Scrollbar style injection for the iframe
const injectScrollbarStyles = (
  iframe: HTMLIFrameElement,
  isMobile: boolean
) => {
  try {
    const doc = iframe.contentDocument;
    if (doc) {
      // Remove existing scrollbar styles if present (avoid duplicates)
      const existing = doc.getElementById("vivd-scrollbar-styles");
      if (existing) existing.remove();

      const style = doc.createElement("style");
      style.id = "vivd-scrollbar-styles";
      style.textContent = isMobile
        ? `
          /* Hide scrollbar for Chrome, Safari and Opera */
          ::-webkit-scrollbar {
            display: none;
          }
          /* Hide scrollbar for IE, Edge and Firefox */
          body {
            -ms-overflow-style: none;  /* IE and Edge */
            scrollbar-width: none;  /* Firefox */
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

// Script to listen for highlight messages from parent
const HIGHLIGHT_LISTENER_SCRIPT = `
(function() {
  if (window.__vivdHighlightListener) return;
  window.__vivdHighlightListener = true;
  
  let highlightedElement = null;
  let originalOutline = null;
  
  function evaluateXPath(xpath) {
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return result.singleNodeValue;
    } catch (e) {
      console.warn('Failed to evaluate XPath:', xpath, e);
      return null;
    }
  }
  
  function highlightElement(el) {
    if (!el) return;
    if (highlightedElement) {
      unhighlightElement();
    }
    highlightedElement = el;
    originalOutline = el.style.outline;
    el.style.outline = '3px solid #f59e0b';
    el.style.outlineOffset = '2px';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  function unhighlightElement() {
    if (highlightedElement) {
      highlightedElement.style.outline = originalOutline || '';
      highlightedElement.style.outlineOffset = '';
      highlightedElement = null;
      originalOutline = null;
    }
  }
  
  window.addEventListener('message', function(e) {
    if (e.data?.type === 'vivd-highlight-element' && e.data.xpath) {
      const el = evaluateXPath(e.data.xpath);
      if (el) highlightElement(el);
    } else if (e.data?.type === 'vivd-unhighlight-element') {
      unhighlightElement();
    }
  });
})();
`;

// Inject highlight listener script into iframe
const injectHighlightListener = (iframe: HTMLIFrameElement) => {
  try {
    const doc = iframe.contentDocument;
    if (doc && !doc.getElementById("vivd-highlight-script")) {
      const script = doc.createElement("script");
      script.id = "vivd-highlight-script";
      script.textContent = HIGHLIGHT_LISTENER_SCRIPT;
      doc.body.appendChild(script);
    }
  } catch (err) {
    console.warn("Could not inject highlight script into iframe", err);
  }
};

// Inject element selector script into iframe
const injectSelectorScript = (iframe: HTMLIFrameElement) => {
  try {
    const doc = iframe.contentDocument;
    if (doc) {
      const script = doc.createElement("script");
      script.id = "vivd-selector-script";
      script.textContent = ELEMENT_SELECTOR_SCRIPT;
      doc.body.appendChild(script);
    }
  } catch (err) {
    console.warn("Could not inject selector script into iframe", err);
  }
};

export const PreviewIframe = forwardRef<HTMLIFrameElement, PreviewIframeProps>(
  function PreviewIframe(
    {
      src,
      refreshKey,
      className = "",
      isMobile = false,
      onLoad,
      selectorMode = false,
    },
    ref
  ) {
    // Track retry attempts - resets when refreshKey changes (intentional refresh)
    const retryCountRef = useRef(0);
    const lastRefreshKeyRef = useRef(refreshKey);
    const [internalRefreshKey, setInternalRefreshKey] = useState(0);

    // Reset retry count when refreshKey changes (user-initiated refresh)
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

      // Check if the iframe loaded with a proxy error
      // This happens when switching commits or restoring changes while dev server rebuilds
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const bodyText = doc.body?.textContent?.trim() || "";
          // Check for the specific proxy error JSON response
          if (
            bodyText.includes('"error"') &&
            (bodyText.includes("Dev server proxy error") ||
              bodyText.includes("Dev server is starting"))
          ) {
            // Only retry if we haven't exceeded max attempts
            if (retryCountRef.current < MAX_RETRY_ATTEMPTS) {
              retryCountRef.current++;
              // Exponential backoff: 300ms, 600ms, 1200ms, 2400ms, 4800ms
              const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCountRef.current - 1);
              setTimeout(() => {
                setInternalRefreshKey((prev) => prev + 1);
              }, delay);
              // Don't call onLoad yet - we're retrying
              return;
            }
            // Max retries exceeded - let the error show
          }
        }
      } catch {
        // Cross-origin iframe or other access error - ignore and proceed normally
      }

      // Reset retry count on successful load
      retryCountRef.current = 0;

      // Some previewed sites ship strict CSP which blocks inline script/style injection.
      // Only inject editor helpers when we actually need them (selector mode).
      if (selectorMode) {
        injectScrollbarStyles(iframe, isMobile);
        injectHighlightListener(iframe);
      }
      onLoad?.();
    };

    // Inject selector script when selectorMode becomes active
    useEffect(() => {
      if (!selectorMode) return;
      if (ref && typeof ref !== "function" && ref.current) {
        injectScrollbarStyles(ref.current, isMobile);
        injectHighlightListener(ref.current);
        injectSelectorScript(ref.current);
      }
    }, [selectorMode, ref, isMobile]);

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
