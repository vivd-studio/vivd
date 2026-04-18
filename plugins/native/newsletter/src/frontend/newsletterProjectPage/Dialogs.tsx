import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@vivd/ui";
import type { NewsletterCampaignRecord } from "./types";

export function NewsletterDialogs(props: {
  selectedCampaign: NewsletterCampaignRecord | null;
  deleteCampaignId: string | null;
  unsubscribeEmail: string | null;
  sendCampaignId: string | null;
  cancelSendCampaignId: string | null;
  isActionPending: boolean;
  isCampaignActionPending: boolean;
  onDeleteCampaignOpenChange: (open: boolean) => void;
  onUnsubscribeOpenChange: (open: boolean) => void;
  onSendCampaignOpenChange: (open: boolean) => void;
  onCancelSendOpenChange: (open: boolean) => void;
  onConfirmDeleteCampaign: () => void;
  onConfirmUnsubscribe: () => void;
  onConfirmQueueSend: () => void;
  onConfirmCancelSend: () => void;
}) {
  const {
    selectedCampaign,
    deleteCampaignId,
    unsubscribeEmail,
    sendCampaignId,
    cancelSendCampaignId,
    isActionPending,
    isCampaignActionPending,
    onDeleteCampaignOpenChange,
    onUnsubscribeOpenChange,
    onSendCampaignOpenChange,
    onCancelSendOpenChange,
    onConfirmDeleteCampaign,
    onConfirmUnsubscribe,
    onConfirmQueueSend,
    onConfirmCancelSend,
  } = props;

  return (
    <>
      <AlertDialog
        open={Boolean(deleteCampaignId)}
        onOpenChange={onDeleteCampaignOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the saved draft. No subscriber emails have been
              sent by this draft yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCampaignActionPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isCampaignActionPending || !deleteCampaignId}
              onClick={(event) => {
                event.preventDefault();
                onConfirmDeleteCampaign();
              }}
            >
              {isCampaignActionPending ? "Deleting..." : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(unsubscribeEmail)}
        onOpenChange={onUnsubscribeOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsubscribe subscriber?</AlertDialogTitle>
            <AlertDialogDescription>
              {unsubscribeEmail
                ? `${unsubscribeEmail} will be marked as unsubscribed immediately. If they want back in, they will need to submit the signup form again and confirm from their email.`
                : "This subscriber will be marked as unsubscribed immediately."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isActionPending || !unsubscribeEmail}
              onClick={(event) => {
                event.preventDefault();
                onConfirmUnsubscribe();
              }}
            >
              {isActionPending ? "Unsubscribing..." : "Unsubscribe"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(sendCampaignId)}
        onOpenChange={onSendCampaignOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Queue campaign send?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCampaign
                ? `${selectedCampaign.subject} will be queued for background delivery to ${selectedCampaign.estimatedRecipientCount} currently matching confirmed recipients.`
                : "This campaign will be queued for background delivery."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCampaignActionPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isCampaignActionPending || !sendCampaignId}
              onClick={(event) => {
                event.preventDefault();
                onConfirmQueueSend();
              }}
            >
              {isCampaignActionPending ? "Queueing..." : "Queue send"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(cancelSendCampaignId)}
        onOpenChange={onCancelSendOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel campaign send?</AlertDialogTitle>
            <AlertDialogDescription>
              Queued deliveries that have not started yet will be canceled. Any
              email already being processed may still complete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCampaignActionPending}>
              Keep sending
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isCampaignActionPending || !cancelSendCampaignId}
              onClick={(event) => {
                event.preventDefault();
                onConfirmCancelSend();
              }}
            >
              {isCampaignActionPending ? "Canceling..." : "Cancel send"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
