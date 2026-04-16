import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CmsAssetField } from "./CmsAssetField";
import {
  buildRichTextReference,
  getLocalizedFieldLocales,
  inferAssetAcceptsForValues,
  getValueAtPath,
  resolveAssetReferencePath,
} from "./helpers";
import {
  getAssetFieldPaths,
  getFieldLabel,
  type CmsFieldRendererProps,
} from "./CmsFieldRenderer.shared";

export function CmsFieldRendererLocalized(props: CmsFieldRendererProps) {
  const {
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
    activeLocale,
    readOnly = false,
    applyDraftValue,
    handleRichTextChange,
    openAssetReference,
  } = props;

  if (!field.localized) {
    return null;
  }

  const rawValue = draftValues ? getValueAtPath(draftValues, fieldPath) : undefined;
  const localizedValue =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : {};
  const allLocales = getLocalizedFieldLocales(
    locales,
    defaultLocale,
    localizedValue,
  );
  const localizedFieldLocales =
    activeLocale && allLocales.includes(activeLocale)
      ? [activeLocale]
      : allLocales;
  const fieldId = fieldPath.map(String).join(".");
  const label = getFieldLabel(fieldKey, field);
  const assetPaths = getAssetFieldPaths(selectedModel, selectedEntryKey, localizedValue);
  const localizedAssetAccepts =
    field.type === "string"
      ? ((field.accepts?.length ? field.accepts : inferAssetAcceptsForValues(Object.values(localizedValue))) ??
        null)
      : null;

  if (field.type === "richText" && field.storage === "sidecar-markdown") {
    return (
      <div key={fieldId} className="space-y-3 rounded-lg border border-border/60 p-4">
        <div>
          <Label className="text-sm font-medium">{label}</Label>
          {localizedFieldLocales.length > 1 ? (
            <p className="mt-1 text-xs text-muted-foreground">Multilingual</p>
          ) : null}
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {localizedFieldLocales.map((locale) => {
            const relativeValue =
              typeof localizedValue[locale] === "string"
                ? (localizedValue[locale] as string)
                : "";
            const filePath =
              relativeValue && selectedEntryRelativePath
                ? resolveAssetReferencePath(selectedEntryRelativePath, relativeValue)
                : selectedEntryRelativePath
                  ? resolveAssetReferencePath(
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

  if (localizedAssetAccepts?.length && selectedEntryRelativePath && assetPaths) {
    return (
      <div key={fieldId} className="space-y-3 rounded-lg border border-border/60 p-4">
        <div>
          <Label className="text-sm font-medium">{label}</Label>
          {localizedFieldLocales.length > 1 ? (
            <p className="mt-1 text-xs text-muted-foreground">Multilingual</p>
          ) : null}
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {localizedFieldLocales.map((locale) => (
            <CmsAssetField
              key={`${fieldId}.${locale}`}
              projectSlug={props.projectSlug}
              version={props.version}
              fieldId={`${fieldId}.${locale}`}
              label={locale.toUpperCase()}
              field={{
                ...field,
                type: "asset",
                accepts: localizedAssetAccepts,
              }}
              value={localizedValue[locale]}
              entryRelativePath={selectedEntryRelativePath}
              storageKind={assetPaths.storageKind}
              assetRootPath={assetPaths.assetRootPath}
              defaultFolderPath={assetPaths.defaultFolderPath}
              canUseAiImages={canUseAiImages}
              readOnly={readOnly}
              onChange={(nextValue) =>
                applyDraftValue(fieldPath, {
                  ...localizedValue,
                  [locale]: nextValue,
                })
              }
              onOpenAsset={openAssetReference}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div key={fieldId} className="space-y-3 rounded-lg border border-border/60 p-4">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {allLocales.length > 1 ? (
          <p className="mt-1 text-xs text-muted-foreground">Multilingual</p>
        ) : null}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {localizedFieldLocales.map((locale) => (
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
