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
      <Panel tone="sunken" className="flex justify-center p-8">
        <LoadingSpinner message="Loading flows..." />
      </Panel>
    );
  }

  if (!flows || flows.length === 0) {
    return (
      <Panel
        tone="sunken"
        className="p-8 text-center text-sm text-muted-foreground"
      >
        No flow usage recorded yet.
      </Panel>
    );
  }

  return (
    <Panel tone="sunken" className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Last Active</TableHead>
            <TableHead>Flow</TableHead>
            <TableHead>Credits</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Calls</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flows.map((flow, idx) => (
            <TableRow key={`${flow.flowId}-${flow.projectSlug}-${idx}`}>
              <TableCell className="text-muted-foreground">
                {formatDate(flow.lastActive)}
              </TableCell>
              <TableCell>
                <span className="font-medium">{getFlowLabel(flow.flowId)}</span>
              </TableCell>
              <TableCell className="font-mono font-medium">
                {formatDollarsAsCredits(flow.totalCost)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {flow.projectSlug || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {flow.eventCount}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
