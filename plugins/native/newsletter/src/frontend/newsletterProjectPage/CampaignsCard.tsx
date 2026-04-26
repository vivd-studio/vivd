import { Loader2 } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  CalloutDescription,
  CalloutTitle,
  Field,
  FieldDescription,
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
  Textarea,
} from "@vivd/ui";
import type {
  NewsletterCampaignAudience,
  NewsletterCampaignRecord,
  NewsletterCampaigns,
} from "./types";
import { formatDate, formatDateTime, getCampaignAudienceLabel } from "./utils";

function getCampaignStatusTone(status: NewsletterCampaignRecord["status"]) {
  switch (status) {
    case "queued":
    case "sending":
      return "info" as const;
    case "sent":
      return "success" as const;
    case "failed":
      return "danger" as const;
    case "canceled":
      return "warn" as const;
    case "draft":
    default:
      return "neutral" as const;
  }
}

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
    <Panel>
      <PanelHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <PanelTitle>Campaigns</PanelTitle>
          <p className="text-sm text-muted-foreground">
            Prepare broadcast drafts for confirmed subscribers.
          </p>
        </div>
        <Button variant="outline" onClick={onNewDraft}>
          New draft
        </Button>
      </PanelHeader>
      <PanelContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Drafts can now be test-sent and queued for background delivery. Start
          with a test send before queueing a live broadcast.
        </p>
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <Panel tone="sunken" className="space-y-3 p-3">
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
                    className={`w-full rounded-md border bg-surface-panel p-3 text-left transition ${
                      row.id === selectedCampaignId && !editingNewCampaign
                        ? "border-primary/40 ring-1 ring-primary/15"
                        : "hover:border-border/90"
                    }`}
                    onClick={() => onOpenCampaign(row.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-medium">{row.subject}</p>
                      <StatusPill tone={getCampaignStatusTone(row.status)}>
                        {row.status}
                      </StatusPill>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {getCampaignAudienceLabel(row.audience, row.mode)}
                      {` • ${row.recipientCount || row.estimatedRecipientCount} recipients`}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.deliveryCounts.sent} sent •{" "}
                      {row.deliveryCounts.failed} failed •{" "}
                      {row.deliveryCounts.skipped} skipped •{" "}
                      {row.deliveryCounts.queued} queued
                    </p>
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {row.body}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <Panel
                tone="dashed"
                className="p-4 text-sm text-muted-foreground"
              >
                No campaigns yet.
              </Panel>
            )}
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {campaigns?.total ?? 0} campaigns total, page{" "}
                {currentCampaignPage} of {campaignPageCount}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onGoToPage(Math.max(0, campaignOffset - campaignLimit))
                  }
                  disabled={campaignOffset === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onGoToPage(campaignOffset + campaignLimit)}
                  disabled={
                    !campaigns ||
                    campaignOffset + campaignLimit >= campaigns.total
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </Panel>

          <Panel tone="sunken" className="space-y-4 p-4">
            {selectedCampaign && !editingNewCampaign ? (
              <Panel
                tone="default"
                className="flex flex-wrap items-center gap-2 rounded-md p-3 text-xs text-muted-foreground"
              >
                <StatusPill
                  tone={getCampaignStatusTone(selectedCampaign.status)}
                >
                  {selectedCampaign.status}
                </StatusPill>
                <span>
                  {selectedCampaign.recipientCount ||
                    selectedCampaign.estimatedRecipientCount}{" "}
                  recipients
                </span>
                <span>{selectedCampaign.deliveryCounts.sent} sent</span>
                <span>{selectedCampaign.deliveryCounts.failed} failed</span>
                <span>{selectedCampaign.deliveryCounts.skipped} skipped</span>
                {selectedCampaign.testSentAt ? (
                  <span>
                    Last test {formatDateTime(selectedCampaign.testSentAt)}
                  </span>
                ) : null}
                {selectedCampaign.completedAt ? (
                  <span>
                    Completed {formatDateTime(selectedCampaign.completedAt)}
                  </span>
                ) : selectedCampaign.queuedAt ? (
                  <span>
                    Queued {formatDateTime(selectedCampaign.queuedAt)}
                  </span>
                ) : null}
              </Panel>
            ) : null}
            {selectedCampaign && !editingNewCampaign && !campaignIsEditable ? (
              <Callout tone="info">
                <CalloutTitle>Campaign locked</CalloutTitle>
                <CalloutDescription>
                  This campaign is {selectedCampaign.status}. Create a new draft
                  to make content edits.
                </CalloutDescription>
              </Callout>
            ) : null}
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <Field>
                <FieldLabel>Subject</FieldLabel>
                <Input
                  value={campaignSubject}
                  placeholder="April launch update"
                  disabled={!campaignIsEditable}
                  onChange={(event) => onSubjectChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Audience</FieldLabel>
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
              </Field>
            </div>

            <Field>
              <FieldLabel>Body</FieldLabel>
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
                  {currentCampaignRecipientEstimate} confirmed recipients
                  currently match this audience
                </span>
              </div>
            </Field>

            {selectedCampaign?.lastError ? (
              <Callout tone="warn">
                <CalloutTitle>Last delivery error</CalloutTitle>
                <CalloutDescription>
                  {selectedCampaign.lastError}
                </CalloutDescription>
              </Callout>
            ) : null}
            {campaignHasUnsavedEdits ? (
              <Callout tone="warn">
                <CalloutTitle>Save draft before sending</CalloutTitle>
                <CalloutDescription>
                  Save this draft before sending a test or queueing delivery so
                  the saved campaign matches what will be sent.
                </CalloutDescription>
              </Callout>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {campaignIsEditable ? (
                <Button
                  onClick={onSaveDraft}
                  disabled={
                    isPending || !campaignSubject.trim() || !campaignBody.trim()
                  }
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
              {selectedCampaignId &&
              !editingNewCampaign &&
              campaignIsEditable ? (
                <Button
                  variant="outline"
                  disabled={isPending}
                  onClick={onDeleteDraft}
                >
                  Delete draft
                </Button>
              ) : null}
            </div>

            <Panel
              tone="dashed"
              className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <Field>
                <FieldLabel>Test send email</FieldLabel>
                <Input
                  value={testSendEmail}
                  placeholder="you@example.com"
                  onChange={(event) =>
                    onTestSendEmailChange(event.target.value)
                  }
                />
                <FieldDescription>
                  Send the current draft to a single inbox before queueing the
                  live broadcast.
                </FieldDescription>
              </Field>
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
            </Panel>
          </Panel>
        </div>
      </PanelContent>
    </Panel>
  );
}
