import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StudioRecoveryOverlayProps {
  className?: string;
  title?: string;
  description?: string;
}

export function StudioRecoveryOverlay({
  className,
  title = "Reconnecting studio",
  description = "Your studio was idle for a while and is waking up again.",
}: StudioRecoveryOverlayProps) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-20 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={title}
      data-testid="studio-recovery-overlay"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg border bg-background/95 px-6 py-5 text-center shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <div className="space-y-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
    </div>
  );
}
