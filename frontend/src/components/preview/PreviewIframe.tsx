import { forwardRef, useEffect, type SyntheticEvent } from "react";
import { ELEMENT_SELECTOR_SCRIPT } from "../chat/ElementSelector";

interface PreviewIframeProps {
  src: string;
  refreshKey: number;
  className?: string;
  isMobile?: boolean;
  onLoad?: () => void;
  selectorMode?: boolean;
}

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
    const handleLoad = (e: SyntheticEvent<HTMLIFrameElement>) => {
      injectScrollbarStyles(e.currentTarget, isMobile);
      injectHighlightListener(e.currentTarget);
      onLoad?.();
    };

    // Inject selector script when selectorMode becomes active
    useEffect(() => {
      if (selectorMode && ref && typeof ref !== "function" && ref.current) {
        injectSelectorScript(ref.current);
      }
    }, [selectorMode, ref]);

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
