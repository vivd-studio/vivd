import type { CmsFieldDefinition, CmsModelRecord } from "@vivd/shared/cms";
import {
  inferAssetStorageFromValue,
  type CmsAssetStorageKind,
  type CmsFieldSegment,
  titleizeKey,
} from "./helpers";

export interface CmsFieldRendererProps {
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
  activeLocale?: string | null;
  readOnly?: boolean;
  referenceOptions: Array<{
    value: string;
    label: string;
    modelKey: string;
    entryKey: string;
  }>;
  applyDraftValue: (fieldPath: CmsFieldSegment[], nextValue: unknown) => void;
  handleRichTextChange: (
    fieldPath: CmsFieldSegment[],
    locale: string | null,
    content: string,
  ) => void;
  openAssetReference: (assetPath: string) => void;
  openExplorer: () => void;
}

export interface CmsAssetFieldPaths {
  storageKind: CmsAssetStorageKind;
  assetRootPath: string;
  defaultFolderPath: string;
}

export function getFieldLabel(fieldKey: string, field: CmsFieldDefinition) {
  return field.label?.trim() || titleizeKey(fieldKey);
}

export function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function getAssetFieldPaths(
  selectedModel: CmsModelRecord | null,
  selectedEntryKey: string | null,
  value?: unknown,
): CmsAssetFieldPaths | null {
  if (!selectedModel || !selectedEntryKey) {
    return null;
  }

  const inferredStorage = inferAssetStorageFromValue(value);
  if (inferredStorage) {
    return inferredStorage;
  }

  const mediaRootPath = "src/content/media";
  return {
    storageKind: "content-media",
    assetRootPath: mediaRootPath,
    defaultFolderPath: `${mediaRootPath}/${selectedModel.key}/${selectedEntryKey}`,
  };
}
