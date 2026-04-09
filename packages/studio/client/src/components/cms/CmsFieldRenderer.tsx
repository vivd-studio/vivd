import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, FolderOpen } from "lucide-react";
import type { CmsFieldDefinition, CmsModelRecord } from "@vivd/shared/cms";
import { CmsAssetField } from "./CmsAssetField";
import {
  buildDefaultFieldValue,
  buildRichTextReference,
  type CmsFieldSegment,
  deriveReferenceValue,
  getValueAtPath,
  resolveRelativePath,
  titleizeKey,
} from "./helpers";

interface CmsFieldRendererProps {
  projectSlug: string;
  version: number;
  fieldKey: string;
  field: CmsFieldDefinition;
  fieldPath: CmsFieldSegment[];
  draftValues: Record<string, unknown> | null;
  defaultLocale: string;
  locales: string[];
  selectedEntryRelativePath: string | null;
  selectedEntryKey: string | null;
  selectedModel: CmsModelRecord | null;
  sidecarDrafts: Record<string, string>;
  canUseAiImages: boolean;
  referenceOptions: Array<{ value: string; label: string }>;
  applyDraftValue: (fieldPath: CmsFieldSegment[], nextValue: unknown) => void;
  handleRichTextChange: (
    fieldPath: CmsFieldSegment[],
    locale: string | null,
    content: string,
  ) => void;
  openAssetReference: (assetPath: string) => void;
  openExplorer: () => void;
}

function getFieldLabel(fieldKey: string, field: CmsFieldDefinition) {
  return field.label?.trim() || titleizeKey(fieldKey);
}

