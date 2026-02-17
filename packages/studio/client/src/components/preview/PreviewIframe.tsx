import { forwardRef, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { ELEMENT_SELECTOR_SCRIPT } from "../chat/ElementSelector";

interface PreviewIframeProps {
  src: string;
  refreshKey: number;
  className?: string;
  isMobile?: boolean;
  onLoad?: () => void;
  onNavigateStart?: () => void;
  selectorMode?: boolean;
}

// Retry configuration for transient preview errors (cold start / dev server startup).
const MAX_RETRY_ATTEMPTS = 15;
const INITIAL_RETRY_DELAY_MS = 300;
const MAX_RETRY_DELAY_MS = 5000;

const parsePreviewErrorPayload = (
  bodyText: string,
): { error: string; status?: string } | null => {
  const trimmed = bodyText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const error = typeof parsed.error === "string" ? parsed.error.trim() : "";
    if (!error) return null;

    const status = typeof parsed.status === "string" ? parsed.status.trim() : undefined;
    return { error, status };
  } catch {
    return null;
  }
};

const shouldRetryForPreviewError = (payload: {
  error: string;
  status?: string;
}): boolean => {
  const status = payload.status?.toLowerCase();
  if (status === "starting" || status === "installing") return true;

  const message = payload.error.toLowerCase();
  return (
    message.includes("dev server proxy error") ||
    message.includes("dev server is starting") ||
    message.includes("dev server not running") ||
    message.includes("workspace not initialized")
  );
};

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

const inferVivdBasePathFromPathname = (pathname: string): string | undefined => {
  if (!pathname.startsWith("/")) return undefined;

  if (pathname.startsWith("/preview")) return "/preview";

  const studioMatch = pathname.match(
    /^(\/vivd-studio\/api\/(?:preview|devpreview)\/[^/]+\/v[^/]+)(?:\/|$)/,
  );
  if (studioMatch) return studioMatch[1];

  return undefined;
};

const getVivdBasePathForIframe = (
  iframe: HTMLIFrameElement,
): string | undefined => {
  try {
    const win = iframe.contentWindow as any;
    const fromInjected = win?.__vivdBasePath;
    if (typeof fromInjected === "string" && fromInjected.startsWith("/")) {
      return fromInjected;
    }

    const pathname = win?.location?.pathname;
    if (typeof pathname === "string") {
      return inferVivdBasePathFromPathname(pathname);
    }
  } catch {
    // Cross-origin iframe or blocked access.
  }

  return undefined;
};

const resolvePreviewHref = (
  iframe: HTMLIFrameElement,
  anchor: HTMLAnchorElement,
  hrefAttr: string,
): string | undefined => {
  const href = hrefAttr.trim();
  if (!href) return undefined;

  // Root-relative URLs need to be prefixed with the preview base path so they stay
  // inside `/preview` or `/vivd-studio/api/(preview|devpreview)/...`.
  if (href.startsWith("/")) {
    const basePath = getVivdBasePathForIframe(iframe);
    const base = basePath?.endsWith("/") ? basePath.slice(0, -1) : basePath;
    const prefixed =
      base && !(href === base || href.startsWith(`${base}/`)) ? `${base}${href}` : href;
    return new URL(prefixed, window.location.href).toString();
  }

  // For relative/absolute URLs, rely on the browser's resolution in the iframe.
  const resolved = anchor.href;
  if (typeof resolved === "string" && resolved.length > 0) return resolved;

  return undefined;
};

const triggerBrowserDownload = (url: string, downloadName?: string | null) => {
  const a = document.createElement("a");
  a.href = url;
  if (downloadName !== null && downloadName !== undefined) {
    a.download = downloadName || "";
  } else {
    a.download = "";
  }
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};

