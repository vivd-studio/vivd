import { Plus, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { CmsFieldDefinition } from "@vivd/shared/cms";
import { CmsAssetField } from "./CmsAssetField";
import {
  inferStringFieldAssetAccepts,
  inferStringListFieldAssetAccepts,
  getValueAtPath,
  type CmsAssetStorageKind,
} from "./helpers";
import {
  ensureArray,
  getAssetFieldPaths,
  getFieldLabel,
  type CmsFieldRendererProps,
} from "./CmsFieldRenderer.shared";

function CmsAssetListSection(props: {
  fieldId: string;
  label: string;
  items: unknown[];
  projectSlug: string;
  version: number;
  field: CmsFieldDefinition;
  fieldPath: CmsFieldRendererProps["fieldPath"];
  entryRelativePath: string;
  storageKind: CmsAssetStorageKind;
  assetRootPath: string;
  defaultFolderPath: string;
  canUseAiImages: boolean;
  readOnly: boolean;
  openExplorer: () => void;
  applyDraftValue: CmsFieldRendererProps["applyDraftValue"];
  openAssetReference: CmsFieldRendererProps["openAssetReference"];
  createNewItem: (items: unknown[]) => unknown;
}) {
  const {
    fieldId,
    label,
    items,
    projectSlug,
    version,
    field,
    fieldPath,
    entryRelativePath,
    storageKind,
    assetRootPath,
    defaultFolderPath,
    canUseAiImages,
    readOnly,
    openExplorer,
    applyDraftValue,
    openAssetReference,
    createNewItem,
  } = props;

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
          <Button variant="outline" size="sm" onClick={openExplorer} disabled={readOnly}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Explorer
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={readOnly}
            onClick={() => applyDraftValue(fieldPath, [...items, createNewItem(items)])}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add asset
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">No assets yet.</p> : null}
        {items.map((item, index) => (
          <div key={`${fieldId}.${index}`} className="space-y-2">
            <CmsAssetField
              projectSlug={projectSlug}
              version={version}
              fieldId={`${fieldId}.${index}`}
              label={`${label} ${index + 1}`}
              field={{ ...field, type: "asset" }}
              value={item}
              entryRelativePath={entryRelativePath}
              storageKind={storageKind}
              assetRootPath={assetRootPath}
              defaultFolderPath={defaultFolderPath}
              canUseAiImages={canUseAiImages}
              readOnly={readOnly}
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
                disabled={readOnly}
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

export function CmsFieldRendererAssetFields(props: CmsFieldRendererProps) {
  const {
    projectSlug,
    version,
    fieldKey,
    field,
    fieldPath,
    draftValues,
    selectedEntryRelativePath,
    selectedEntryKey,
    selectedModel,
    canUseAiImages,
    readOnly = false,
    applyDraftValue,
    openAssetReference,
    openExplorer,
  } = props;

  const rawValue = draftValues ? getValueAtPath(draftValues, fieldPath) : undefined;
  const fieldId = fieldPath.map(String).join(".");
  const label = getFieldLabel(fieldKey, field);
  const assetPaths = getAssetFieldPaths(selectedModel, selectedEntryKey, rawValue);
  const inferredStringAssetAccepts = inferStringFieldAssetAccepts(
    fieldKey,
    field,
    rawValue,
  );
  const inferredStringListAssetAccepts = inferStringListFieldAssetAccepts(
    fieldKey,
    field,
    rawValue,
  );

  if (inferredStringAssetAccepts?.length) {
    if (!selectedEntryRelativePath || !assetPaths) {
      return null;
    }

    return (
      <CmsAssetField
        key={fieldId}
        projectSlug={projectSlug}
        version={version}
        fieldId={fieldId}
        label={label}
        field={{
          ...field,
          type: "asset",
          accepts: inferredStringAssetAccepts,
        }}
        value={rawValue}
        entryRelativePath={selectedEntryRelativePath}
        storageKind={assetPaths.storageKind}
        assetRootPath={assetPaths.assetRootPath}
        defaultFolderPath={assetPaths.defaultFolderPath}
        canUseAiImages={canUseAiImages}
        readOnly={readOnly}
        onChange={(nextValue) => applyDraftValue(fieldPath, nextValue)}
        onOpenAsset={openAssetReference}
      />
    );
  }

  if (field.type === "asset") {
    if (!selectedEntryRelativePath || !assetPaths) {
      return null;
    }

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
        storageKind={assetPaths.storageKind}
        assetRootPath={assetPaths.assetRootPath}
        defaultFolderPath={assetPaths.defaultFolderPath}
        canUseAiImages={canUseAiImages}
        readOnly={readOnly}
        onChange={(nextValue) => applyDraftValue(fieldPath, nextValue)}
        onOpenAsset={openAssetReference}
      />
    );
  }

  if (field.type === "assetList") {
    if (!selectedEntryRelativePath || !assetPaths) {
      return null;
    }

    const items = ensureArray(rawValue);
    return (
      <CmsAssetListSection
        fieldId={fieldId}
        label={label}
        items={items}
        projectSlug={projectSlug}
        version={version}
        field={field}
        fieldPath={fieldPath}
        entryRelativePath={selectedEntryRelativePath}
        storageKind={assetPaths.storageKind}
        assetRootPath={assetPaths.assetRootPath}
        defaultFolderPath={assetPaths.defaultFolderPath}
        canUseAiImages={canUseAiImages}
        readOnly={readOnly}
        openExplorer={openExplorer}
        applyDraftValue={applyDraftValue}
        openAssetReference={openAssetReference}
        createNewItem={(currentItems) =>
          currentItems[0] && typeof currentItems[0] === "object" && !Array.isArray(currentItems[0])
            ? { ...(currentItems[0] as Record<string, unknown>), path: "" }
            : ""
        }
      />
    );
  }

  if (inferredStringListAssetAccepts?.length) {
    if (!selectedEntryRelativePath || !assetPaths) {
      return null;
    }

    const items = ensureArray(rawValue);
    return (
      <CmsAssetListSection
        fieldId={fieldId}
        label={label}
        items={items}
        projectSlug={projectSlug}
        version={version}
        field={{
          ...field,
          type: "assetList",
          accepts: inferredStringListAssetAccepts,
          item: undefined,
        }}
        fieldPath={fieldPath}
        entryRelativePath={selectedEntryRelativePath}
        storageKind={assetPaths.storageKind}
        assetRootPath={assetPaths.assetRootPath}
        defaultFolderPath={assetPaths.defaultFolderPath}
        canUseAiImages={canUseAiImages}
        readOnly={readOnly}
        openExplorer={openExplorer}
        applyDraftValue={applyDraftValue}
        openAssetReference={openAssetReference}
        createNewItem={() => ""}
      />
    );
  }

  return null;
}
