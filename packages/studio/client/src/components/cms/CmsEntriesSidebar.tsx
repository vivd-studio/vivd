import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Plus, Search, X } from "lucide-react";
import type { CmsEntryRecord, CmsModelRecord } from "@vivd/shared/cms";
import { getEntryTitle } from "./helpers";

interface CmsEntriesSidebarProps {
  selectedModel: CmsModelRecord | null;
  selectedEntryKey: string | null;
  defaultLocale: string;
  reportErrors: string[];
  allowCreateEntry: boolean;
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
  allowCreateEntry,
  creatingEntry,
  newEntryKey,
  isScaffoldingEntry,
  onToggleCreateEntry,
  onNewEntryKeyChange,
  onCreateEntry,
  onCancelCreateEntry,
  onSelectEntry,
}: CmsEntriesSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    setSearchQuery("");
  }, [selectedModel?.key]);

  const filteredEntries = useMemo(() => {
    if (!selectedModel) {
      return [];
    }

    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return selectedModel.entries;
    }

    return selectedModel.entries.filter((entry) => {
      const title = getEntryTitle(entry, selectedModel, defaultLocale).toLowerCase();
      return (
        entry.key.toLowerCase().includes(normalizedQuery) ||
        title.includes(normalizedQuery)
      );
    });
  }, [defaultLocale, deferredSearchQuery, selectedModel]);

  const selectedEntryHiddenByFilter = Boolean(
    selectedEntryKey &&
      deferredSearchQuery.trim() &&
      selectedModel?.entries.some((entry) => entry.key === selectedEntryKey) &&
      !filteredEntries.some((entry) => entry.key === selectedEntryKey),
  );

  return (
    <div className="flex h-full min-h-0 max-h-[320px] w-full flex-col overflow-hidden border-b lg:max-h-none lg:border-b-0 lg:border-r">
      <div className="flex items-start justify-between gap-2 px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{selectedModel?.label ?? "Entries"}</h3>
          <p className="text-xs text-muted-foreground">
            Active and inactive collection items
          </p>
        </div>
        {selectedModel && allowCreateEntry ? (
          <Button variant="outline" size="sm" onClick={onToggleCreateEntry}>
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        ) : null}
      </div>
      {creatingEntry && selectedModel ? (
        <div className="space-y-2 border-t px-3 py-3 sm:px-4">
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
      {selectedModel ? (
        <div className="space-y-2 border-t px-3 py-3 sm:px-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search entries"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search entries"
              className="h-8 pl-8 pr-9 text-xs sm:text-sm"
            />
            {searchQuery ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
                onClick={() => setSearchQuery("")}
                aria-label="Clear entry search"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {deferredSearchQuery.trim()
              ? `Showing ${filteredEntries.length} of ${selectedModel.entries.length} entries`
              : `${selectedModel.entries.length} total entries`}
          </p>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2 pb-14">
          {selectedModel ? (
            filteredEntries.length ? (
              <>
                {selectedEntryHiddenByFilter ? (
                  <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                    The current selection is hidden by the active filter.
                  </div>
                ) : null}
                {filteredEntries.map((entry) => {
                  const active = entry.key === selectedEntryKey;
                  const errorCount = getEntryErrorCount(reportErrors, entry);
                  const entryTitle = getEntryTitle(entry, selectedModel, defaultLocale);
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => onSelectEntry(entry.key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary/40 bg-primary/5"
                          : "border-transparent hover:border-border hover:bg-muted/40",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-medium leading-5"
                          title={entryTitle}
                        >
                          {entryTitle}
                        </p>
                        <p
                          className="truncate text-[11px] leading-4 text-muted-foreground"
                          title={entry.key}
                        >
                          {entry.key}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 self-center whitespace-nowrap">
                        <Badge
                          variant={entry.status === "inactive" ? "outline" : "success"}
                          className="px-1.5 py-0 text-[11px]"
                        >
                          {entry.status ?? "active"}
                        </Badge>
                        {typeof entry.sortOrder === "number" ? (
                          <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
                            #{entry.sortOrder}
                          </Badge>
                        ) : null}
                        {errorCount > 0 ? (
                          <Badge variant="destructive" className="px-1.5 py-0 text-[11px]">
                            {errorCount}
                          </Badge>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                {deferredSearchQuery.trim()
                  ? "No entries match this search."
                  : "No entries yet."}
              </div>
            )
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Add a collection to begin.</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
