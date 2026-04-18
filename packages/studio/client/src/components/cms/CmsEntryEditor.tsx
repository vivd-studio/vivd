import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  FileCode,
  Globe,
  Loader2,
  MoreHorizontal,
  Save,
  Trash2,
} from "lucide-react";
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, ScrollArea, Separator } from "@vivd/ui";

import { cn } from "@/lib/utils";
import type {
  CmsFieldDefinition,
  CmsModelRecord,
  CmsSourceKind,
} from "@vivd/shared/cms";
import { getEntryTitle, type CmsFieldSegment } from "./helpers";
import { CmsFieldRenderer } from "./CmsFieldRenderer";
import { CmsMarkdownBodyEditor } from "./CmsMarkdownBodyEditor";

interface CmsEntryEditorProps {
  projectSlug: string;
  version: number;
  selectedModel: CmsModelRecord | null;
  selectedEntryKey: string | null;
  draftValues: Record<string, unknown> | null;
  defaultLocale: string;
  locales: string[];
  activeLocale: string | null;
  sidecarDrafts: Record<string, string>;
  canUseAiImages: boolean;
  referenceOptions: Array<{
    value: string;
    label: string;
    modelKey: string;
    entryKey: string;
  }>;
  reportErrors: string[];
  sourceKind: CmsSourceKind;
  readOnly: boolean;
  readOnlyMessage?: string | null;
  isDirty: boolean;
  busy: boolean;
  isSaving: boolean;
  loadingSidecars: boolean;
  markdownBody: string | null;
  loadingMarkdownBody: boolean;
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
  onMarkdownBodyChange: (value: string) => void;
  onActiveLocaleChange: (locale: string | null) => void;
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
  activeLocale,
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
  markdownBody,
  loadingMarkdownBody,
  setEditingTextFile,
  applyDraftValue,
  handleRichTextChange,
  openAssetReference,
  openExplorer,
  onMoveEntry,
  onMarkdownBodyChange,
  onActiveLocaleChange,
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
  const hasLocalizedFields = Object.values(selectedModel.fields).some(
    (field) => field.localized,
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
          {hasLocalizedFields && locales.length > 1 ? (
            <div className="flex items-center gap-1 rounded-md border border-border/60 p-0.5">
              <button
                type="button"
                onClick={() => onActiveLocaleChange(null)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors",
                  activeLocale === null
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Globe className="h-3 w-3" />
                All
              </button>
              {locales.map((locale) => (
                <button
                  key={locale}
                  type="button"
                  onClick={() => onActiveLocaleChange(locale)}
                  className={cn(
                    "inline-flex items-center rounded px-2 py-1 text-xs font-medium uppercase transition-colors",
                    activeLocale === locale
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {locale}
                </button>
              ))}
            </div>
          ) : null}
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
          {!readOnly ? (
            <Button size="sm" disabled={!isDirty || busy} onClick={onSaveEntry}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setEditingTextFile(selectedModel.relativeSchemaPath)}
              >
                <FileCode className="mr-2 h-4 w-4" />
                View schema
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setEditingTextFile(selectedEntry.relativePath)}
              >
                <FileCode className="mr-2 h-4 w-4" />
                View entry source
              </DropdownMenuItem>
              {!readOnly ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    disabled={busy}
                    onClick={onDeleteEntry}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete entry
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-4 pt-5 pb-14 sm:px-5">
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
                  activeLocale={activeLocale}
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
                activeLocale={activeLocale}
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

          {markdownBody !== null ? (
            <CmsMarkdownBodyEditor
              value={markdownBody}
              readOnly={readOnly}
              loading={loadingMarkdownBody}
              onChange={onMarkdownBodyChange}
            />
          ) : null}

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
