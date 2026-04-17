import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NewsletterSubscribers } from "./types";
import { formatDate } from "./utils";

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Subscribers</CardTitle>
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
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label>Status</Label>
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
          </div>
          <div className="space-y-2">
            <Label>Search</Label>
            <Input
              value={search}
              placeholder="Search email or name"
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Subscriber</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Updated</th>
                <th className="px-3 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subscribers?.rows.length ? (
                subscribers.rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium">{row.email}</div>
                      {row.name ? (
                        <div className="text-xs text-muted-foreground">{row.name}</div>
                      ) : null}
                      {row.utmSource || row.utmCampaign ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {row.utmSource || "direct"}
                          {row.utmCampaign ? ` / ${row.utmCampaign}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Badge variant="secondary">{row.status}</Badge>
                    </td>
                    <td className="px-3 py-3 align-top text-muted-foreground">
                      <div>{row.sourceHost || "n/a"}</div>
                      {row.sourcePath ? (
                        <div className="text-xs">{row.sourcePath}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-top text-muted-foreground">
                      {formatDate(row.updatedAt)}
                    </td>
                    <td className="px-3 py-3 align-top">
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
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-10 text-center text-sm text-muted-foreground"
                  >
                    {isLoading ? "Loading subscribers..." : "No subscribers found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {subscribers?.total ?? 0} rows total, page {currentPage} of {pageCount}
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
      </CardContent>
    </Card>
  );
}
