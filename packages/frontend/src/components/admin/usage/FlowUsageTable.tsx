import { LoadingSpinner } from "@/components/common";
import { trpc } from "@/lib/trpc";
import { formatDollarsAsCredits } from "@vivd/shared";

interface FlowUsageTableProps {
  days: number;
}

const FLOW_LABELS: Record<string, string> = {
  scratch: "Scratch Flow",
  url: "URL Flow",
  image_edit: "AI Image Edit",
  image_create: "AI Image Create",
  bg_remove: "Background Removal",
  hero_gen: "Hero Generation",
};

export function FlowUsageTable({ days }: FlowUsageTableProps) {
  const { data: flows, isLoading } = trpc.usage.flows.useQuery({ days });

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

  const getFlowLabel = (flowId: string) => FLOW_LABELS[flowId] || flowId;

  if (isLoading) {
    return (
      <div className="rounded-lg border p-8 flex justify-center">
        <LoadingSpinner message="Loading flows..." />
      </div>
    );
  }

  if (!flows || flows.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground text-sm">
        No flow usage recorded yet.
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
              Flow
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Credits
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Project
            </th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">
              Calls
            </th>
          </tr>
        </thead>
        <tbody>
          {flows.map((flow, idx) => (
            <tr key={`${flow.flowId}-${flow.projectSlug}-${idx}`} className="border-t">
              <td className="px-4 py-2 text-muted-foreground">
                {formatDate(flow.lastActive)}
              </td>
              <td className="px-4 py-2">
                <span className="font-medium">{getFlowLabel(flow.flowId)}</span>
              </td>
              <td className="px-4 py-2 font-mono font-medium">
                {formatDollarsAsCredits(flow.totalCost)}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {flow.projectSlug || "—"}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {flow.eventCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
