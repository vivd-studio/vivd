import { RefreshCw } from "lucide-react";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vivd/ui";
import type { NewsletterSubscribers } from "./types";
import { formatDate } from "./utils";

function getSubscriberStatusTone(status: string) {
  switch (status) {
    case "confirmed":
      return "success" as const;
    case "pending":
      return "warn" as const;
    case "bounced":
    case "complained":
      return "danger" as const;
    case "unsubscribed":
    default:
      return "neutral" as const;
  }
}

export function NewsletterSubscribersCard(props: {
  projectSlug: string;
  subscribers: NewsletterSubscribers;
  isLoading: boolean;
  subscriberStatus:
    | "all"
    | "pending"
    | "confirmed"
    | "unsubscribed"
    | "bounced"
    | "complained";
  search: string;
  offset: number;
  limit: number;
  currentPage: number;
  pageCount: number;
  actionPending: boolean;
  onStatusChange: (
    value:
      | "all"
      | "pending"
      | "confirmed"
      | "unsubscribed"
      | "bounced"
      | "complained",
  ) => void;
  onSearchChange: (value: string) => void;
  onExport: () => void;
  onRefresh: () => void;
  onOffsetChange: (value: number) => void;
  onResend: (email: string) => void;
  onMarkConfirmed: (email: string) => void;
  onStartUnsubscribe: (email: string) => void;
}) {
  const {
    subscribers,
    isLoading,
    subscriberStatus,
    search,
    offset,
    limit,
    currentPage,
    pageCount,
    actionPending,
    onStatusChange,
    onSearchChange,
    onExport,
    onRefresh,
    onOffsetChange,
    onResend,
    onMarkConfirmed,
    onStartUnsubscribe,
  } = props;

  return (
    <Panel>
      <PanelHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <PanelTitle>Subscribers</PanelTitle>
          <p className="text-sm text-muted-foreground">
            Search, review, and export the current audience list.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onExport}>
            Export current rows
          </Button>
          <Button variant="outline" size="icon" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </PanelHeader>
      <PanelContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <Field>
            <FieldLabel>Status</FieldLabel>
            <Select
              value={subscriberStatus}
              onValueChange={(value) =>
                onStatusChange(
                  value as
                    | "all"
                    | "pending"
                    | "confirmed"
                    | "unsubscribed"
                    | "bounced"
                    | "complained",
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                <SelectItem value="bounced">Bounced</SelectItem>
                <SelectItem value="complained">Complained</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Search</FieldLabel>
            <Input
              value={search}
              placeholder="Search email or name"
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </Field>
        </div>

        <Panel tone="sunken" className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subscriber</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscribers?.rows.length ? (
                subscribers.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="align-top">
                      <div className="font-medium">{row.email}</div>
                      {row.name ? (
                        <div className="text-xs text-muted-foreground">
                          {row.name}
                        </div>
                      ) : null}
                      {row.utmSource || row.utmCampaign ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {row.utmSource || "direct"}
                          {row.utmCampaign ? ` / ${row.utmCampaign}` : ""}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusPill tone={getSubscriberStatusTone(row.status)}>
                        {row.status}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      <div>{row.sourceHost || "n/a"}</div>
                      {row.sourcePath ? (
                        <div className="text-xs">{row.sourcePath}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {formatDate(row.updatedAt)}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap gap-2">
                        {row.status === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionPending}
                              onClick={() => onResend(row.email)}
                            >
                              Resend
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionPending}
                              onClick={() => onMarkConfirmed(row.email)}
                            >
                              Confirm
                            </Button>
                          </>
                        ) : null}
                        {row.status !== "unsubscribed" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionPending}
                            onClick={() => onStartUnsubscribe(row.email)}
                          >
                            Unsubscribe
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {isLoading
                      ? "Loading subscribers..."
                      : "No subscribers found."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Panel>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {subscribers?.total ?? 0} rows total, page {currentPage} of{" "}
            {pageCount}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOffsetChange(Math.max(0, offset - limit))}
              disabled={offset === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOffsetChange(offset + limit)}
              disabled={!subscribers || offset + limit >= subscribers.total}
            >
              Next
            </Button>
          </div>
        </div>
      </PanelContent>
    </Panel>
  );
}
