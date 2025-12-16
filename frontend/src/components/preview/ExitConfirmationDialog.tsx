import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePreviewModal } from "./PreviewModalContext";

export function ExitConfirmationDialog() {
  const {
    showExitConfirmation,
    setShowExitConfirmation,
    handleDiscardAndClose,
    handleSaveAndClose,
  } = usePreviewModal();

  return (
    <AlertDialog
      open={showExitConfirmation}
      onOpenChange={setShowExitConfirmation}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes in Edit Mode. Do you want to save them
            before exiting?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setShowExitConfirmation(false)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDiscardAndClose}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Discard
          </AlertDialogAction>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault(); // Prevent auto-closing to handle async save
              handleSaveAndClose();
            }}
          >
            Save
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
