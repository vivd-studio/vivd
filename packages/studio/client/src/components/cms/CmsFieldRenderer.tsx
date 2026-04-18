import { Checkbox, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@vivd/ui";

import { deriveReferenceValue, getValueAtPath } from "./helpers";
import {
  getFieldLabel,
  type CmsFieldRendererProps,
} from "./CmsFieldRenderer.shared";
import { CmsFieldRendererAssetFields } from "./CmsFieldRendererAssetFields";
import { CmsFieldRendererLocalized } from "./CmsFieldRendererLocalized";
import { CmsFieldRendererStructured } from "./CmsFieldRendererStructured";

export function CmsFieldRenderer(props: CmsFieldRendererProps) {
  const {
    fieldKey,
    field,
    fieldPath,
    draftValues,
    readOnly = false,
    referenceOptions,
    applyDraftValue,
    handleRichTextChange,
  } = props;

  const rawValue = draftValues ? getValueAtPath(draftValues, fieldPath) : undefined;
  const fieldId = fieldPath.map(String).join(".");
  const label = getFieldLabel(fieldKey, field);
  const targetReferenceModelKey = field.referenceModelKey?.trim();
  const filteredReferenceOptions = targetReferenceModelKey
    ? referenceOptions.filter((option) => option.modelKey === targetReferenceModelKey)
    : referenceOptions;

  const localizedField = CmsFieldRendererLocalized(props);
  if (localizedField) {
    return localizedField;
  }

  const assetField = CmsFieldRendererAssetFields(props);
  if (assetField) {
    return assetField;
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
          readOnly={readOnly}
          disabled={readOnly}
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
          readOnly={readOnly}
          disabled={readOnly}
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
          readOnly={readOnly}
          disabled={readOnly}
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
          disabled={readOnly}
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
          disabled={readOnly}
          onValueChange={(value) => applyDraftValue(fieldPath, value)}
        >
          <SelectTrigger disabled={readOnly}>
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
          value={deriveReferenceValue(rawValue, targetReferenceModelKey) || "__empty__"}
          disabled={readOnly}
          onValueChange={(value) =>
            applyDraftValue(fieldPath, value === "__empty__" ? undefined : value)
          }
        >
          <SelectTrigger disabled={readOnly}>
            <SelectValue placeholder="Select an entry" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__empty__">No reference</SelectItem>
            {filteredReferenceOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const structuredField = CmsFieldRendererStructured({
    props,
    renderField: CmsFieldRenderer,
  });
  if (structuredField) {
    return structuredField;
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

export type { CmsFieldRendererProps } from "./CmsFieldRenderer.shared";
