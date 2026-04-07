import { useCallback, useEffect, useMemo, useState } from "react";
import { stringify as stringifyYaml } from "yaml";
import { trpc } from "@/lib/trpc";
import { usePreview } from "@/components/preview/PreviewContext";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { buildAssetFileUrl } from "@/components/asset-explorer/utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  FileCode,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type {
  CmsEntryRecord,
  CmsFieldDefinition,
  CmsModelRecord,
} from "@vivd/shared/cms";
import {
  buildDefaultFieldValue,
  buildRichTextReference,
  type CmsFieldSegment,
  cloneValue,
  collectRichTextSidecars,
  deriveReferenceValue,
  dirnamePosix,
  getAssetPathValue,
  getEntryTitle,
  getValueAtPath,
  resolveRelativePath,
  setAssetPathValue,
  setValueAtPath,
  titleizeKey,
} from "./helpers";

interface CmsPanelProps {
  projectSlug: string;
  version: number;
  onClose: () => void;
}

function formatYaml(value: unknown): string {
  return `${stringifyYaml(value)}\n`;
}

function getFieldLabel(fieldKey: string) {
  return titleizeKey(fieldKey);
}

function getEntryErrorCount(reportErrors: string[], entry: CmsEntryRecord): number {
  return reportErrors.filter((error) => error.includes(entry.relativePath)).length;
}

function getModelErrorCount(reportErrors: string[], model: CmsModelRecord): number {
  return reportErrors.filter(
    (error) =>
      error.includes(model.relativeSchemaPath) ||
      error.includes(model.relativeCollectionRoot),
  ).length;
}

function buildReferenceOptions(
  models: CmsModelRecord[],
  defaultLocale: string,
): Array<{ value: string; label: string }> {
  return models.flatMap((model) =>
    model.entries.map((entry) => ({
      value: `${model.key}:${entry.key}`,
      label: `${model.label} / ${getEntryTitle(entry, model, defaultLocale)}`,
    })),
  );
}

function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isImagePath(path: string): boolean {
  return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(path);
}

