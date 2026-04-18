import { Button } from "@vivd/ui";

import { AlertCircle, AlertTriangle, Loader2, X } from "lucide-react";
import type { SessionErrorNoticeContent } from "../sessionErrorNotice";

export function SessionStatusNotice({
  notice,
  onDismiss,
}: {
  notice: SessionErrorNoticeContent;
  onDismiss: () => void;
}) {
  const accentClass =
    notice.tone === "warning" ? "before:bg-amber-500/80" : "before:bg-destructive/80";
  const iconClass =
    notice.tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : "text-destructive";

  return (
    <div className="flex flex-col gap-1 w-full items-start chat-row-enter">
      <div
        className={`relative w-full max-w-lg overflow-hidden rounded-md border border-border/50 bg-muted/20 pl-4 pr-2 py-2 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full ${accentClass}`}
      >
        <div className="flex items-start gap-2">
          <div className={`mt-0.5 shrink-0 ${iconClass}`}>
            {notice.showSpinner ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : notice.tone === "warning" ? (
              <AlertCircle className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium leading-5 text-foreground break-words">
              {notice.title}
            </p>
            {notice.detail && (
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground break-words">
                {notice.detail}
              </p>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0 text-muted-foreground/70 hover:text-foreground"
            onClick={onDismiss}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
