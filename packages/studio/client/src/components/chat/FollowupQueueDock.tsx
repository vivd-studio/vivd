import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";

type FollowupQueueDockProps = {
  items: { id: string; preview: string }[];
  sendingId: string | null;
  onSend: (id: string) => void;
  onEdit: (id: string) => void;
};

export function FollowupQueueDock({
  items,
  sendingId,
  onSend,
  onEdit,
}: FollowupQueueDockProps) {
  const [collapsed, setCollapsed] = useState(false);

  const summary = useMemo(() => {
    if (items.length === 1) {
      return "1 queued message";
    }
    return `${items.length} queued messages`;
  }, [items.length]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-border/60 bg-muted/30 px-3 pb-2 pt-2 md:px-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-xl border border-border/70 bg-background/90 shadow-sm">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
          >
            <div>
              <p className="text-sm font-medium text-foreground">Queued Follow-ups</p>
              <p className="text-xs text-muted-foreground">{summary}</p>
            </div>
            {collapsed ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {!collapsed ? (
            <div className="space-y-2 border-t border-border/60 px-3 py-2">
              {items.map((item) => {
                const isSending = sendingId === item.id;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2",
                      isSending ? "border-primary/40 bg-primary/5" : "border-border/60",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {item.preview}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={isSending}
                        onClick={() => onSend(item.id)}
                      >
                        {isSending ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          "Send now"
                        )}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isSending}
                        onClick={() => onEdit(item.id)}
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
