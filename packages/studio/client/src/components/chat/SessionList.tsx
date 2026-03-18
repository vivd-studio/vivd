import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock3, Plus, X } from "lucide-react";

interface SessionListProps {
  sessions: {
    id: string;
    title?: string;
    time?: { created?: number; updated?: number };
  }[];
  sessionsLoading?: boolean;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
  onNewSession: () => void;
}

function SessionSkeleton() {
  return (
    <div className="h-16 rounded-xl bg-muted/70 animate-pulse" />
  );
}

function formatSessionTime(timestamp?: number): string {
  if (!timestamp) return "Just now";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SessionList({
  sessions,
  sessionsLoading,
  selectedSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
}: SessionListProps) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Latest Sessions
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-lg px-2 text-xs"
          onClick={onNewSession}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Session</span>
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 pr-2">
          {sessionsLoading && sessions.length === 0 ? (
            <>
              <SessionSkeleton />
              <SessionSkeleton />
              <SessionSkeleton />
            </>
          ) : null}
          {sessions.map((session) => {
            const title = session.title?.trim();
            const label =
              title && title.length > 0
                ? title
                : `${session.id.slice(0, 8)}...`;
            const tooltip = title ? `${title} (${session.id})` : session.id;
            const deleteLabel = title && title.length > 0 ? title : session.id;
            const active = selectedSessionId === session.id;

            return (
              <div key={session.id} className="group relative">
                <button
                  type="button"
                  title={tooltip}
                  onClick={() => onSelectSession(session.id)}
                  className={`flex w-full flex-col rounded-xl border px-3 py-3 text-left transition-colors ${
                    active
                      ? "border-primary/25 bg-primary/8 shadow-sm"
                      : "border-border/60 bg-background/80 hover:bg-muted/40"
                  }`}
                >
                  <span className="truncate text-sm font-medium text-foreground">
                    {label}
                  </span>
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock3 className="h-3 w-3" />
                    {formatSessionTime(session.time?.updated ?? session.time?.created)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => onDeleteSession(e, session.id)}
                  aria-label={`Delete session ${deleteLabel}`}
                  title={`Delete ${tooltip}`}
                  className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground opacity-100 transition-colors hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
