import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  buildRichTextReference,
  getValueAtPath,
  resolveRelativePath,
} from "./helpers";
import {
  getFieldLabel,
  type CmsFieldRendererProps,
} from "./CmsFieldRenderer.shared";

export function CmsFieldRendererLocalized(props: CmsFieldRendererProps) {
  const {
    fieldKey,
    field,
    fieldPath,
    draftValues,
    locales,
    selectedEntryRelativePath,
    sidecarDrafts,
    readOnly = false,
    applyDraftValue,
    handleRichTextChange,
  } = props;

  if (!field.localized) {
    return null;
  }

  const rawValue = draftValues ? getValueAtPath(draftValues, fieldPath) : undefined;
  const localizedValue =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : {};
  const fieldId = fieldPath.map(String).join(".");
  const label = getFieldLabel(fieldKey, field);

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
                  readOnly={readOnly}
                  disabled={readOnly}
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
                readOnly={readOnly}
                disabled={readOnly}
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
                readOnly={readOnly}
                disabled={readOnly}
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
