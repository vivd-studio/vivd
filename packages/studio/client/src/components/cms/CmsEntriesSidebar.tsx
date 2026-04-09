import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import type { CmsEntryRecord, CmsModelRecord } from "@vivd/shared/cms";
import { getEntryTitle } from "./helpers";

interface CmsEntriesSidebarProps {
  selectedModel: CmsModelRecord | null;
  selectedEntryKey: string | null;
  defaultLocale: string;
  reportErrors: string[];
  creatingEntry: boolean;
  newEntryKey: string;
  isScaffoldingEntry: boolean;
  onToggleCreateEntry: () => void;
  onNewEntryKeyChange: (value: string) => void;
  onCreateEntry: () => void;
  onCancelCreateEntry: () => void;
  onSelectEntry: (entryKey: string) => void;
}

function getEntryErrorCount(reportErrors: string[], entry: CmsEntryRecord): number {
  return reportErrors.filter((error) => error.includes(entry.relativePath)).length;
}

export function CmsEntriesSidebar({
  selectedModel,
  selectedEntryKey,
  defaultLocale,
  reportErrors,
  creatingEntry,
  newEntryKey,
  isScaffoldingEntry,
  onToggleCreateEntry,
  onNewEntryKeyChange,
  onCreateEntry,
  onCancelCreateEntry,
  onSelectEntry,
}: CmsEntriesSidebarProps) {
  return (
    <div className="flex w-[320px] min-w-[320px] flex-col border-r">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">{selectedModel?.label ?? "Entries"}</h3>
          <p className="text-xs text-muted-foreground">
            Active and inactive collection items
          </p>
        </div>
        {selectedModel ? (
          <Button variant="outline" size="sm" onClick={onToggleCreateEntry}>
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        ) : null}
      </div>
      {creatingEntry && selectedModel ? (
        <div className="space-y-2 border-t px-4 py-3">
          <Label htmlFor="new-entry-key">Entry key</Label>
          <Input
            id="new-entry-key"
            value={newEntryKey}
            onChange={(event) => onNewEntryKeyChange(event.target.value)}
            placeholder="alpine-boot"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={isScaffoldingEntry} onClick={onCreateEntry}>
              Create
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelCreateEntry}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2">
          {selectedModel?.entries.length ? (
            selectedModel.entries.map((entry) => {
              const active = entry.key === selectedEntryKey;
              const errorCount = getEntryErrorCount(reportErrors, entry);
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => onSelectEntry(entry.key)}
                  className={cn(
                    "flex w-full items-start justify-between rounded-lg border px-3 py-3 text-left transition-colors",
                    active
                      ? "border-primary/40 bg-primary/5"
                      : "border-transparent hover:border-border hover:bg-muted/40",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {getEntryTitle(entry, selectedModel, defaultLocale)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{entry.key}</p>
                    <div className="mt-2 flex gap-2">
                      <Badge variant={entry.status === "inactive" ? "outline" : "success"}>
                        {entry.status ?? "active"}
                      </Badge>
                      {typeof entry.sortOrder === "number" ? (
                        <Badge variant="outline">#{entry.sortOrder}</Badge>
                      ) : null}
                    </div>
                  </div>
                  {errorCount > 0 ? <Badge variant="destructive">{errorCount}</Badge> : null}
                </button>
              );
            })
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              {selectedModel ? "No entries yet." : "Add a collection to begin."}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
