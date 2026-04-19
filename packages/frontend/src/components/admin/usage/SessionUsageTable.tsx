import { LoadingSpinner } from "@/components/common";
import { trpc } from "@/lib/trpc";
import { formatDollarsAsCredits } from "@vivd/shared";
import {
  Panel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vivd/ui";

interface SessionUsageTableProps {
  days: number;
}

export function SessionUsageTable({ days }: SessionUsageTableProps) {
  const { data: sessions, isLoading } = trpc.usage.sessions.useQuery({ days });

  const formatDate = (date: unknown) => {
    if (!date) return "—";
    try {
      const d = date instanceof Date ? date : new Date(date as string | number);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "—";
    }
  };

  if (isLoading) {
    return (
      <Panel tone="sunken" className="flex justify-center p-8">
        <LoadingSpinner message="Loading sessions..." />
      </Panel>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <Panel
        tone="sunken"
        className="p-8 text-center text-sm text-muted-foreground"
      >
        No session usage recorded yet.
      </Panel>
    );
  }

  return (
    <Panel tone="sunken" className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Last Active</TableHead>
            <TableHead>Session</TableHead>
            <TableHead>Credits</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Events</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.sessionId}>
              <TableCell className="text-muted-foreground">
                {formatDate(session.lastActive)}
              </TableCell>
              <TableCell>
                {session.sessionTitle ? (
                  <div className="flex flex-col">
                    <span
                      className="font-medium truncate max-w-48"
                      title={session.sessionTitle}
                    >
                      {session.sessionTitle}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {session.sessionId?.slice(0, 8)}...
                    </span>
                  </div>
                ) : (
                  <span className="font-mono text-xs">
                    {session.sessionId?.slice(0, 8)}...
                  </span>
                )}
              </TableCell>
              <TableCell className="font-mono font-medium">
                {formatDollarsAsCredits(session.totalCost)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {session.projectSlug || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {session.eventCount}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
