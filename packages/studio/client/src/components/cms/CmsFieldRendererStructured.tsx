import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button, Label } from "@vivd/ui";

import { getValueAtPath, buildDefaultFieldValue } from "./helpers";
import {
  ensureArray,
  getFieldLabel,
  type CmsFieldRendererProps,
} from "./CmsFieldRenderer.shared";

interface CmsFieldRendererStructuredProps {
  props: CmsFieldRendererProps;
  renderField: (props: CmsFieldRendererProps) => ReactNode;
}

export function CmsFieldRendererStructured({
  props,
  renderField,
}: CmsFieldRendererStructuredProps) {
  const {
    fieldKey,
    field,
    fieldPath,
    draftValues,
    defaultLocale,
    locales,
    readOnly = false,
    applyDraftValue,
  } = props;

  const rawValue = draftValues ? getValueAtPath(draftValues, fieldPath) : undefined;
  const fieldId = fieldPath.map(String).join(".");
  const label = getFieldLabel(fieldKey, field);

  if (field.type === "object") {
    return (
      <div key={fieldId} className="space-y-3 rounded-lg border border-border/60 p-4">
        <div>
          <Label className="text-sm font-medium">{label}</Label>
        </div>
        <div className="space-y-4">
          {Object.entries(field.fields ?? {}).map(([nestedKey, nestedField]) =>
            renderField({
              ...props,
              fieldKey: nestedKey,
              field: nestedField,
              fieldPath: [...fieldPath, nestedKey],
            }),
          )}
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
            disabled={readOnly}
            onClick={() =>
              applyDraftValue(fieldPath, [
                ...items,
                buildDefaultFieldValue(
                  fieldKey,
                  field.item ?? { type: "string" },
                  defaultLocale,
                  locales,
                ),
              ])
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Add item
          </Button>
        </div>
        <div className="space-y-3">
          {items.length === 0 ? <p className="text-sm text-muted-foreground">No items yet.</p> : null}
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
                    {Object.entries(field.item.fields ?? {}).map(([nestedKey, nestedField]) =>
                      renderField({
                        ...props,
                        fieldKey: nestedKey,
                        field: nestedField,
                        fieldPath: [...fieldPath, index, nestedKey],
                      }),
                    )}
                  </div>
                ) : (
                  renderField({
                    ...props,
                    fieldKey: `${fieldKey}-${index}`,
                    field: field.item,
                    fieldPath: [...fieldPath, index],
                  })
                )
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
