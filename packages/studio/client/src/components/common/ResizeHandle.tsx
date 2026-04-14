import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  side: "left" | "right";
  className?: string;
  ariaLabel?: string;
}

export function ResizeHandle({
  onMouseDown,
  side,
  className,
  ariaLabel,
}: ResizeHandleProps) {
  return (
    <div
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        "absolute top-0 bottom-0 w-1 cursor-col-resize z-30",
        "bg-transparent hover:bg-primary/20 active:bg-primary/40 transition-colors",
        "group",
        side === "left" ? "right-0" : "left-0",
        className
      )}
      onMouseDown={onMouseDown}
    >
      {/* Visual indicator on hover */}
      <div
        className={cn(
          "absolute top-1/2 -translate-y-1/2 w-1 h-12 rounded-full",
          "bg-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity",
          side === "left" ? "right-0" : "left-0"
        )}
      />
    </div>
  );
}
