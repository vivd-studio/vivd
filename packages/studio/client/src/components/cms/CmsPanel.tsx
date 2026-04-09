import { useCallback, useEffect, useMemo, useState } from "react";
import { stringify as stringifyYaml } from "yaml";
import { trpc } from "@/lib/trpc";
import { usePreview } from "@/components/preview/PreviewContext";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildAssetFileUrl } from "@/components/asset-explorer/utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  FileCode,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import type { CmsModelRecord } from "@vivd/shared/cms";
import {
  buildRichTextReference,
  type CmsFieldSegment,
  cloneValue,
  collectRichTextSidecars,
  getEntryTitle,
  getValueAtPath,
  resolveRelativePath,
  setValueAtPath,
} from "./helpers";
import { CmsCollectionsSidebar } from "./CmsCollectionsSidebar";
import { CmsEntriesSidebar } from "./CmsEntriesSidebar";
import { CmsEntryEditor } from "./CmsEntryEditor";

interface CmsPanelProps {
  projectSlug: string;
  version: number;
  onClose: () => void;
}

function formatYaml(value: unknown): string {
  return `${stringifyYaml(value)}\n`;
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
  const { canUseAiImages } = usePermissions();
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
        relativePath: selectedEntry.deletePath,
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
      const sortField = selectedModel.sortField ?? "sortOrder";

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
                [sortField]: index,
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
          <CmsCollectionsSidebar
            models={report.models}
            reportErrors={report.errors}
            selectedModelKey={selectedModelKey}
            creatingModel={creatingModel}
            newModelKey={newModelKey}
            isScaffoldingModel={scaffoldModelMutation.isPending}
            onToggleCreateModel={() => setCreatingModel((current) => !current)}
            onNewModelKeyChange={setNewModelKey}
            onCreateModel={() => void handleCreateModel()}
            onCancelCreateModel={() => {
              setCreatingModel(false);
              setNewModelKey("");
            }}
            onSelectModel={setSelectedModelKey}
          />

          <CmsEntriesSidebar
            selectedModel={selectedModel}
            selectedEntryKey={selectedEntryKey}
            defaultLocale={defaultLocale}
            reportErrors={report.errors}
            creatingEntry={creatingEntry}
            newEntryKey={newEntryKey}
            isScaffoldingEntry={scaffoldEntryMutation.isPending}
            onToggleCreateEntry={() => setCreatingEntry((current) => !current)}
            onNewEntryKeyChange={setNewEntryKey}
            onCreateEntry={() => void handleCreateEntry()}
            onCancelCreateEntry={() => {
              setCreatingEntry(false);
              setNewEntryKey("");
            }}
            onSelectEntry={setSelectedEntryKey}
          />

          <CmsEntryEditor
            projectSlug={projectSlug}
            version={version}
            selectedModel={selectedModel}
            selectedEntryKey={selectedEntryKey}
            draftValues={draftValues}
            defaultLocale={defaultLocale}
            locales={locales}
            sidecarDrafts={sidecarDrafts}
            canUseAiImages={canUseAiImages}
            referenceOptions={referenceOptions}
            reportErrors={report.errors}
            isDirty={isDirty}
            busy={busy}
            isSaving={isSaving}
            loadingSidecars={loadingSidecars}
            setEditingTextFile={setEditingTextFile}
            applyDraftValue={applyDraftValue}
            handleRichTextChange={handleRichTextChange}
            openAssetReference={openAssetReference}
            openExplorer={openExplorer}
            onMoveEntry={handleMoveEntry}
            onSaveEntry={() => void handleSaveEntry()}
            onDeleteEntry={() => void handleDeleteEntry()}
          />
        </div>
      )}
    </div>
  );
}
