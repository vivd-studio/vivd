import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface SaveVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  version: number;
  onSaveComplete?: () => void;
}

export function SaveVersionDialog({
  open,
  onOpenChange,
  projectSlug,
  version,
  onSaveComplete,
}: SaveVersionDialogProps) {
  const [message, setMessage] = useState("");
  const utils = trpc.useUtils();

  // Query history to get next version number for default message
  const { data: historyData } = trpc.project.gitHistory.useQuery(
    { slug: projectSlug, version },
    { enabled: open && !!projectSlug }
  );

  const saveMutation = trpc.project.gitSave.useMutation({
    onSuccess: (data) => {
      setMessage("");
      onOpenChange(false);

      if (data.noChanges) {
        toast.info("No changes to save");
      } else {
        toast.success(data.message);
        // Invalidate queries to refresh history
        utils.project.gitHistory.invalidate({ slug: projectSlug, version });
        utils.project.gitHasChanges.invalidate({ slug: projectSlug, version });
        utils.project.gitWorkingCommit.invalidate({
          slug: projectSlug,
          version,
        });
        onSaveComplete?.();
      }
    },
    onError: (error) => {
      toast.error(`Failed to save: ${error.message}`);
    },
  });

  // Set default message when dialog opens based on history count
  useEffect(() => {
    if (open) {
      const commitCount = historyData?.commits?.length || 0;
      const nextVersionNumber = commitCount + 1;
      setMessage(`Version ${nextVersionNumber}`);
    }
  }, [open, historyData?.commits?.length]);

  const handleSave = () => {
    if (!message.trim()) {
      toast.error("Please enter a commit message");
      return;
    }
    saveMutation.mutate({
      slug: projectSlug,
      version,
      message: message.trim(),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5" />
            Save Version
          </DialogTitle>
          <DialogDescription>
            Create a snapshot of your current changes. You can restore this
            version later.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Label htmlFor="commit-message">Description</Label>
          <Input
            id="commit-message"
            placeholder="e.g., Updated hero section text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="mt-2"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Briefly describe what you changed
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending || !message.trim()}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Version
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
