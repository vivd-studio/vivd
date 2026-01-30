import { useEffect, useState } from "react";
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
import { Loader2, Rocket, Tag } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  version: number;
  onPublished?: () => void;
}

/**
 * Standalone studio publish dialog.
 *
 * In the single-instance studio, "publishing" creates a git tag (and pushes it).
 */
export function PublishDialog({
  open,
  onOpenChange,
  projectSlug,
  onPublished,
}: PublishDialogProps) {
  const utils = trpc.useUtils();
  const [tagName, setTagName] = useState("");
  const [message, setMessage] = useState("");

  const { data: publishStatus } = trpc.project.publishStatus.useQuery(
    { slug: projectSlug },
    { enabled: open && !!projectSlug },
  );

  useEffect(() => {
    if (!open) return;
    setTagName("");
    setMessage("");
  }, [open]);

  const createTagMutation = trpc.project.createTag.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || `Created tag: ${data.tag}`);
      utils.project.publishStatus.invalidate({ slug: projectSlug });
      onPublished?.();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to create tag: ${error.message}`);
    },
  });

  const handleCreateTag = () => {
    if (!tagName.trim()) {
      toast.error("Please enter a tag name");
      return;
    }
    createTagMutation.mutate({
      slug: projectSlug,
      tagName: tagName.trim(),
      message: message.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            Publish (Git Tag)
          </DialogTitle>
          <DialogDescription>
            Create a tag for the current workspace state.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {publishStatus?.lastTag ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Tag className="h-4 w-4" />
              Last tag: <span className="font-mono">{publishStatus.lastTag}</span>
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="tag-name">Tag</Label>
            <Input
              id="tag-name"
              placeholder="v1.0.0"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tag-message">Message (optional)</Label>
            <Input
              id="tag-message"
              placeholder="Release notes…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={createTagMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateTag}
            disabled={createTagMutation.isPending || !tagName.trim()}
          >
            {createTagMutation.isPending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </span>
            ) : (
              "Create Tag"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

