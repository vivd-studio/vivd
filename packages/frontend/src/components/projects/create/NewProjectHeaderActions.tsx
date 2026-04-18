import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Globe, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { urlFormSchema, normalizeUrl } from "@/lib/form-schemas";
import type { UrlFormValues } from "@/lib/form-schemas";
import { importProjectZip } from "@/lib/import-utils";
import { ROUTES } from "@/app/router";
import { Button, Input, Form, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vivd/ui";

import { VersionDialog } from "../versioning/VersionDialog";
import { UrlFormFields } from "./UrlFormFields";

type HeaderActionMode = "url" | "import" | null;

interface ExistsData {
  slug: string;
  currentVersion: number;
  totalVersions: number;
}

function buildProjectTarget(slug: string, version?: number): string {
  if (version && Number.isFinite(version) && version > 0) {
    return `${ROUTES.PROJECT(slug)}?version=${version}`;
  }
  return ROUTES.PROJECT(slug);
}

export function NewProjectHeaderActions() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<HeaderActionMode>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [existsData, setExistsData] = useState<ExistsData | null>(null);
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const { data: membership } = trpc.organization.getMyMembership.useQuery();

  const form = useForm<UrlFormValues>({
    resolver: zodResolver(urlFormSchema),
    defaultValues: {
      url: "",
      disclaimer: false,
    },
  });

  const resetTransientState = () => {
    setPendingUrl(null);
    setExistsData(null);
    setImportFile(null);
    setIsImporting(false);
    form.reset();
  };

  const closeDialog = () => {
    setMode(null);
    resetTransientState();
  };

  const generateMutation = trpc.project.generate.useMutation({
    onError: (error) => {
      form.setError("root", {
        message: error.message || "Failed to start generation",
      });
    },
    onSuccess: (data) => {
      if (data.status === "exists") {
        const existsResponse = data as {
          slug: string;
          currentVersion: number;
          totalVersions: number;
        };
        setExistsData({
          slug: existsResponse.slug,
          currentVersion: existsResponse.currentVersion || 1,
          totalVersions: existsResponse.totalVersions || 1,
        });
        setIsVersionDialogOpen(true);
        return;
      }

      if (data.slug) {
        const processingResponse = data as { slug: string; version?: number };
        closeDialog();
        navigate(
          buildProjectTarget(
            processingResponse.slug,
            processingResponse.version,
          ),
        );
      }
    },
  });

  const regenerateMutation = trpc.project.regenerate.useMutation({
    onError: (error) => {
      form.setError("root", {
        message: error.message || "Failed to regenerate",
      });
    },
    onSuccess: (data) => {
      closeDialog();
      navigate(buildProjectTarget(data.slug, data.version));
    },
  });

  const handleCreateNewVersion = async () => {
    if (!pendingUrl) return;
    setIsVersionDialogOpen(false);
    await generateMutation.mutateAsync({ url: pendingUrl, createNewVersion: true });
  };

  const handleOverwriteCurrent = async () => {
    if (!existsData) return;
    setIsVersionDialogOpen(false);
    await regenerateMutation.mutateAsync({
      slug: existsData.slug,
      version: existsData.currentVersion,
    });
  };

  const onUrlSubmit = async (data: UrlFormValues) => {
    const urlToSubmit = normalizeUrl(data.url);
    setPendingUrl(urlToSubmit);
    await generateMutation.mutateAsync({
      url: urlToSubmit,
      heroHint: data.heroHint || undefined,
      htmlHint: data.htmlHint || undefined,
    });
  };

  const handleImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    try {
      const result = await importProjectZip(importFile, {
        organizationId: membership?.organizationId,
      });
      closeDialog();
      navigate(buildProjectTarget(result.slug, result.version));
      toast.success("Project imported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 rounded-[14px] border border-border/50 bg-background/34 p-1 shadow-[0_18px_50px_hsl(var(--background)/0.28)] backdrop-blur-xl">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 rounded-[10px] border border-transparent bg-card/48 px-3.5 text-[13px] font-medium text-foreground/92 shadow-[0_12px_30px_hsl(var(--background)/0.16)] hover:border-primary/18 hover:bg-card/76 hover:text-foreground"
          onClick={() => {
            resetTransientState();
            setMode("url");
          }}
        >
          <Globe className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">From website</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 rounded-[10px] border border-transparent bg-card/48 px-3.5 text-[13px] font-medium text-foreground/92 shadow-[0_12px_30px_hsl(var(--background)/0.16)] hover:border-primary/18 hover:bg-card/76 hover:text-foreground"
          onClick={() => {
            resetTransientState();
            setMode("import");
          }}
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Import ZIP</span>
        </Button>
      </div>

      <Dialog open={mode === "url"} onOpenChange={(open) => (!open ? closeDialog() : setMode("url"))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Start from existing website</DialogTitle>
            <DialogDescription>
              Paste a public URL and Vivd will analyze it into a new project draft.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onUrlSubmit)} className="space-y-4">
              <UrlFormFields form={form} />

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={generateMutation.isPending || regenerateMutation.isPending}
                >
                  {generateMutation.isPending || regenerateMutation.isPending
                    ? "Starting..."
                    : "Generate"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mode === "import"}
        onOpenChange={(open) => (!open ? closeDialog() : setMode("import"))}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import from ZIP</DialogTitle>
            <DialogDescription>
              Upload a project ZIP that was previously exported from Vivd.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                disabled={isImporting}
              />
              <div className="text-xs text-muted-foreground">
                Max 100MB. The imported project will be created as a new project.
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={closeDialog}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={!importFile || isImporting}>
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  "Import"
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <VersionDialog
        open={isVersionDialogOpen}
        onOpenChange={setIsVersionDialogOpen}
        onCreateNewVersion={handleCreateNewVersion}
        onOverwriteCurrent={handleOverwriteCurrent}
        projectName={existsData?.slug}
        currentVersion={existsData?.currentVersion || 1}
        totalVersions={existsData?.totalVersions || 1}
      />
    </>
  );
}
