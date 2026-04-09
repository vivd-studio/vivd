import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import type { CmsModelRecord } from "@vivd/shared/cms";

interface CmsCollectionsSidebarProps {
  models: CmsModelRecord[];
  reportErrors: string[];
  selectedModelKey: string | null;
  creatingModel: boolean;
  newModelKey: string;
  isScaffoldingModel: boolean;
  onToggleCreateModel: () => void;
  onNewModelKeyChange: (value: string) => void;
  onCreateModel: () => void;
  onCancelCreateModel: () => void;
  onSelectModel: (modelKey: string) => void;
}

function getModelErrorCount(reportErrors: string[], model: CmsModelRecord): number {
  return reportErrors.filter(
    (error) =>
      error.includes(model.relativeSchemaPath) ||
      error.includes(model.relativeCollectionRoot),
  ).length;
}

export function CmsCollectionsSidebar({
  models,
  reportErrors,
  selectedModelKey,
  creatingModel,
  newModelKey,
  isScaffoldingModel,
  onToggleCreateModel,
  onNewModelKeyChange,
  onCreateModel,
  onCancelCreateModel,
  onSelectModel,
}: CmsCollectionsSidebarProps) {
  return (
    <div className="flex w-[260px] min-w-[260px] flex-col border-r">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Collections</h3>
          <p className="text-xs text-muted-foreground">Schema-authored content models</p>
        </div>
        <Button variant="outline" size="sm" onClick={onToggleCreateModel}>
          <Plus className="mr-2 h-4 w-4" />
          Add
        </Button>
      </div>
      {creatingModel ? (
        <div className="space-y-2 border-t px-4 py-3">
          <Label htmlFor="new-model-key">Collection key</Label>
          <Input
            id="new-model-key"
            value={newModelKey}
            onChange={(event) => onNewModelKeyChange(event.target.value)}
            placeholder="products"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={isScaffoldingModel} onClick={onCreateModel}>
              Create
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelCreateModel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {models.map((model) => {
            const active = model.key === selectedModelKey;
            const errorCount = getModelErrorCount(reportErrors, model);
            return (
              <button
                key={model.key}
                type="button"
                onClick={() => onSelectModel(model.key)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors",
                  active
                    ? "border-primary/40 bg-primary/5"
                    : "border-transparent hover:border-border hover:bg-muted/40",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{model.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {model.entries.length} entries
                  </p>
                </div>
                {errorCount > 0 ? <Badge variant="destructive">{errorCount}</Badge> : null}
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
