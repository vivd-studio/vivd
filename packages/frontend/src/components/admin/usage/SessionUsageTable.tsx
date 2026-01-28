import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface SessionUsageTableProps {
  days: number;
}

export function SessionUsageTable({ days }: SessionUsageTableProps) {
  const { data: sessions, isLoading } = trpc.usage.sessions.useQuery({ days });

  const formatDollarsAsCredits = (dollars: number) =>
    `${Math.round(dollars * 100)} ⬡`;

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
      <div className="rounded-lg border p-8 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground text-sm">
        No session usage recorded yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Last Active
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Session
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Credits
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Project
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Events
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.sessionId} className="border-t">
              <td className="px-4 py-2 text-muted-foreground">
                {formatDate(session.lastActive)}
              </td>
              <td className="px-4 py-2">
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
              </td>
              <td className="px-4 py-2 font-mono font-medium">
                {formatDollarsAsCredits(session.totalCost)}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {session.projectSlug || "—"}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {session.eventCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
