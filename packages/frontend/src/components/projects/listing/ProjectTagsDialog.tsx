import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAX_PROJECT_TAGS = 12;
const MAX_PROJECT_TAG_LENGTH = 32;

function normalizeTag(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#+/, "")
    .trim()
    .toLowerCase();
}

function dedupeTags(tags: string[]): string[] {
  return Array.from(new Set(tags));
}

interface ProjectTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  initialTags: string[];
  availableTags: string[];
  isSaving: boolean;
  onSave: (tags: string[]) => Promise<void>;
}

export function ProjectTagsDialog({
  open,
  onOpenChange,
  projectName,
  initialTags,
  availableTags,
  isSaving,
  onSave,
}: ProjectTagsDialogProps) {
  const [tags, setTags] = useState<string[]>([]);
  const [draftTag, setDraftTag] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTags(dedupeTags(initialTags));
    setDraftTag("");
    setErrorMessage(null);
  }, [initialTags, open]);

  const suggestions = useMemo(
    () =>
      availableTags
        .filter((tag) => !tags.includes(tag))
        .slice(0, 10),
    [availableTags, tags],
  );

  const tryAddTag = (rawTag: string): string[] | null => {
    const normalized = normalizeTag(rawTag);
    if (!normalized) return tags;

    if (normalized.length > MAX_PROJECT_TAG_LENGTH) {
      setErrorMessage(
        `Tags must be ${MAX_PROJECT_TAG_LENGTH} characters or fewer.`,
      );
      return null;
    }

    if (tags.includes(normalized)) {
      setDraftTag("");
      setErrorMessage(null);
      return tags;
    }

    if (tags.length >= MAX_PROJECT_TAGS) {
      setErrorMessage(`You can add up to ${MAX_PROJECT_TAGS} tags.`);
      return null;
    }

    const nextTags = [...tags, normalized];
    setTags(nextTags);
    setDraftTag("");
    setErrorMessage(null);
    return nextTags;
  };

  const handleRemoveTag = (tag: string) => {
    setTags((current) => current.filter((value) => value !== tag));
    setErrorMessage(null);
  };

  const handleSave = async () => {
    let nextTags = tags;
    if (draftTag.trim()) {
      const withDraft = tryAddTag(draftTag);
      if (!withDraft) return;
      nextTags = withDraft;
    }

    try {
      await onSave(nextTags);
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save tags.",
      );
    }
  };

  const remainingCount = MAX_PROJECT_TAGS - tags.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Edit project tags</DialogTitle>
          <DialogDescription>
            Organize <span className="font-medium text-foreground">{projectName}</span> with up to {MAX_PROJECT_TAGS} tags.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/20 p-3">
            {tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tags yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs font-medium"
                  >
                    #{tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      className="rounded-full text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={draftTag}
                onChange={(event) => {
                  setDraftTag(event.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    tryAddTag(draftTag);
                    return;
                  }

                  if (event.key === "Backspace" && !draftTag.trim() && tags.length > 0) {
                    event.preventDefault();
                    handleRemoveTag(tags[tags.length - 1] as string);
                  }
                }}
                placeholder="Add tag and press Enter"
                disabled={isSaving || tags.length >= MAX_PROJECT_TAGS}
                maxLength={MAX_PROJECT_TAG_LENGTH + 4}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => tryAddTag(draftTag)}
                disabled={isSaving || !draftTag.trim() || tags.length >= MAX_PROJECT_TAGS}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>

            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Suggestions:</span>
                {suggestions.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      "hover:border-primary/50 hover:text-foreground",
                    )}
                    onClick={() => tryAddTag(tag)}
                    disabled={isSaving}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{remainingCount} tag slots remaining</span>
              <span>Press Enter or comma to add quickly</span>
            </div>

            {errorMessage && (
              <p className="text-sm text-destructive">{errorMessage}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save tags"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
