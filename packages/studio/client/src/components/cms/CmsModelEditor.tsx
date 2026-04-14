import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileCode,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CmsFieldDefinition, CmsModelRecord } from "@vivd/shared/cms";
import { cloneValue } from "./helpers";

const ITEM_SEGMENT = "__item__";

const FIELD_TYPE_OPTIONS: Array<{ value: CmsFieldDefinition["type"]; label: string }> = [
  { value: "string", label: "String" },
  { value: "text", label: "Text" },
  { value: "richText", label: "Rich text" },
  { value: "slug", label: "Slug" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "enum", label: "Enum" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date time" },
  { value: "asset", label: "Image asset" },
  { value: "assetList", label: "Image list" },
  { value: "reference", label: "Reference" },
  { value: "object", label: "Object" },
  { value: "list", label: "List" },
];

const LOCALIZABLE_FIELD_TYPES = new Set<CmsFieldDefinition["type"]>([
  "string",
  "text",
  "richText",
]);

function supportsLocalizedFields(type: CmsFieldDefinition["type"]): boolean {
  return LOCALIZABLE_FIELD_TYPES.has(type);
}

interface CmsModelEditorProps {
  selectedModel: CmsModelRecord | null;
  collectionOptions: string[];
  busy: boolean;
  isSaving: boolean;
  reportErrors: string[];
  setEditingTextFile: (path: string | null) => void;
  onSaveModel: (fields: Record<string, CmsFieldDefinition>) => void;
}

interface CmsModelFieldEditorProps {
  fieldKey: string;
  field: CmsFieldDefinition;
  fieldPath: string[];
  parentPath: string[];
  depth: number;
  collectionOptions: string[];
  onRenameField: (parentPath: string[], previousKey: string, nextKey: string) => void;
  onUpdateField: (fieldPath: string[], updater: (field: CmsFieldDefinition) => CmsFieldDefinition) => void;
  onRemoveField: (parentPath: string[], fieldKey: string) => void;
  onMoveField: (parentPath: string[], fieldKey: string, direction: -1 | 1) => void;
  onAddNestedField: (parentPath: string[]) => void;
  canRename?: boolean;
  canRemove?: boolean;
  canMove?: boolean;
}

function buildDefaultModelField(type: CmsFieldDefinition["type"] = "string"): CmsFieldDefinition {
  switch (type) {
    case "object":
      return { type, required: false, fields: {} };
    case "list":
      return { type, required: false, item: { type: "string", required: false } };
    case "asset":
      return { type, required: false, accepts: ["image/*"] };
    case "assetList":
      return { type, required: false, accepts: ["image/*"] };
    case "enum":
      return { type, required: false, options: ["option"] };
    case "reference":
      return { type, required: false, referenceModelKey: "" };
    default:
      return { type, required: false };
  }
}

function normalizeFieldForType(
  type: CmsFieldDefinition["type"],
  previous: CmsFieldDefinition,
): CmsFieldDefinition {
  const next = buildDefaultModelField(type);
  return {
    ...next,
    description: previous.description,
    required: previous.required,
    default: previous.default,
    localized: supportsLocalizedFields(type) ? previous.localized : undefined,
  };
}

function updateFieldAtPath(
  fields: Record<string, CmsFieldDefinition>,
  fieldPath: string[],
  updater: (field: CmsFieldDefinition) => CmsFieldDefinition,
): Record<string, CmsFieldDefinition> {
  const [segment, ...rest] = fieldPath;
  if (!segment) {
    return fields;
  }

  const current = fields[segment];
  if (!current) {
    return fields;
  }

  if (rest.length === 0) {
    return {
      ...fields,
      [segment]: updater(current),
    };
  }

  if (rest[0] === ITEM_SEGMENT) {
    if (current.type !== "list" || !current.item) {
      return fields;
    }
    if (rest.length === 1) {
      return {
        ...fields,
        [segment]: {
          ...current,
          item: updater(current.item),
        },
      };
    }
    if (current.item.type !== "object") {
      return fields;
    }
    return {
      ...fields,
      [segment]: {
        ...current,
        item: {
          ...current.item,
          fields: updateFieldAtPath(current.item.fields ?? {}, rest.slice(1), updater),
        },
      },
    };
  }

  if (current.type !== "object") {
    return fields;
  }

  return {
    ...fields,
    [segment]: {
      ...current,
      fields: updateFieldAtPath(current.fields ?? {}, rest, updater),
    },
  };
}

function updateFieldMapAtPath(
  fields: Record<string, CmsFieldDefinition>,
  parentPath: string[],
  updater: (nextMap: Record<string, CmsFieldDefinition>) => Record<string, CmsFieldDefinition>,
): Record<string, CmsFieldDefinition> {
  if (parentPath.length === 0) {
    return updater(fields);
  }

  const [segment, ...rest] = parentPath;
  const current = fields[segment];
  if (!current) {
    return fields;
  }

  if (rest[0] === ITEM_SEGMENT) {
    if (current.type !== "list" || !current.item || current.item.type !== "object") {
      return fields;
    }
    if (rest.length === 1) {
      return {
        ...fields,
        [segment]: {
          ...current,
          item: {
            ...current.item,
            fields: updater(current.item.fields ?? {}),
          },
        },
      };
    }
    return {
      ...fields,
      [segment]: {
        ...current,
        item: {
          ...current.item,
          fields: updateFieldMapAtPath(current.item.fields ?? {}, rest.slice(1), updater),
        },
      },
    };
  }

  if (current.type !== "object") {
    return fields;
  }

  if (rest.length === 0) {
    return {
      ...fields,
      [segment]: {
        ...current,
        fields: updater(current.fields ?? {}),
      },
    };
  }

  return {
    ...fields,
    [segment]: {
      ...current,
      fields: updateFieldMapAtPath(current.fields ?? {}, rest, updater),
    },
  };
}

function moveFieldKey(
  fieldMap: Record<string, CmsFieldDefinition>,
  fieldKey: string,
  direction: -1 | 1,
): Record<string, CmsFieldDefinition> {
  const entries = Object.entries(fieldMap);
  const currentIndex = entries.findIndex(([key]) => key === fieldKey);
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= entries.length) {
    return fieldMap;
  }

  const reordered = [...entries];
  const [moved] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  return Object.fromEntries(reordered);
}

