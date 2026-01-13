import { MousePointerClick, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ElementSelectorProps {
  isActive: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function ElementSelector({
  isActive,
  onToggle,
  disabled = false,
}: ElementSelectorProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isActive ? "default" : "ghost"}
            size="icon"
            onClick={onToggle}
            disabled={disabled}
            className={
              isActive
                ? "bg-amber-500 hover:bg-amber-600 text-white h-10 w-10"
                : "h-10 w-10 text-muted-foreground hover:text-foreground"
            }
          >
            {isActive ? (
              <X className="w-4 h-4" />
            ) : (
              <MousePointerClick className="w-4 h-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {isActive ? "Cancel selection" : "Select element in preview"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Script to inject into iframe for element selection
export const ELEMENT_SELECTOR_SCRIPT = `
(function() {
  if (window.__vivdSelectorActive) return;
  window.__vivdSelectorActive = true;

  let hoveredElement = null;
  const originalStyles = new Map();

  function getElementDescription(el) {
    const tag = el.tagName.toLowerCase();
    const text = el.textContent?.trim().slice(0, 50) || '';
    const id = el.id ? '#' + el.id : '';
    const classes = el.className && typeof el.className === 'string' 
      ? '.' + el.className.split(' ').filter(c => c).slice(0, 2).join('.') 
      : '';
    
    // Build a human-readable description
    if (text) {
      const truncated = text.length > 40 ? text.slice(0, 40) + '...' : text;
      return truncated;
    }
    return tag + id + classes || tag;
  }

  function getXPath(el) {
    // Build XPath for the element
    if (el.id) {
      return '//*[@id="' + el.id + '"]';
    }
    
    const parts = [];
    let current = el;
    
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      
      // Find position among siblings of same type
      let sibling = current;
      let position = 1;
      while (sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling;
        if (sibling.tagName === current.tagName) {
          position++;
        }
      }
      
      // Check if we need position (multiple siblings of same type)
      let hasSameTypeSiblings = false;
      sibling = current.parentElement?.firstElementChild;
      let count = 0;
      while (sibling) {
        if (sibling.tagName === current.tagName) count++;
        sibling = sibling.nextElementSibling;
      }
      if (count > 1) {
        selector += '[' + position + ']';
      }
      
      parts.unshift(selector);
      current = current.parentElement;
    }
    
    return '/' + parts.join('/');
  }

  function highlightElement(el) {
    if (!el || el === hoveredElement) return;
    
    if (hoveredElement) {
      unhighlightElement(hoveredElement);
    }
    
    hoveredElement = el;
    originalStyles.set(el, {
      outline: el.style.outline,
      outlineOffset: el.style.outlineOffset,
      cursor: el.style.cursor,
    });
    
    el.style.outline = '2px solid #f59e0b';
    el.style.outlineOffset = '2px';
    el.style.cursor = 'crosshair';
  }

  function unhighlightElement(el) {
    if (!el) return;
    const original = originalStyles.get(el);
    if (original) {
      el.style.outline = original.outline;
      el.style.outlineOffset = original.outlineOffset;
      el.style.cursor = original.cursor;
      originalStyles.delete(el);
    }
  }

  function handleMouseOver(e) {
    e.stopPropagation();
    highlightElement(e.target);
  }

  function handleMouseOut(e) {
    e.stopPropagation();
    unhighlightElement(e.target);
    hoveredElement = null;
  }

  function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const el = e.target;
    const description = getElementDescription(el);
    const xpath = getXPath(el);
    
    // Get current page filename from iframe's location
    const pathname = window.location.pathname;
    const filename = pathname.split('/').pop() || 'index.html';
    
    // Check for Astro source info (available in Astro dev server)
    // Walk up to find the nearest element with data-astro-source-file
    const astroSourceEl = el.closest('[data-astro-source-file]');
    const astroSourceFile = astroSourceEl?.getAttribute('data-astro-source-file') || null;
    const astroSourceLoc = astroSourceEl?.getAttribute('data-astro-source-loc') || null;
    
    // For Astro, extract relative path from absolute path
    let sourceFile = null;
    if (astroSourceFile) {
      const srcMatch = astroSourceFile.match(/\\/(src\\/.*\\.astro)$/i);
      sourceFile = srcMatch ? srcMatch[1] : astroSourceFile;
    }
    
    window.parent.postMessage({
      type: 'vivd-element-selected',
      data: {
        description,
        selector: xpath,
        tagName: el.tagName.toLowerCase(),
        text: el.textContent?.trim().slice(0, 100) || '',
        filename,
        // Astro source info (if available)
        astroSourceFile: sourceFile,
        astroSourceLoc,
      }
    }, '*');
    
    cleanup();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      window.parent.postMessage({ type: 'vivd-selector-cancelled' }, '*');
      cleanup();
    }
  }

  function cleanup() {
    if (hoveredElement) {
      unhighlightElement(hoveredElement);
    }
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.body.style.cursor = '';
    window.__vivdSelectorActive = false;
  }

  // Listen for cleanup message from parent
  window.addEventListener('message', function handler(e) {
    if (e.data?.type === 'vivd-cleanup-selector') {
      cleanup();
      window.removeEventListener('message', handler);
    }
  });

  document.addEventListener('mouseover', handleMouseOver, true);
  document.addEventListener('mouseout', handleMouseOut, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.body.style.cursor = 'crosshair';
})();
`;
