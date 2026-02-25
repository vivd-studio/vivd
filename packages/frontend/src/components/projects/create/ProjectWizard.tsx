import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc";
import { urlFormSchema, normalizeUrl } from "@/lib/form-schemas";
import type { UrlFormValues } from "@/lib/form-schemas";
import { importProjectZip } from "@/lib/import-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form } from "@/components/ui/form";
import { InteractiveSurfaceButton } from "@/components/ui/interactive-surface";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VersionDialog } from "../versioning/VersionDialog";
import { UrlFormFields } from "./UrlFormFields";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Globe, Sparkles, ArrowLeft, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";

type WizardStep = "choice" | "scratch" | "url" | "import";

interface ProjectWizardProps {
  onGenerationStarted: (slug: string, version?: number) => void;
}

interface ExistsData {
  slug: string;
  currentVersion: number;
  totalVersions: number;
}

export function ProjectWizard({ onGenerationStarted }: ProjectWizardProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>("choice");
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [existsData, setExistsData] = useState<ExistsData | null>(null);
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

  const { mutateAsync: generate, isPending: isGenerating } =
    trpc.project.generate.useMutation({
      onError: (error) => {
        console.error("Mutation error:", error);
        if (error.message.includes("Project is currently being generated")) {
          form.setError("root", {
            message: "Project is currently being generated. Please wait.",
          });
        } else {
          form.setError("root", {
            message: error.message || "Failed to start generation",
          });
        }
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
        } else if (data.slug) {
          const processingResponse = data as { slug: string; version?: number };
          setIsOpen(false);
          onGenerationStarted(
            processingResponse.slug,
            processingResponse.version,
          );
        }
      },
    });

  const { mutateAsync: regenerate, isPending: isRegenerating } =
    trpc.project.regenerate.useMutation({
      onError: (error) => {
        console.error("Regenerate mutation error:", error);
        form.setError("root", {
          message: error.message || "Failed to regenerate",
        });
      },
      onSuccess: (data) => {
        if (data.slug) {
          setIsOpen(false);
          onGenerationStarted(data.slug, data.version);
        }
      },
    });

  const handleCreateNewVersion = async () => {
    if (!pendingUrl) return;
    setIsVersionDialogOpen(false);
    try {
      await generate({ url: pendingUrl, createNewVersion: true });
    } catch (e) {
      // Error handled by mutation callbacks
    }
  };

  const handleOverwriteCurrent = async () => {
    if (!existsData) return;
    setIsVersionDialogOpen(false);
    try {
      await regenerate({
        slug: existsData.slug,
        version: existsData.currentVersion,
      });
    } catch (e) {
      // Error handled by mutation callbacks
    }
  };

  const onUrlSubmit = async (data: UrlFormValues) => {
    try {
      const urlToSubmit = normalizeUrl(data.url);
      setPendingUrl(urlToSubmit);
      await generate({
        url: urlToSubmit,
        heroHint: data.heroHint || undefined,
        htmlHint: data.htmlHint || undefined,
      });
    } catch (e) {
      // Handled by onError
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      // Reset to initial state when closing
      setStep("choice");
      form.reset();
      setImportFile(null);
      setIsImporting(false);
    }
  };

  const handleBack = () => {
    setStep("choice");
    form.reset();
    setImportFile(null);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    try {
      const result = await importProjectZip(importFile, {
        organizationId: membership?.organizationId,
      });
      setIsOpen(false);
      onGenerationStarted(result.slug, result.version);
      navigate(ROUTES.PROJECT(result.slug));
      toast.success("Project imported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setIsImporting(false);
    }
  };

  const getDialogTitle = () => {
    switch (step) {
      case "choice":
        return "How do you want to start?";
      case "scratch":
        return "Start from scratch";
      case "url":
        return "Start from existing website";
      case "import":
        return "Import from ZIP";
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
      >
        <Plus className="h-4 w-4" />
        New Project
      </button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {step !== "choice" && (
                <button
                  onClick={handleBack}
                  className="p-1 hover:bg-muted rounded-md transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
              )}
              <DialogTitle>{getDialogTitle()}</DialogTitle>
            </div>
          </DialogHeader>

          {/* Choice step */}
          {step === "choice" && (
            <div className="space-y-3">
              <InteractiveSurfaceButton
                variant="choice"
                onClick={() => {
                  setIsOpen(false);
                  navigate(ROUTES.NEW_SCRATCH);
                }}
                className="w-full rounded-lg p-4 text-left group"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium">Start from scratch</div>
                    <div className="text-sm text-muted-foreground">
                      Describe your business and we'll create everything from
                      zero
                    </div>
                  </div>
                </div>
              </InteractiveSurfaceButton>

              <InteractiveSurfaceButton
                variant="choice"
                onClick={() => setStep("url")}
                className="w-full rounded-lg p-4 text-left group"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                    <Globe className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium">
                      Start from existing website
                    </div>
                    <div className="text-sm text-muted-foreground">
                      We'll analyze and recreate it
                    </div>
                  </div>
                </div>
              </InteractiveSurfaceButton>

              <InteractiveSurfaceButton
                variant="choice"
                onClick={() => setStep("import")}
                className="w-full rounded-lg p-4 text-left group"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium">Import from ZIP</div>
                    <div className="text-sm text-muted-foreground">
                      Upload a previously exported project ZIP
                    </div>
                  </div>
                </div>
              </InteractiveSurfaceButton>
            </div>
          )}

          {/* Scratch flow - coming soon */}
          {step === "scratch" && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium">Scratch wizard</div>
                    <div className="text-sm text-muted-foreground">
                      Answer a few questions, pick a style direction, and
                      generate your first draft.
                    </div>
                  </div>
                </div>
              </div>

              <Button
                className="w-full gap-2"
                onClick={() => {
                  setIsOpen(false);
                  navigate(ROUTES.NEW_SCRATCH);
                }}
              >
                <Sparkles className="h-4 w-4" />
                Start scratch wizard
              </Button>
            </div>
          )}

          {/* URL flow */}
          {step === "url" && (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onUrlSubmit)}
                className="space-y-4"
              >
                <UrlFormFields form={form} />

                <Button
                  type="submit"
                  disabled={isGenerating || isRegenerating}
                  className="w-full"
                >
                  {isGenerating || isRegenerating ? "Starting..." : "Generate"}
                </Button>
              </form>
            </Form>
          )}

          {/* Import flow */}
          {step === "import" && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-sm text-muted-foreground">
                  Import a ZIP you previously downloaded via{" "}
                  <span className="text-foreground font-medium">
                    Download as ZIP
                  </span>
                  .
                </div>
              </div>

              <div className="space-y-2">
                <Input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  disabled={isImporting}
                />
                <div className="text-xs text-muted-foreground">
                  Max 50MB. The imported project will be created as a new
                  project.
                </div>
              </div>

              <Button
                className="w-full"
                onClick={handleImport}
                disabled={!importFile || isImporting}
              >
                {isImporting ? "Importing..." : "Import"}
              </Button>
            </div>
          )}
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
