import { useState, useCallback, useEffect, useRef } from "react";

interface UseResizablePanelOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  side: "left" | "right";
}

export function useResizablePanel({
  storageKey,
  defaultWidth,
  minWidth = 200,
  maxWidth = 600,
  side,
}: UseResizablePanelOptions) {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return defaultWidth;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
        return parsed;
      }
    }
    return defaultWidth;
  });

  const [isResizing, setIsResizing] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    localStorage.setItem(storageKey, width.toString());
  }, [storageKey, width]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      startX.current = e.clientX;
      startWidth.current = width;

      const iframes = document.querySelectorAll("iframe");
      iframes.forEach((iframe) => {
        iframe.style.pointerEvents = "none";
      });

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta =
        side === "left"
          ? e.clientX - startX.current
          : startX.current - e.clientX;

      const newWidth = Math.min(
        maxWidth,
        Math.max(minWidth, startWidth.current + delta)
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      const iframes = document.querySelectorAll("iframe");
      iframes.forEach((iframe) => {
        iframe.style.pointerEvents = "";
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, side, minWidth, maxWidth]);

  return {
    width,
    isResizing,
    handleMouseDown,
  };
}
