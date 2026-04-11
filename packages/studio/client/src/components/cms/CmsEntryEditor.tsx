import { AlertCircle, ArrowDown, ArrowUp, FileCode, Loader2, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type {
  CmsFieldDefinition,
  CmsModelRecord,
  CmsSourceKind,
} from "@vivd/shared/cms";
import { getEntryTitle, type CmsFieldSegment } from "./helpers";
import { CmsFieldRenderer } from "./CmsFieldRenderer";

interface CmsEntryEditorProps {
  projectSlug: string;
  version: number;
  selectedModel: CmsModelRecord | null;
  selectedEntryKey: string | null;
  draftValues: Record<string, unknown> | null;
  defaultLocale: string;
  locales: string[];
  sidecarDrafts: Record<string, string>;
  canUseAiImages: boolean;
  referenceOptions: Array<{ value: string; label: string }>;
  reportErrors: string[];
  sourceKind: CmsSourceKind;
  readOnly: boolean;
  readOnlyMessage?: string | null;
  isDirty: boolean;
  busy: boolean;
  isSaving: boolean;
  loadingSidecars: boolean;
  setEditingTextFile: (path: string | null) => void;
  applyDraftValue: (fieldPath: CmsFieldSegment[], nextValue: unknown) => void;
  handleRichTextChange: (
    fieldPath: CmsFieldSegment[],
    locale: string | null,
    content: string,
  ) => void;
  openAssetReference: (assetPath: string) => void;
  openExplorer: () => void;
  onMoveEntry: (direction: -1 | 1) => void;
  onSaveEntry: () => void;
  onDeleteEntry: () => void;
}

export function CmsEntryEditor({
  projectSlug,
  version,
  selectedModel,
  selectedEntryKey,
  draftValues,
  defaultLocale,
  locales,
  sidecarDrafts,
  canUseAiImages,
  referenceOptions,
  reportErrors,
  sourceKind,
  readOnly,
  readOnlyMessage,
  isDirty,
  busy,
  isSaving,
  loadingSidecars,
  setEditingTextFile,
  applyDraftValue,
  handleRichTextChange,
  openAssetReference,
  openExplorer,
  onMoveEntry,
  onSaveEntry,
  onDeleteEntry,
}: CmsEntryEditorProps) {
  const selectedEntry =
    selectedModel?.entries.find((entry) => entry.key === selectedEntryKey) ?? null;

  if (!selectedModel || !selectedEntry || !draftValues) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md space-y-3 text-center">
          <h3 className="text-lg font-semibold">Select a collection entry</h3>
          <p className="text-sm text-muted-foreground">
            Choose a collection and entry to edit its structured content.
          </p>
        </div>
      </div>
    );
  }

  const selectedEntryIndex = selectedModel.entries.findIndex(
    (entry) => entry.key === selectedEntry.key,
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">
              {getEntryTitle(selectedEntry, selectedModel, defaultLocale)}
            </h3>
            {isDirty ? <Badge variant="outline">Unsaved</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {selectedEntry.key} · {selectedEntry.relativePath}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {!readOnly ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMoveEntry(-1)}
                disabled={busy || selectedEntryIndex <= 0}
              >
                <ArrowUp className="mr-2 h-4 w-4" />
                Up
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMoveEntry(1)}
                disabled={busy || selectedEntryIndex >= selectedModel.entries.length - 1}
              >
                <ArrowDown className="mr-2 h-4 w-4" />
                Down
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingTextFile(selectedModel.relativeSchemaPath)}
          >
            <FileCode className="mr-2 h-4 w-4" />
            Schema
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingTextFile(selectedEntry.relativePath)}
          >
            Entry Source
          </Button>
          {!readOnly ? (
            <>
              <Button size="sm" disabled={!isDirty || busy} onClick={onSaveEntry}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save
              </Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={onDeleteEntry}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-5 px-4 py-5 sm:px-5">
          {loadingSidecars ? (
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading Markdown sidecars…
            </div>
          ) : null}

          {readOnly ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                {readOnlyMessage ??
                  (sourceKind === "astro-collections"
                    ? "Astro Content Collections are the source of truth for this project. This entry format is currently inspect-only in Studio."
                    : "This entry is currently inspect-only.")}
              </div>
              {Object.entries(selectedModel.fields).map(([fieldKey, field]) => (
                <CmsFieldRenderer
                  key={fieldKey}
                  projectSlug={projectSlug}
                  version={version}
                  fieldKey={fieldKey}
                  field={field as CmsFieldDefinition}
                  fieldPath={[fieldKey]}
                  draftValues={draftValues}
                  defaultLocale={defaultLocale}
                  locales={locales}
                  selectedEntryRelativePath={selectedEntry.relativePath}
                  selectedEntryKey={selectedEntry.key}
                  selectedModel={selectedModel}
                  sidecarDrafts={sidecarDrafts}
                  canUseAiImages={canUseAiImages}
                  readOnly
                  referenceOptions={referenceOptions}
                  applyDraftValue={applyDraftValue}
                  handleRichTextChange={handleRichTextChange}
                  openAssetReference={openAssetReference}
                  openExplorer={openExplorer}
                />
              ))}
            </div>
          ) : (
            Object.entries(selectedModel.fields).map(([fieldKey, field]) => (
              <CmsFieldRenderer
                key={fieldKey}
                projectSlug={projectSlug}
                version={version}
                fieldKey={fieldKey}
                field={field as CmsFieldDefinition}
                fieldPath={[fieldKey]}
                draftValues={draftValues}
                defaultLocale={defaultLocale}
                locales={locales}
                selectedEntryRelativePath={selectedEntry.relativePath}
                selectedEntryKey={selectedEntry.key}
                selectedModel={selectedModel}
                sidecarDrafts={sidecarDrafts}
                canUseAiImages={canUseAiImages}
                readOnly={false}
                referenceOptions={referenceOptions}
                applyDraftValue={applyDraftValue}
                handleRichTextChange={handleRichTextChange}
                openAssetReference={openAssetReference}
                openExplorer={openExplorer}
              />
            ))
          )}

          {reportErrors.length > 0 ? (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <h4 className="text-sm font-semibold">Validation</h4>
                </div>
                <div className="space-y-2">
                  {reportErrors.slice(0, 12).map((error) => (
                    <div
                      key={error}
                      className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
                    >
                      {error}
                    </div>
                  ))}
                  {reportErrors.length > 12 ? (
                    <p className="text-xs text-muted-foreground">
                      Showing 12 of {reportErrors.length} issues.
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