function CmsModelFieldEditor({
  fieldKey,
  field,
  fieldPath,
  parentPath,
  depth,
  collectionOptions,
  onRenameField,
  onUpdateField,
  onRemoveField,
  onMoveField,
  onAddNestedField,
  canRename = true,
  canRemove = true,
  canMove = true,
}: CmsModelFieldEditorProps) {
  const [fieldKeyDraft, setFieldKeyDraft] = useState(fieldKey);
  const nestedFieldEntries = useMemo(
    () => Object.entries(field.fields ?? {}),
    [field.fields],
  );

  useEffect(() => {
    setFieldKeyDraft(fieldKey);
  }, [fieldKey]);

  return (
    <div
      className="space-y-4 rounded-lg border border-border/60 bg-muted/10 p-4"
      style={{ marginLeft: depth ? `${depth * 16}px` : 0 }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[220px] flex-1 space-y-2">
          <Label>{canRename ? "Field key" : "Field"}</Label>
          {canRename ? (
            <Input
              value={fieldKeyDraft}
              onChange={(event) => setFieldKeyDraft(event.target.value)}
              onBlur={() => {
                onRenameField(parentPath, fieldKey, fieldKeyDraft);
                setFieldKeyDraft(fieldKeyDraft.trim() || fieldKey);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onRenameField(parentPath, fieldKey, fieldKeyDraft);
                setFieldKeyDraft(fieldKeyDraft.trim() || fieldKey);
              }}
            />
          ) : (
            <div className="rounded-md border border-border/60 bg-background px-3 py-2 text-sm font-medium">
              {fieldKey}
            </div>
          )}
        </div>
        <div className="min-w-[180px] space-y-2">
          <Label>Type</Label>
          <Select
            value={field.type}
            onValueChange={(value) =>
              onUpdateField(fieldPath, (current) =>
                normalizeFieldForType(value as CmsFieldDefinition["type"], current),
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-2 pt-7">
          {canMove ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onMoveField(parentPath, fieldKey, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onMoveField(parentPath, fieldKey, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </>
          ) : null}
          {canRemove ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => onRemoveField(parentPath, fieldKey)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            rows={2}
            value={field.description ?? ""}
            onChange={(event) =>
              onUpdateField(fieldPath, (current) => ({
                ...current,
                description: event.target.value || undefined,
              }))
            }
          />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-3">
            <div>
              <Label>Required</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional fields become `.optional()` in Astro.
              </p>
            </div>
            <Checkbox
              checked={field.required !== false}
              onCheckedChange={(checked) =>
                onUpdateField(fieldPath, (current) => ({
                  ...current,
                  required: Boolean(checked),
                }))
              }
            />
          </div>
          {supportsLocalizedFields(field.type) ? (
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-3">
              <div>
                <Label>Localized</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Stores one value per locale and routes preview saves through
                  the active locale key.
                </p>
              </div>
              <Checkbox
                checked={field.localized === true}
                onCheckedChange={(checked) =>
                  onUpdateField(fieldPath, (current) => ({
                    ...current,
                    localized: checked ? true : undefined,
                  }))
                }
              />
            </div>
          ) : null}
        </div>
      </div>

      {field.type === "enum" ? (
        <div className="space-y-2">
          <Label>Enum options</Label>
          <Textarea
            rows={3}
            value={(field.options ?? []).join("\n")}
            onChange={(event) =>
              onUpdateField(fieldPath, (current) => ({
                ...current,
                options: event.target.value
                  .split("\n")
                  .map((option) => option.trim())
                  .filter(Boolean),
              }))
            }
            placeholder={"draft\npublished\narchived"}
          />
        </div>
      ) : null}

      {field.type === "reference" ? (
        <div className="space-y-2">
          <Label>Reference collection</Label>
          <Select
            value={field.referenceModelKey || "__empty__"}
            onValueChange={(value) =>
              onUpdateField(fieldPath, (current) => ({
                ...current,
                referenceModelKey: value === "__empty__" ? "" : value,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a collection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty__">Select collection</SelectItem>
              {collectionOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {field.type === "object" ? (
        <div className="space-y-3 rounded-lg border border-dashed border-border/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Nested fields</p>
              <p className="text-xs text-muted-foreground">
                These become <code>z.object(...)</code>.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => onAddNestedField(fieldPath)}>
              <Plus className="mr-2 h-4 w-4" />
              Add nested field
            </Button>
          </div>
          <div className="space-y-3">
            {nestedFieldEntries.length ? (
              nestedFieldEntries.map(([nestedKey, nestedField]) => (
                <CmsModelFieldEditor
                  key={`${fieldPath.join(".")}.${nestedKey}`}
                  fieldKey={nestedKey}
                  field={nestedField}
                  fieldPath={[...fieldPath, nestedKey]}
                  parentPath={fieldPath}
                  depth={depth + 1}
                  collectionOptions={collectionOptions}
                  onRenameField={onRenameField}
                  onUpdateField={onUpdateField}
                  onRemoveField={onRemoveField}
                  onMoveField={onMoveField}
                  onAddNestedField={onAddNestedField}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No nested fields yet.</p>
            )}
          </div>
        </div>
      ) : null}

      {field.type === "list" ? (
        <div className="space-y-3 rounded-lg border border-dashed border-border/70 p-3">
          <div>
            <p className="text-sm font-medium">Item schema</p>
            <p className="text-xs text-muted-foreground">
              This becomes <code>z.array(...)</code>.
            </p>
          </div>
          <CmsModelFieldEditor
            fieldKey="Item schema"
            field={field.item ?? buildDefaultModelField("string")}
            fieldPath={[...fieldPath, ITEM_SEGMENT]}
            parentPath={fieldPath}
            depth={depth + 1}
            collectionOptions={collectionOptions}
            onRenameField={onRenameField}
            onUpdateField={onUpdateField}
            onRemoveField={onRemoveField}
            onMoveField={onMoveField}
            onAddNestedField={onAddNestedField}
            canRename={false}
            canRemove={false}
            canMove={false}
          />
          {field.item?.type === "object" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAddNestedField([...fieldPath, ITEM_SEGMENT])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add item field
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CmsModelEditor({
  selectedModel,
  collectionOptions,
  busy,
  isSaving,
  reportErrors,
  setEditingTextFile,
  onSaveModel,
}: CmsModelEditorProps) {
  const [draftFields, setDraftFields] = useState<Record<string, CmsFieldDefinition> | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setDraftFields(selectedModel ? cloneValue(selectedModel.fields) : null);
    setIsDirty(false);
  }, [selectedModel]);

  const fieldEntries = useMemo(
    () => Object.entries(draftFields ?? {}),
    [draftFields],
  );

  const applyFields = (
    updater: (current: Record<string, CmsFieldDefinition>) => Record<string, CmsFieldDefinition>,
  ) => {
    setDraftFields((current) => {
      if (!current) {
        return current;
      }
      const next = updater(current);
      return next;
    });
    setIsDirty(true);
  };

  const handleRenameField = (parentPath: string[], previousKey: string, nextKey: string) => {
    const normalizedKey = nextKey.trim();
    if (!normalizedKey || normalizedKey === previousKey) {
      return;
    }
    applyFields((current) =>
      updateFieldMapAtPath(current, parentPath, (fieldMap) => {
        if (fieldMap[normalizedKey]) {
          return fieldMap;
        }
        const entries = Object.entries(fieldMap).map(([key, value]) =>
          key === previousKey ? [normalizedKey, value] : [key, value],
        );
        return Object.fromEntries(entries);
      }),
    );
  };

  const handleUpdateField = (
    fieldPath: string[],
    updater: (field: CmsFieldDefinition) => CmsFieldDefinition,
  ) => {
    applyFields((current) => updateFieldAtPath(current, fieldPath, updater));
  };

  const handleRemoveField = (parentPath: string[], fieldKey: string) => {
    applyFields((current) =>
      updateFieldMapAtPath(current, parentPath, (fieldMap) => {
        const next = { ...fieldMap };
        delete next[fieldKey];
        return next;
      }),
    );
  };

  const handleMoveField = (parentPath: string[], fieldKey: string, direction: -1 | 1) => {
    applyFields((current) =>
      updateFieldMapAtPath(current, parentPath, (fieldMap) =>
        moveFieldKey(fieldMap, fieldKey, direction),
      ),
    );
  };

  const handleAddNestedField = (parentPath: string[]) => {
    applyFields((current) =>
      updateFieldMapAtPath(current, parentPath, (fieldMap) => {
        let index = 1;
        let nextKey = "newField";
        while (fieldMap[nextKey]) {
          index += 1;
          nextKey = `newField${index}`;
        }
        return {
          ...fieldMap,
          [nextKey]: buildDefaultModelField("string"),
        };
      }),
    );
  };

  const modelErrorCount = selectedModel
    ? reportErrors.filter(
        (error) =>
          error.includes(selectedModel.relativeSchemaPath) ||
          error.includes(selectedModel.relativeCollectionRoot),
      ).length
    : 0;

  if (!selectedModel || !draftFields) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md space-y-3 text-center">
          <h3 className="text-lg font-semibold">Select a collection</h3>
          <p className="text-sm text-muted-foreground">
            Choose a collection to edit its Astro schema.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{selectedModel.label}</h3>
            {isDirty ? <Badge variant="outline">Unsaved</Badge> : null}
            {modelErrorCount > 0 ? (
              <Badge variant="destructive">{modelErrorCount} issue(s)</Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {selectedModel.key} · {selectedModel.relativeSchemaPath}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingTextFile(selectedModel.relativeSchemaPath)}
          >
            <FileCode className="mr-2 h-4 w-4" />
            Source
          </Button>
          <Button
            size="sm"
            disabled={!isDirty || busy}
            onClick={() => onSaveModel(draftFields)}
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save model
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-4 pt-5 pb-14 sm:px-5">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            Studio rewrites the supported collection schema subset back into
            <code className="mx-1">src/content.config.ts</code>. Unsupported custom TypeScript
            patterns should still be edited in source.
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">Fields</h4>
              <p className="text-xs text-muted-foreground">
                Ordered schema fields for this collection.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => handleAddNestedField([])}>
              <Plus className="mr-2 h-4 w-4" />
              Add field
            </Button>
          </div>

          <div className="space-y-3">
            {fieldEntries.length ? (
              fieldEntries.map(([fieldKey, field]) => (
                <CmsModelFieldEditor
                  key={fieldKey}
                  fieldKey={fieldKey}
                  field={field}
                  fieldPath={[fieldKey]}
                  parentPath={[]}
                  depth={0}
                  collectionOptions={collectionOptions}
                  onRenameField={handleRenameField}
                  onUpdateField={handleUpdateField}
                  onRemoveField={handleRemoveField}
                  onMoveField={handleMoveField}
                  onAddNestedField={handleAddNestedField}
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                No fields defined yet.
              </div>
            )}
          </div>

          {fieldEntries.length === 0 ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => handleAddNestedField([])}>
                <Plus className="mr-2 h-4 w-4" />
                Add first field
              </Button>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