export function CmsPanel({ projectSlug, version, onClose }: CmsPanelProps) {
  const {
    handleRefresh,
    setAssetsOpen,
    setEditingTextFile,
    setViewingImagePath,
    setViewingPdfPath,
  } = usePreview();
  const statusQuery = trpc.cms.status.useQuery(undefined, {
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const initMutation = trpc.cms.init.useMutation();
  const scaffoldModelMutation = trpc.cms.scaffoldModel.useMutation();
  const scaffoldEntryMutation = trpc.cms.scaffoldEntry.useMutation();
  const prepareMutation = trpc.cms.prepare.useMutation();
  const saveTextFileMutation = trpc.assets.saveTextFile.useMutation();
  const deleteAssetMutation = trpc.assets.deleteAsset.useMutation();

  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, unknown> | null>(
    null,
  );
  const [sidecarDrafts, setSidecarDrafts] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingSidecars, setLoadingSidecars] = useState(false);
  const [creatingModel, setCreatingModel] = useState(false);
  const [newModelKey, setNewModelKey] = useState("");
  const [creatingEntry, setCreatingEntry] = useState(false);
  const [newEntryKey, setNewEntryKey] = useState("");

  const report = statusQuery.data;
  const defaultLocale = report?.defaultLocale ?? "en";
  const locales = report?.locales.length ? report.locales : [defaultLocale];

  const selectedModel = useMemo(
    () => report?.models.find((model) => model.key === selectedModelKey) ?? null,
    [report, selectedModelKey],
  );
  const selectedEntry = useMemo(
    () =>
      selectedModel?.entries.find((entry) => entry.key === selectedEntryKey) ?? null,
    [selectedEntryKey, selectedModel],
  );
  const referenceOptions = useMemo(
    () => buildReferenceOptions(report?.models ?? [], defaultLocale),
    [defaultLocale, report?.models],
  );

  useEffect(() => {
    if (!report?.models.length) {
      setSelectedModelKey(null);
      return;
    }
    if (selectedModelKey && report.models.some((model) => model.key === selectedModelKey)) {
      return;
    }
    setSelectedModelKey(report.models[0]?.key ?? null);
  }, [report, selectedModelKey]);

  useEffect(() => {
    if (!selectedModel?.entries.length) {
      setSelectedEntryKey(null);
      return;
    }
    if (
      selectedEntryKey &&
      selectedModel.entries.some((entry) => entry.key === selectedEntryKey)
    ) {
      return;
    }
    setSelectedEntryKey(selectedModel.entries[0]?.key ?? null);
  }, [selectedEntryKey, selectedModel]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedModel || !selectedEntry) {
      setDraftValues(null);
      setSidecarDrafts({});
      setIsDirty(false);
      setLoadingSidecars(false);
      return;
    }

    const nextDraft = cloneValue(selectedEntry.values);
    setDraftValues(nextDraft);
    setIsDirty(false);

    const sidecars = collectRichTextSidecars(
      selectedModel.fields,
      nextDraft,
      selectedEntry.relativePath,
    );
    if (sidecars.length === 0) {
      setSidecarDrafts({});
      setLoadingSidecars(false);
      return;
    }

    setLoadingSidecars(true);
    void Promise.all(
      sidecars.map(async (sidecar) => {
        try {
          const response = await fetch(
            buildAssetFileUrl(projectSlug, version, sidecar.filePath),
          );
          if (!response.ok) {
            return [sidecar.pathKey, ""] as const;
          }
          return [sidecar.pathKey, await response.text()] as const;
        } catch {
          return [sidecar.pathKey, ""] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setSidecarDrafts(Object.fromEntries(entries));
      setLoadingSidecars(false);
    });

    return () => {
      cancelled = true;
    };
  }, [projectSlug, version, selectedEntry, selectedModel]);

  const refreshCms = useCallback(async () => {
    await statusQuery.refetch();
  }, [statusQuery]);

  const handlePrepare = useCallback(async () => {
    try {
      const result = await prepareMutation.mutateAsync({
        slug: projectSlug,
        version,
      });
      await refreshCms();
      if (result.built) {
        toast.success("CMS validated and derived data refreshed");
        handleRefresh();
      } else {
        toast.error("CMS validation failed", {
          description: result.error ?? "Fix the reported CMS errors.",
        });
      }
    } catch (error) {
      toast.error("Failed to validate CMS content", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [handleRefresh, prepareMutation, projectSlug, refreshCms, version]);

  const applyDraftValue = useCallback(
    (fieldPath: CmsFieldSegment[], nextValue: unknown) => {
      setDraftValues((current) =>
        current ? setValueAtPath(current, fieldPath, nextValue) : current,
      );
      setIsDirty(true);
    },
    [],
  );

  const handleRichTextChange = useCallback(
    (fieldPath: CmsFieldSegment[], locale: string | null, content: string) => {
      if (!selectedEntry) return;

      const currentValue = getValueAtPath(draftValues, fieldPath);
      let nextReference = "";
      let nextValue: unknown;

      if (locale) {
        const localizedRecord =
          currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
            ? { ...(currentValue as Record<string, unknown>) }
            : {};
        const currentReference = localizedRecord[locale];
        nextReference =
          typeof currentReference === "string" && currentReference.trim()
            ? currentReference
            : buildRichTextReference(fieldPath, locale);
        localizedRecord[locale] = nextReference;
        nextValue = localizedRecord;
      } else {
        nextReference =
          typeof currentValue === "string" && currentValue.trim()
            ? currentValue
            : buildRichTextReference(fieldPath, defaultLocale);
        nextValue = nextReference;
      }

      const resolvedPath = resolveRelativePath(selectedEntry.relativePath, nextReference);
      setSidecarDrafts((current) => ({
        ...current,
        [resolvedPath]: content,
      }));
      applyDraftValue(fieldPath, nextValue);
    },
    [applyDraftValue, defaultLocale, draftValues, selectedEntry],
  );

  const openAssetReference = useCallback(
    (assetPath: string) => {
      if (!selectedEntry || !assetPath.trim()) return;
      const resolvedPath = resolveRelativePath(selectedEntry.relativePath, assetPath);
      if (/\.pdf$/i.test(resolvedPath)) {
        setViewingImagePath(null);
        setViewingPdfPath(resolvedPath);
        return;
      }
      if (isImagePath(resolvedPath)) {
        setViewingPdfPath(null);
        setViewingImagePath(resolvedPath);
        return;
      }
      window.open(buildAssetFileUrl(projectSlug, version, resolvedPath), "_blank");
    },
    [projectSlug, selectedEntry, setViewingImagePath, setViewingPdfPath, version],
  );

  const openExplorer = useCallback(() => {
    setAssetsOpen(true);
    onClose();
  }, [onClose, setAssetsOpen]);

  const handleSaveEntry = useCallback(async () => {
    if (!selectedEntry || !selectedModel || !draftValues) return;

    setIsSaving(true);
    try {
      await saveTextFileMutation.mutateAsync({
        slug: projectSlug,
        version,
        relativePath: selectedEntry.relativePath,
        content: formatYaml(draftValues),
      });

      const sidecars = collectRichTextSidecars(
        selectedModel.fields,
        draftValues,
        selectedEntry.relativePath,
      );
      await Promise.all(
        sidecars.map((sidecar) =>
          saveTextFileMutation.mutateAsync({
            slug: projectSlug,
            version,
            relativePath: sidecar.filePath,
            content: sidecarDrafts[sidecar.filePath] ?? "",
          }),
        ),
      );

      const result = await prepareMutation.mutateAsync({
        slug: projectSlug,
        version,
      });
      await refreshCms();
      if (result.built) {
        toast.success("CMS entry saved");
        handleRefresh();
      } else {
        toast.error("CMS saved with validation issues", {
          description: result.error ?? "Fix the reported CMS errors.",
        });
      }
      setIsDirty(false);
    } catch (error) {
      toast.error("Failed to save CMS entry", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    draftValues,
    handleRefresh,
    prepareMutation,
    projectSlug,
    refreshCms,
    saveTextFileMutation,
    selectedEntry,
    selectedModel,
    sidecarDrafts,
    version,
  ]);

  const handleDeleteEntry = useCallback(async () => {
    if (!selectedEntry) return;
    const confirmed = window.confirm(
      `Delete "${selectedEntry.key}" from this collection?`,
    );
    if (!confirmed) return;

    try {
      await deleteAssetMutation.mutateAsync({
        slug: projectSlug,
        version,
        relativePath: dirnamePosix(selectedEntry.relativePath),
      });
      await handlePrepare();
      setSelectedEntryKey(null);
      toast.success("CMS entry deleted");
    } catch (error) {
      toast.error("Failed to delete CMS entry", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    deleteAssetMutation,
    handlePrepare,
    projectSlug,
    selectedEntry,
    version,
  ]);

  const handleMoveEntry = useCallback(
    async (direction: -1 | 1) => {
      if (!selectedModel || !selectedEntry) return;
      if (isDirty) {
        const proceed = window.confirm(
          "You have unsaved entry changes. Reordering will use the last saved values. Continue?",
        );
        if (!proceed) return;
      }

      const currentIndex = selectedModel.entries.findIndex(
        (entry) => entry.key === selectedEntry.key,
      );
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= selectedModel.entries.length) {
        return;
      }

      const reordered = [...selectedModel.entries];
      const [movedEntry] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, movedEntry);

      try {
        setIsSaving(true);
        await Promise.all(
          reordered.map((entry, index) =>
            saveTextFileMutation.mutateAsync({
              slug: projectSlug,
              version,
              relativePath: entry.relativePath,
              content: formatYaml({
                ...entry.values,
                sortOrder: index,
              }),
            }),
          ),
        );
        await handlePrepare();
        setSelectedEntryKey(selectedEntry.key);
        toast.success("Collection order updated");
      } catch (error) {
        toast.error("Failed to reorder entries", {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsSaving(false);
      }
    },
    [
      handlePrepare,
      isDirty,
      projectSlug,
      saveTextFileMutation,
      selectedEntry,
      selectedModel,
      version,
    ],
  );

  const handleCreateModel = useCallback(async () => {
    const modelKey = newModelKey.trim();
    if (!modelKey) return;
    try {
      const result = await scaffoldModelMutation.mutateAsync({
        slug: projectSlug,
        version,
        modelKey,
      });
      await refreshCms();
      setSelectedModelKey(modelKey.toLowerCase());
      setCreatingModel(false);
      setNewModelKey("");
      if (result.built) {
        toast.success("Collection scaffolded");
      } else {
        toast.error("Collection scaffolded with validation issues", {
          description: result.error ?? undefined,
        });
      }
    } catch (error) {
      toast.error("Failed to create collection", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [newModelKey, projectSlug, refreshCms, scaffoldModelMutation, version]);

  const handleCreateEntry = useCallback(async () => {
    if (!selectedModel) return;
    const entryKey = newEntryKey.trim();
    if (!entryKey) return;
    try {
      const result = await scaffoldEntryMutation.mutateAsync({
        slug: projectSlug,
        version,
        modelKey: selectedModel.key,
        entryKey,
      });
      await refreshCms();
      setSelectedEntryKey(entryKey.toLowerCase());
      setCreatingEntry(false);
      setNewEntryKey("");
      if (result.built) {
        toast.success("Entry scaffolded");
      } else {
        toast.error("Entry scaffolded with validation issues", {
          description: result.error ?? undefined,
        });
      }
    } catch (error) {
      toast.error("Failed to create entry", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    newEntryKey,
    projectSlug,
    refreshCms,
    scaffoldEntryMutation,
    selectedModel,
    version,
  ]);

  const renderField = useCallback(
    (
      fieldKey: string,
      field: CmsFieldDefinition,
      fieldPath: CmsFieldSegment[],
    ) => {
      const rawValue = draftValues ? getValueAtPath(draftValues, fieldPath) : undefined;
      const fieldId = fieldPath.map(String).join(".");
      const label = getFieldLabel(fieldKey);

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
                    relativeValue && selectedEntry
                      ? resolveRelativePath(selectedEntry.relativePath, relativeValue)
                      : selectedEntry
                        ? resolveRelativePath(
                            selectedEntry.relativePath,
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

      if (field.type === "string" || field.type === "slug" || field.type === "date" || field.type === "datetime") {
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
        const assetPath = getAssetPathValue(rawValue);
        return (
          <div key={fieldId} className="space-y-2 rounded-lg border border-border/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor={fieldId}>{label}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Store a path under <code>src/content/media/</code>.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openExplorer()}
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                Explorer
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                id={fieldId}
                value={assetPath}
                onChange={(event) =>
                  applyDraftValue(
                    fieldPath,
                    setAssetPathValue(rawValue, event.target.value),
                  )
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!assetPath.trim()}
                onClick={() => openAssetReference(assetPath)}
              >
                Open
              </Button>
            </div>
          </div>
        );
      }

      if (field.type === "assetList") {
        const items = ensureArray(rawValue);
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
              {items.map((item, index) => {
                const itemPath = getAssetPathValue(item);
                return (
                  <div key={`${fieldId}.${index}`} className="flex gap-2">
                    <Input
                      value={itemPath}
                      onChange={(event) => {
                        const nextItems = [...items];
                        nextItems[index] = setAssetPathValue(item, event.target.value);
                        applyDraftValue(fieldPath, nextItems);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!itemPath.trim()}
                      onClick={() => openAssetReference(itemPath)}
                    >
                      Open
                    </Button>
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
                );
              })}
            </div>
          </div>
        );
      }

      if (field.type === "object") {
        return (
          <div key={fieldId} className="space-y-3 rounded-lg border border-border/60 p-4">
            <div>
              <Label className="text-sm font-medium">{label}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Nested structured fields.
              </p>
            </div>
            <div className="space-y-4">
              {Object.entries(field.fields ?? {}).map(([nestedKey, nestedField]) =>
                renderField(nestedKey, nestedField, [...fieldPath, nestedKey]),
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
                onClick={() =>
                  applyDraftValue(fieldPath, [
                    ...items,
                    buildDefaultFieldValue(fieldKey, field.item ?? { type: "string" }, defaultLocale),
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
                        {Object.entries(field.item.fields ?? {}).map(
                          ([nestedKey, nestedField]) =>
                            renderField(nestedKey, nestedField, [
                              ...fieldPath,
                              index,
                              nestedKey,
                            ]),
                        )}
                      </div>
                    ) : (
                      renderField(`${fieldKey}-${index}`, field.item, [...fieldPath, index])
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
    },
    [
      applyDraftValue,
      defaultLocale,
      draftValues,
      locales,
      openAssetReference,
      openExplorer,
      referenceOptions,
      selectedEntry,
      sidecarDrafts,
      handleRichTextChange,
    ],
  );

  if (statusQuery.isLoading) {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading CMS…
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-background">
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            CMS status could not be loaded.
          </p>
          <Button variant="outline" onClick={() => refreshCms()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const busy =
    isSaving ||
    loadingSidecars ||
    initMutation.isPending ||
    scaffoldModelMutation.isPending ||
    scaffoldEntryMutation.isPending ||
    prepareMutation.isPending ||
    saveTextFileMutation.isPending ||
    deleteAssetMutation.isPending;

  return (
    <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Content</h2>
            {report.initialized ? (
              report.valid ? (
                <Badge variant="success">Ready</Badge>
              ) : (
                <Badge variant="destructive">{report.errors.length} issue(s)</Badge>
              )
            ) : (
              <Badge variant="outline">Not initialized</Badge>
            )}
            <Badge variant="outline">
              {report.modelCount} collection{report.modelCount === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">
              {report.entryCount} entr{report.entryCount === 1 ? "y" : "ies"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Schema-rendered collection editing for <code>src/content/</code>.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {report.initialized ? (
            <>
              <Button variant="outline" size="sm" onClick={openExplorer}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Explorer
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={prepareMutation.isPending}
                onClick={() => handlePrepare()}
              >
                <RefreshCw
                  className={cn("mr-2 h-4 w-4", prepareMutation.isPending && "animate-spin")}
                />
                Validate & refresh
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={initMutation.isPending}
              onClick={async () => {
                try {
                  const result = await initMutation.mutateAsync({
                    slug: projectSlug,
                    version,
                  });
                  await refreshCms();
                  if (result.built) {
                    toast.success("CMS scaffold created");
                  } else {
                    toast.error("CMS scaffold created with validation issues", {
                      description: result.error ?? undefined,
                    });
                  }
                } catch (error) {
                  toast.error("Failed to initialize CMS", {
                    description: error instanceof Error ? error.message : String(error),
                  });
                }
              }}
            >
              {initMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Initialize CMS
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!report.initialized ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-lg space-y-4 rounded-xl border border-dashed border-border/70 p-6 text-center">
            <div className="inline-flex rounded-full bg-muted p-3">
              <FileCode className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">CMS scaffold not found</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Create the default <code>src/content/</code> structure to start
                managing collection content in Studio.
              </p>
            </div>
            <Button
              disabled={initMutation.isPending}
              onClick={async () => {
                try {
                  const result = await initMutation.mutateAsync({
                    slug: projectSlug,
                    version,
                  });
                  await refreshCms();
                  if (result.built) {
                    toast.success("CMS scaffold created");
                  } else {
                    toast.error("CMS scaffold created with validation issues", {
                      description: result.error ?? undefined,
                    });
                  }
                } catch (error) {
                  toast.error("Failed to initialize CMS", {
                    description: error instanceof Error ? error.message : String(error),
                  });
                }
              }}
            >
              {initMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Initialize CMS
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[260px] min-w-[260px] flex-col border-r">
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">Collections</h3>
                <p className="text-xs text-muted-foreground">
                  Schema-authored content models
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreatingModel((current) => !current)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>
            {creatingModel ? (
              <div className="space-y-2 border-t px-4 py-3">
                <Label htmlFor="new-model-key">Collection key</Label>
                <Input
                  id="new-model-key"
                  value={newModelKey}
                  onChange={(event) => setNewModelKey(event.target.value)}
                  placeholder="products"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={scaffoldModelMutation.isPending}
                    onClick={() => void handleCreateModel()}
                  >
                    Create
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCreatingModel(false);
                      setNewModelKey("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            <ScrollArea className="flex-1">
              <div className="space-y-1 p-2">
                {report.models.map((model) => {
                  const active = model.key === selectedModelKey;
                  const errorCount = getModelErrorCount(report.errors, model);
                  return (
                    <button
                      key={model.key}
                      type="button"
                      onClick={() => setSelectedModelKey(model.key)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors",
                        active
                          ? "border-primary/40 bg-primary/5"
                          : "border-transparent hover:border-border hover:bg-muted/40",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{model.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {model.entries.length} entries
                        </p>
                      </div>
                      {errorCount > 0 ? (
                        <Badge variant="destructive">{errorCount}</Badge>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="flex w-[320px] min-w-[320px] flex-col border-r">
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">
                  {selectedModel?.label ?? "Entries"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Active and inactive collection items
                </p>
              </div>
              {selectedModel ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreatingEntry((current) => !current)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add
                </Button>
              ) : null}
            </div>
            {creatingEntry && selectedModel ? (
              <div className="space-y-2 border-t px-4 py-3">
                <Label htmlFor="new-entry-key">Entry key</Label>
                <Input
                  id="new-entry-key"
                  value={newEntryKey}
                  onChange={(event) => setNewEntryKey(event.target.value)}
                  placeholder="alpine-boot"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={scaffoldEntryMutation.isPending}
                    onClick={() => void handleCreateEntry()}
                  >
                    Create
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCreatingEntry(false);
                      setNewEntryKey("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            <ScrollArea className="flex-1">
              <div className="space-y-2 p-2">
                {selectedModel?.entries.length ? (
                  selectedModel.entries.map((entry) => {
                    const active = entry.key === selectedEntryKey;
                    const errorCount = getEntryErrorCount(report.errors, entry);
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        onClick={() => setSelectedEntryKey(entry.key)}
                        className={cn(
                          "flex w-full items-start justify-between rounded-lg border px-3 py-3 text-left transition-colors",
                          active
                            ? "border-primary/40 bg-primary/5"
                            : "border-transparent hover:border-border hover:bg-muted/40",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {getEntryTitle(entry, selectedModel, defaultLocale)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {entry.key}
                          </p>
                          <div className="mt-2 flex gap-2">
                            <Badge
                              variant={entry.status === "inactive" ? "outline" : "success"}
                            >
                              {entry.status ?? "active"}
                            </Badge>
                            {typeof entry.sortOrder === "number" ? (
                              <Badge variant="outline">#{entry.sortOrder}</Badge>
                            ) : null}
                          </div>
                        </div>
                        {errorCount > 0 ? (
                          <Badge variant="destructive">{errorCount}</Badge>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    {selectedModel
                      ? "No entries yet."
                      : "Add a collection to begin."}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {selectedModel && selectedEntry && draftValues ? (
              <>
                <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">
                        {getEntryTitle(selectedEntry, selectedModel, defaultLocale)}
                      </h3>
                      {isDirty ? <Badge variant="outline">Unsaved</Badge> : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {selectedEntry.key} · {selectedEntry.relativePath}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleMoveEntry(-1)}
                      disabled={
                        busy ||
                        selectedModel.entries.findIndex(
                          (entry) => entry.key === selectedEntry.key,
                        ) <= 0
                      }
                    >
                      <ArrowUp className="mr-2 h-4 w-4" />
                      Up
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleMoveEntry(1)}
                      disabled={
                        busy ||
                        selectedModel.entries.findIndex(
                          (entry) => entry.key === selectedEntry.key,
                        ) >=
                          selectedModel.entries.length - 1
                      }
                    >
                      <ArrowDown className="mr-2 h-4 w-4" />
                      Down
                    </Button>
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
                      Raw YAML
                    </Button>
                    <Button
                      size="sm"
                      disabled={!isDirty || busy}
                      onClick={() => void handleSaveEntry()}
                    >
                      {isSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleDeleteEntry()}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="space-y-5 px-5 py-5">
                    {loadingSidecars ? (
                      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading Markdown sidecars…
                      </div>
                    ) : null}

                    {Object.entries(selectedModel.fields).map(([fieldKey, field]) =>
                      renderField(fieldKey, field, [fieldKey]),
                    )}

                    {report.errors.length > 0 ? (
                      <>
                        <Separator />
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-destructive" />
                            <h4 className="text-sm font-semibold">Validation</h4>
                          </div>
                          <div className="space-y-2">
                            {report.errors.slice(0, 12).map((error) => (
                              <div
                                key={error}
                                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
                              >
                                {error}
                              </div>
                            ))}
                            {report.errors.length > 12 ? (
                              <p className="text-xs text-muted-foreground">
                                Showing 12 of {report.errors.length} issues.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6">
                <div className="max-w-md space-y-3 text-center">
                  <h3 className="text-lg font-semibold">Select a collection entry</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose a collection and entry to edit its structured content.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
