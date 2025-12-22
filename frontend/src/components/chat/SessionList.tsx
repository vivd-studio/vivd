import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { X } from "lucide-react";

interface SessionListProps {
  sessions: { id: string; title?: string }[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
  onNewSession: () => void;
}

export function SessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
}: SessionListProps) {
  return (
    <div className="w-full">
      <ScrollArea className="w-full whitespace-nowrap rounded-md border">
        <div className="flex w-max space-x-2 p-2">
          <Button
            variant={selectedSessionId === null ? "secondary" : "ghost"}
            size="sm"
            className="text-xs h-7"
            onClick={onNewSession}
          >
            + New Session
          </Button>
          {sessions.map((session) => {
            const title = session.title?.trim();
            const label =
              title && title.length > 0
                ? title
                : `${session.id.slice(0, 8)}...`;
            const tooltip = title ? `${title} (${session.id})` : session.id;

            return (
              <div
                key={session.id}
                className="relative group flex items-center"
              >
                <Button
                  variant={
                    selectedSessionId === session.id ? "secondary" : "ghost"
                  }
                  size="sm"
                  className="text-xs h-7 pr-6 max-w-[150px] truncate justify-start text-left"
                  title={tooltip}
                  onClick={() => onSelectSession(session.id)}
                >
                  {label}
                </Button>
                <button
                  onClick={(e) => onDeleteSession(e, session.id)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 hover:bg-destructive/10 rounded-full transition-opacity"
                >
                  <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
