import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  NewsletterCampaignAudience,
  NewsletterCampaignRecord,
  NewsletterCampaigns,
} from "./types";
import { formatDate, formatDateTime, getCampaignAudienceLabel } from "./utils";

export function NewsletterCampaignsCard(props: {
  campaigns: NewsletterCampaigns;
  mode: "newsletter" | "waitlist";
  currentCampaignPage: number;
  campaignPageCount: number;
  campaignOffset: number;
  campaignLimit: number;
  selectedCampaignId: string | null;
  selectedCampaign: NewsletterCampaignRecord | null;
  editingNewCampaign: boolean;
  campaignIsEditable: boolean;
  campaignHasUnsavedEdits: boolean;
  currentCampaignRecipientEstimate: number;
  campaignSubject: string;
  campaignBody: string;
  campaignAudience: NewsletterCampaignAudience;
  testSendEmail: string;
  isPending: boolean;
  onNewDraft: () => void;
  onOpenCampaign: (campaignId: string) => void;
  onGoToPage: (offset: number) => void;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onAudienceChange: (value: NewsletterCampaignAudience) => void;
  onSaveDraft: () => void;
  onDeleteDraft: () => void;
  onTestSendEmailChange: (value: string) => void;
  onSendTest: () => void;
  onQueueSend: () => void;
  onCancelSend: () => void;
}) {
  const {
    campaigns,
    mode,
    currentCampaignPage,
    campaignPageCount,
    campaignOffset,
    campaignLimit,
    selectedCampaignId,
    selectedCampaign,
    editingNewCampaign,
    campaignIsEditable,
    campaignHasUnsavedEdits,
    currentCampaignRecipientEstimate,
    campaignSubject,
    campaignBody,
    campaignAudience,
    testSendEmail,
    isPending,
    onNewDraft,
    onOpenCampaign,
    onGoToPage,
    onSubjectChange,
    onBodyChange,
    onAudienceChange,
    onSaveDraft,
    onDeleteDraft,
    onTestSendEmailChange,
    onSendTest,
    onQueueSend,
    onCancelSend,
  } = props;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Campaigns</CardTitle>
          <p className="text-sm text-muted-foreground">
            Prepare broadcast drafts for confirmed subscribers.
          </p>
        </div>
        <Button variant="outline" onClick={onNewDraft}>
          New draft
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Drafts can now be test-sent and queued for background delivery. Start with
          a test send before queueing a live broadcast.
        </p>
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Campaigns</p>
              <Badge variant="secondary">{campaigns?.total ?? 0}</Badge>
            </div>
            {campaigns?.rows.length ? (
              <div className="space-y-2">
                {campaigns.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      row.id === selectedCampaignId && !editingNewCampaign
                        ? "border-primary bg-muted/40"
                        : "hover:bg-muted/30"
                    }`}
                    onClick={() => onOpenCampaign(row.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-medium">{row.subject}</p>
                      <Badge variant="outline">{row.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {getCampaignAudienceLabel(row.audience, row.mode)}
                      {` • ${row.recipientCount || row.estimatedRecipientCount} recipients`}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.deliveryCounts.sent} sent • {row.deliveryCounts.failed} failed •{" "}
                      {row.deliveryCounts.skipped} skipped • {row.deliveryCounts.queued} queued
                    </p>
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {row.body}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No campaigns yet.
              </div>
            )}
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {campaigns?.total ?? 0} campaigns total, page {currentCampaignPage} of{" "}
                {campaignPageCount}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onGoToPage(Math.max(0, campaignOffset - campaignLimit))}
                  disabled={campaignOffset === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onGoToPage(campaignOffset + campaignLimit)}
                  disabled={!campaigns || campaignOffset + campaignLimit >= campaigns.total}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            {selectedCampaign && !editingNewCampaign ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <Badge variant="outline">{selectedCampaign.status}</Badge>
                <span>
                  {selectedCampaign.recipientCount || selectedCampaign.estimatedRecipientCount}{" "}
                  recipients
                </span>
                <span>{selectedCampaign.deliveryCounts.sent} sent</span>
                <span>{selectedCampaign.deliveryCounts.failed} failed</span>
                <span>{selectedCampaign.deliveryCounts.skipped} skipped</span>
                {selectedCampaign.testSentAt ? (
                  <span>Last test {formatDateTime(selectedCampaign.testSentAt)}</span>
                ) : null}
                {selectedCampaign.completedAt ? (
                  <span>Completed {formatDateTime(selectedCampaign.completedAt)}</span>
                ) : selectedCampaign.queuedAt ? (
                  <span>Queued {formatDateTime(selectedCampaign.queuedAt)}</span>
                ) : null}
              </div>
            ) : null}
            {selectedCampaign && !editingNewCampaign && !campaignIsEditable ? (
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                This campaign is {selectedCampaign.status}. Create a new draft to make
                content edits.
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                  value={campaignSubject}
                  placeholder="April launch update"
                  disabled={!campaignIsEditable}
                  onChange={(event) => onSubjectChange(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Audience</Label>
                <Select
                  value={campaignAudience}
                  onValueChange={(value) =>
                    onAudienceChange(value as NewsletterCampaignAudience)
                  }
                >
                  <SelectTrigger disabled={!campaignIsEditable}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_confirmed">All confirmed</SelectItem>
                    <SelectItem value="mode_confirmed">
                      Confirmed ({campaigns?.currentMode ?? mode})
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Body</Label>
              <Textarea
                value={campaignBody}
                disabled={!campaignIsEditable}
                onChange={(event) => onBodyChange(event.target.value)}
                placeholder="Write the announcement you want to send to confirmed subscribers."
                rows={10}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {editingNewCampaign || !selectedCampaign
                    ? "New draft"
                    : campaignIsEditable
                      ? `Editing draft updated ${formatDate(selectedCampaign.updatedAt)}`
                      : `Viewing campaign updated ${formatDate(selectedCampaign.updatedAt)}`}
                </span>
                <span>
                  {currentCampaignRecipientEstimate} confirmed recipients currently
                  match this audience
                </span>
              </div>
            </div>

            {selectedCampaign?.lastError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Last delivery error: {selectedCampaign.lastError}
              </div>
            ) : null}
            {campaignHasUnsavedEdits ? (
              <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Save this draft before sending a test or queueing delivery so the
                saved campaign matches what will be sent.
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {campaignIsEditable ? (
                <Button
                  onClick={onSaveDraft}
                  disabled={isPending || !campaignSubject.trim() || !campaignBody.trim()}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving draft
                    </>
                  ) : selectedCampaignId && !editingNewCampaign ? (
                    "Save draft"
                  ) : (
                    "Create draft"
                  )}
                </Button>
              ) : null}
              {selectedCampaignId && !editingNewCampaign && campaignIsEditable ? (
                <Button variant="outline" disabled={isPending} onClick={onDeleteDraft}>
                  Delete draft
                </Button>
              ) : null}
            </div>

            <div className="grid gap-3 rounded-lg border border-dashed p-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <div className="space-y-2">
                <Label>Test send email</Label>
                <Input
                  value={testSendEmail}
                  placeholder="you@example.com"
                  onChange={(event) => onTestSendEmailChange(event.target.value)}
                />
              </div>
              <Button
                variant="outline"
                className="self-end"
                disabled={
                  isPending ||
                  !selectedCampaignId ||
                  !testSendEmail.trim() ||
                  campaignHasUnsavedEdits
                }
                onClick={onSendTest}
              >
                Send test
              </Button>
              {selectedCampaign?.status === "draft" && !editingNewCampaign ? (
                <Button
                  className="self-end"
                  disabled={isPending || campaignHasUnsavedEdits}
                  onClick={onQueueSend}
                >
                  Queue send
                </Button>
              ) : selectedCampaign &&
                (selectedCampaign.status === "queued" ||
                  selectedCampaign.status === "sending") ? (
                <Button
                  variant="outline"
                  className="self-end"
                  disabled={isPending}
                  onClick={onCancelSend}
                >
                  Cancel send
                </Button>
              ) : (
                <div className="self-end text-xs text-muted-foreground">
                  Save a draft to send it.
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