const openInNewTab = (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

const installPreviewNavigationStartListener = (
  iframe: HTMLIFrameElement,
  onNavigateStart?: () => void,
) => {
  if (!onNavigateStart) return;

  try {
    const win = iframe.contentWindow as any;
    const doc = iframe.contentDocument as any;
    if (!win || !doc) return;

    if (doc.__vivdPreviewNavigationStartListenerInstalled) return;
    doc.__vivdPreviewNavigationStartListenerInstalled = true;

    const defer =
      typeof queueMicrotask === "function"
        ? queueMicrotask
        : (fn: () => void) => void Promise.resolve().then(fn);

    const shouldTreatAsFullReloadNavigation = (
      anchor: HTMLAnchorElement,
      hrefAttr: string,
    ): boolean => {
      const href = hrefAttr.trim();
      if (!href) return false;

      const lowered = href.toLowerCase();
      if (
        lowered.startsWith("#") ||
        lowered.startsWith("mailto:") ||
        lowered.startsWith("tel:") ||
        lowered.startsWith("javascript:") ||
        lowered.startsWith("data:")
      ) {
        return false;
      }

      // Honor new-tab and named targets.
      const targetAttr = anchor.getAttribute("target");
      if (targetAttr && targetAttr !== "_self") return false;

      // Downloads/popups are handled elsewhere and shouldn't trigger preview loading UI.
      if (anchor.hasAttribute("download")) return false;

      const resolved = resolvePreviewHref(iframe, anchor, hrefAttr);
      if (!resolved) return false;

      // Ignore same-document navigations (hash-only).
      try {
        const currentHref = String(win.location?.href || "");
        if (currentHref) {
          const current = new URL(currentHref);
          const next = new URL(resolved, current);
          if (
            current.origin === next.origin &&
            current.pathname === next.pathname &&
            current.search === next.search
          ) {
            return false;
          }
        }
      } catch {
        // Best-effort only.
      }

      // If Vivd's base-path rewrite helper is active, root-relative links are
      // intentionally intercepted (defaultPrevented) and navigated via location.href.
      // Treat those as real navigations even when defaultPrevented is true.
      const basePath = getVivdBasePathForIframe(iframe);
      const base = basePath?.endsWith("/") ? basePath.slice(0, -1) : basePath;
      const isRootRelative =
        href.startsWith("/") &&
        !href.startsWith("//") &&
        !href.startsWith("http://") &&
        !href.startsWith("https://");
      const isAlreadyPrefixed =
        !!base && (href === base || href.startsWith(`${base}/`));

      if (isRootRelative && base && !isAlreadyPrefixed) {
        return true;
      }

      return true;
    };

    doc.addEventListener(
      "click",
      (event: MouseEvent) => {
        if (!event.isTrusted) return;
        // Element selector mode injects a click interceptor; if it's active we
        // should not treat clicks as navigations (prevents stuck "Loading preview...").
        if ((win as any).__vivdSelectorActive) return;
        if (event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const target: any = event.target;
        const element = target?.closest ? target : target?.parentElement;
        const anchor = element?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!anchor) return;

        const hrefAttr = anchor.getAttribute("href");
        if (!hrefAttr) return;

        // PDF links are opened outside the iframe to avoid the Chrome sandbox interstitial.
        if (/\.pdf(?:[?#&]|$)/i.test(hrefAttr)) return;

        if (!shouldTreatAsFullReloadNavigation(anchor, hrefAttr)) return;

        defer(() => {
          // If a client-side router prevented the default navigation, don't show a
          // loading overlay (it would never receive an iframe onLoad event).
          if (event.defaultPrevented) {
            const href = hrefAttr.trim();
            const basePath = getVivdBasePathForIframe(iframe);
            const base = basePath?.endsWith("/") ? basePath.slice(0, -1) : basePath;
            const isRootRelative =
              href.startsWith("/") &&
              !href.startsWith("//") &&
              !href.startsWith("http://") &&
              !href.startsWith("https://");
            const isAlreadyPrefixed =
              !!base && (href === base || href.startsWith(`${base}/`));
            const isVivdRewriteNavigation = isRootRelative && base && !isAlreadyPrefixed;
            if (!isVivdRewriteNavigation) return;
          }
          onNavigateStart();
        });
      },
      true,
    );

    doc.addEventListener(
      "submit",
      (event: Event) => {
        if (!event.isTrusted) return;
        if ((win as any).__vivdSelectorActive) return;

        defer(() => {
          if (event.defaultPrevented) return;
          onNavigateStart();
        });
      },
      true,
    );

    win.addEventListener("beforeunload", () => onNavigateStart());
    win.addEventListener("pagehide", () => onNavigateStart());
  } catch (err) {
    console.warn("Could not install preview navigation start listener", err);
  }
};

const installPreviewPdfDownloadInterceptor = (iframe: HTMLIFrameElement) => {
  try {
    const doc = iframe.contentDocument as any;
    if (!doc) return;

    if (doc.__vivdPreviewPdfDownloadInterceptorInstalled) return;
    doc.__vivdPreviewPdfDownloadInterceptorInstalled = true;

    doc.addEventListener(
      "click",
      (event: MouseEvent) => {
        // Only intercept real user clicks (avoid scripts abusing downloads/popups).
        if (!event.isTrusted) return;

        const target: any = event.target;
        const element = target?.closest ? target : target?.parentElement;
        const anchor = element?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!anchor) return;

        const hrefAttr = anchor.getAttribute("href");
        if (!hrefAttr) return;

        const url = resolvePreviewHref(iframe, anchor, hrefAttr);
        if (!url) return;

        const isDownloadLink = anchor.hasAttribute("download");
        const isPdf = (() => {
          const hrefLooksPdf = /\.pdf(?:[?#&]|$)/i.test(hrefAttr);
          try {
            const u = new URL(url);
            if (u.pathname.toLowerCase().endsWith(".pdf")) return true;
            for (const value of u.searchParams.values()) {
              if (value.toLowerCase().endsWith(".pdf")) return true;
            }
          } catch {
            // fall through
          }
          return hrefLooksPdf || /\.pdf(?:[?#&]|$)/i.test(url);
        })();

        if (!isDownloadLink && !isPdf) return;

        event.preventDefault();
        event.stopPropagation();

        if (isDownloadLink) {
          triggerBrowserDownload(url, anchor.getAttribute("download"));
          return;
        }

        openInNewTab(url);
      },
      true,
    );
  } catch (err) {
    console.warn("Could not install preview PDF download interceptor", err);
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
      onNavigateStart,
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
          const errorPayload = parsePreviewErrorPayload(bodyText);
          if (errorPayload && shouldRetryForPreviewError(errorPayload)) {
            // Only retry if we haven't exceeded max attempts
            if (retryCountRef.current < MAX_RETRY_ATTEMPTS) {
              retryCountRef.current++;
              // Exponential backoff with a cap: 300ms, 600ms, 1200ms, 2400ms, 4800ms, 5s, 5s...
              const delay = Math.min(
                INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCountRef.current - 1),
                MAX_RETRY_DELAY_MS,
              );
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

      installPreviewNavigationStartListener(iframe, onNavigateStart);
      installPreviewPdfDownloadInterceptor(iframe);

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