function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function CmsFieldRenderer({
  projectSlug,
  version,
  fieldKey,
  field,
  fieldPath,
  draftValues,
  defaultLocale,
  locales,
  selectedEntryRelativePath,
  selectedEntryKey,
  selectedModel,
  sidecarDrafts,
  canUseAiImages,
  referenceOptions,
  applyDraftValue,
  handleRichTextChange,
  openAssetReference,
  openExplorer,
}: CmsFieldRendererProps) {
  const rawValue = draftValues ? getValueAtPath(draftValues, fieldPath) : undefined;
  const fieldId = fieldPath.map(String).join(".");
  const label = getFieldLabel(fieldKey, field);

  if (field.localized) {
    const localizedValue =
      rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
        ? (rawValue as Record<string, unknown>)
        : {};

    if (field.type === "richText" && field.storage === "sidecar-markdown") {
      return (
        <div key={fieldId} className="space-y-3 rounded-lg border border-border/60 p-4">
          <div>
            <Label className="text-sm font-medium">{label}</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Markdown sidecars stored next to the entry.
            </p>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {locales.map((locale) => {
              const relativeValue =
                typeof localizedValue[locale] === "string"
                  ? (localizedValue[locale] as string)
                  : "";
              const filePath =
                relativeValue && selectedEntryRelativePath
                  ? resolveRelativePath(selectedEntryRelativePath, relativeValue)
                  : selectedEntryRelativePath
                    ? resolveRelativePath(
                        selectedEntryRelativePath,
                        buildRichTextReference(fieldPath, locale),
                      )
                    : "";
              return (
                <div key={`${fieldId}.${locale}`} className="space-y-2">
                  <Label htmlFor={`${fieldId}.${locale}`}>{locale.toUpperCase()}</Label>
                  <Textarea
                    id={`${fieldId}.${locale}`}
                    rows={10}
                    value={sidecarDrafts[filePath] ?? ""}
                    onChange={(event) =>
                      handleRichTextChange(fieldPath, locale, event.target.value)
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div key={fieldId} className="space-y-3 rounded-lg border border-border/60 p-4">
        <div>
          <Label className="text-sm font-medium">{label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Stored per locale in the entry YAML.
          </p>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {locales.map((locale) => (
            <div key={`${fieldId}.${locale}`} className="space-y-2">
              <Label htmlFor={`${fieldId}.${locale}`}>{locale.toUpperCase()}</Label>
              {field.type === "text" ? (
                <Textarea
                  id={`${fieldId}.${locale}`}
                  rows={5}
                  value={
                    typeof localizedValue[locale] === "string"
                      ? (localizedValue[locale] as string)
                      : ""
                  }
                  onChange={(event) =>
                    applyDraftValue(fieldPath, {
                      ...localizedValue,
                      [locale]: event.target.value,
                    })
                  }
                />
              ) : (
                <Input
                  id={`${fieldId}.${locale}`}
                  value={
                    typeof localizedValue[locale] === "string"
                      ? (localizedValue[locale] as string)
                      : ""
                  }
                  onChange={(event) =>
                    applyDraftValue(fieldPath, {
                      ...localizedValue,
                      [locale]: event.target.value,
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (
    field.type === "string" ||
    field.type === "slug" ||
    field.type === "date" ||
    field.type === "datetime"
  ) {
    return (
      <div key={fieldId} className="space-y-2">
        <Label htmlFor={fieldId}>{label}</Label>
        <Input
          id={fieldId}
          value={typeof rawValue === "string" ? rawValue : ""}
          onChange={(event) => applyDraftValue(fieldPath, event.target.value)}
        />
      </div>
    );
  }

  if (field.type === "text" || field.type === "richText") {
    return (
      <div key={fieldId} className="space-y-2">
        <Label htmlFor={fieldId}>{label}</Label>
        <Textarea
          id={fieldId}
          rows={field.type === "richText" ? 10 : 5}
          value={typeof rawValue === "string" ? rawValue : ""}
          onChange={(event) =>
            field.type === "richText" && field.storage === "sidecar-markdown"
              ? handleRichTextChange(fieldPath, null, event.target.value)
              : applyDraftValue(fieldPath, event.target.value)
          }
        />
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div key={fieldId} className="space-y-2">
        <Label htmlFor={fieldId}>{label}</Label>
        <Input
          id={fieldId}
          type="number"
          value={typeof rawValue === "number" ? String(rawValue) : ""}
          onChange={(event) =>
            applyDraftValue(
              fieldPath,
              event.target.value === "" ? null : Number(event.target.value),
            )
          }
        />
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <div
        key={fieldId}
        className="flex items-center justify-between rounded-lg border border-border/60 p-4"
      >
        <div>
          <Label htmlFor={fieldId}>{label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Toggle this field directly in the collection entry.
          </p>
        </div>
        <Checkbox
          id={fieldId}
          checked={Boolean(rawValue)}
          onCheckedChange={(checked) => applyDraftValue(fieldPath, Boolean(checked))}
        />
      </div>
    );
  }

  if (field.type === "enum") {
    return (
      <div key={fieldId} className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={typeof rawValue === "string" ? rawValue : ""}
          onValueChange={(value) => applyDraftValue(fieldPath, value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.type === "reference") {
    return (
      <div key={fieldId} className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={deriveReferenceValue(rawValue) || "__empty__"}
          onValueChange={(value) =>
            applyDraftValue(fieldPath, value === "__empty__" ? "" : value)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select an entry" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__empty__">No reference</SelectItem>
            {referenceOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.type === "asset") {
    if (!selectedEntryRelativePath || !selectedEntryKey || !selectedModel) {
      return null;
    }

    const mediaRootPath = "src/content/media";
    const defaultFolderPath = `${mediaRootPath}/${selectedModel.key}/${selectedEntryKey}`;
    return (
      <CmsAssetField
        key={fieldId}
        projectSlug={projectSlug}
        version={version}
        fieldId={fieldId}
        label={label}
        field={field}
        value={rawValue}
        entryRelativePath={selectedEntryRelativePath}
        mediaRootPath={mediaRootPath}
        defaultFolderPath={defaultFolderPath}
        canUseAiImages={canUseAiImages}
        onChange={(nextValue) => applyDraftValue(fieldPath, nextValue)}
        onOpenAsset={openAssetReference}
      />
    );
  }

  if (field.type === "assetList") {
    if (!selectedEntryRelativePath || !selectedEntryKey || !selectedModel) {
      return null;
    }

    const items = ensureArray(rawValue);
    const mediaRootPath = "src/content/media";
    const defaultFolderPath = `${mediaRootPath}/${selectedModel.key}/${selectedEntryKey}`;
    return (
      <div key={fieldId} className="space-y-3 rounded-lg border border-border/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label>{label}</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Ordered asset references stored in the entry YAML.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={openExplorer}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Explorer
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const nextItem =
                  items[0] && typeof items[0] === "object" && !Array.isArray(items[0])
                    ? { ...(items[0] as Record<string, unknown>), path: "" }
                    : "";
                applyDraftValue(fieldPath, [...items, nextItem]);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add asset
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assets yet.</p>
          ) : null}
          {items.map((item, index) => (
            <div key={`${fieldId}.${index}`} className="space-y-2">
              <CmsAssetField
                projectSlug={projectSlug}
                version={version}
                fieldId={`${fieldId}.${index}`}
                label={`${label} ${index + 1}`}
                field={{ ...field, type: "asset" }}
                value={item}
                entryRelativePath={selectedEntryRelativePath}
                mediaRootPath={mediaRootPath}
                defaultFolderPath={defaultFolderPath}
                canUseAiImages={canUseAiImages}
                compact
                onChange={(nextValue) => {
                  const nextItems = [...items];
                  nextItems[index] = nextValue;
                  applyDraftValue(fieldPath, nextItems);
                }}
                onOpenAsset={openAssetReference}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const nextItems = [...items];
                    nextItems.splice(index, 1);
                    applyDraftValue(fieldPath, nextItems);
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "object") {
    return (
      <div key={fieldId} className="space-y-3 rounded-lg border border-border/60 p-4">
        <div>
          <Label className="text-sm font-medium">{label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">Nested structured fields.</p>
        </div>
        <div className="space-y-4">
          {Object.entries(field.fields ?? {}).map(([nestedKey, nestedField]) => (
            <CmsFieldRenderer
              key={`${fieldId}.${nestedKey}`}
              projectSlug={projectSlug}
              version={version}
              fieldKey={nestedKey}
              field={nestedField}
              fieldPath={[...fieldPath, nestedKey]}
              draftValues={draftValues}
              defaultLocale={defaultLocale}
              locales={locales}
              selectedEntryRelativePath={selectedEntryRelativePath}
              selectedEntryKey={selectedEntryKey}
              selectedModel={selectedModel}
              sidecarDrafts={sidecarDrafts}
              canUseAiImages={canUseAiImages}
              referenceOptions={referenceOptions}
              applyDraftValue={applyDraftValue}
              handleRichTextChange={handleRichTextChange}
              openAssetReference={openAssetReference}
              openExplorer={openExplorer}
            />
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "list") {
    const items = ensureArray(rawValue);
    return (
      <div key={fieldId} className="space-y-3 rounded-lg border border-border/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label className="text-sm font-medium">{label}</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Ordered list values stored directly in the entry.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              applyDraftValue(fieldPath, [
                ...items,
                buildDefaultFieldValue(
                  fieldKey,
                  field.item ?? { type: "string" },
                  defaultLocale,
                ),
              ])
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Add item
          </Button>
        </div>
        <div className="space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet.</p>
          ) : null}
          {items.map((_, index) => (
            <div
              key={`${fieldId}.${index}`}
              className="rounded-lg border border-border/50 bg-muted/20 p-3"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium">Item {index + 1}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    applyDraftValue(
                      fieldPath,
                      items.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
              {field.item ? (
                field.item.type === "object" ? (
                  <div className="space-y-4">
                    {Object.entries(field.item.fields ?? {}).map(([nestedKey, nestedField]) => (
                      <CmsFieldRenderer
                        key={`${fieldId}.${index}.${nestedKey}`}
                        projectSlug={projectSlug}
                        version={version}
                        fieldKey={nestedKey}
                        field={nestedField}
                        fieldPath={[...fieldPath, index, nestedKey]}
                        draftValues={draftValues}
                        defaultLocale={defaultLocale}
                        locales={locales}
                        selectedEntryRelativePath={selectedEntryRelativePath}
                        selectedEntryKey={selectedEntryKey}
                        selectedModel={selectedModel}
                        sidecarDrafts={sidecarDrafts}
                        canUseAiImages={canUseAiImages}
                        referenceOptions={referenceOptions}
                        applyDraftValue={applyDraftValue}
                        handleRichTextChange={handleRichTextChange}
                        openAssetReference={openAssetReference}
                        openExplorer={openExplorer}
                      />
                    ))}
                  </div>
                ) : (
                  <CmsFieldRenderer
                    projectSlug={projectSlug}
                    version={version}
                    fieldKey={`${fieldKey}-${index}`}
                    field={field.item}
                    fieldPath={[...fieldPath, index]}
                    draftValues={draftValues}
                    defaultLocale={defaultLocale}
                    locales={locales}
                    selectedEntryRelativePath={selectedEntryRelativePath}
                    selectedEntryKey={selectedEntryKey}
                    selectedModel={selectedModel}
                    sidecarDrafts={sidecarDrafts}
                    canUseAiImages={canUseAiImages}
                    referenceOptions={referenceOptions}
                    applyDraftValue={applyDraftValue}
                    handleRichTextChange={handleRichTextChange}
                    openAssetReference={openAssetReference}
                    openExplorer={openExplorer}
                  />
                )
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      key={fieldId}
      className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground"
    >
      Unsupported field type: <code>{field.type}</code>
    </div>
  );
}
