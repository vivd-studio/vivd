import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc";
import { urlFormSchema, normalizeUrl } from "@/lib/form-schemas";
import type { UrlFormValues } from "@/lib/form-schemas";
import { importProjectZip } from "@/lib/import-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form } from "@/components/ui/form";
import { UrlFormFields } from "./UrlFormFields";
import { Globe, Sparkles, ArrowLeft, Upload } from "lucide-react";
import { toast } from "sonner";
import faviconSvg from "/favicon-transparent.svg";

type WizardStep = "choice" | "url" | "import";

/**
 * Fullscreen view for creating a project in single project mode.
 * Shows when SINGLE_PROJECT_MODE is enabled and no projects exist.
 */
export function SingleProjectCreateView() {
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>("choice");
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
        form.setError("root", {
          message: error.message || "Failed to start generation",
        });
      },
      onSuccess: (data) => {
        if (data.slug) {
          // Navigate to fullscreen view in single project mode
          navigate(`/vivd-studio/projects/${data.slug}/fullscreen`);
        }
      },
    });

  const onUrlSubmit = async (data: UrlFormValues) => {
    try {
      const urlToSubmit = normalizeUrl(data.url);
      await generate({
        url: urlToSubmit,
        heroHint: data.heroHint || undefined,
        htmlHint: data.htmlHint || undefined,
      });
    } catch {
      // Handled by onError
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
      // Navigate to fullscreen view in single project mode
      navigate(`/vivd-studio/projects/${result.slug}/fullscreen`);
      toast.success("Project imported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setIsImporting(false);
    }
  };

  const getTitle = () => {
    switch (step) {
      case "choice":
        return "Welcome to vivd";
      case "url":
        return "Start from existing website";
      case "import":
        return "Import from ZIP";
    }
  };

  const getSubtitle = () => {
    switch (step) {
      case "choice":
        return "Create your website to get started";
      case "url":
        return "We'll analyze and recreate your existing website";
      case "import":
        return "Upload a previously exported project";
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-3">
        <img src={faviconSvg} alt="vivd" className="h-12 w-12" />
        <span className="text-3xl font-bold tracking-tight">
          vi
          <span
            style={{
              background: "linear-gradient(135deg, #10B981 0%, #F59E0B 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            vd
          </span>
        </span>
      </div>

      {/* Content Card */}
      <div className="w-full max-w-md">
        {/* Header with back button */}
        <div className="mb-6 text-center">
          {step !== "choice" && (
            <button
              onClick={handleBack}
              className="absolute left-8 top-8 p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-2xl font-bold">{getTitle()}</h1>
          <p className="text-muted-foreground mt-1">{getSubtitle()}</p>
        </div>

        {/* Choice step */}
        {step === "choice" && (
          <div className="space-y-3">
            <button
              onClick={() => navigate("/vivd-studio/projects/new/scratch")}
              className="w-full p-5 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-muted/50 transition-all duration-200 text-left group"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div>
                  <div className="font-semibold text-lg">
                    Start from scratch
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Describe your business and we'll create everything from zero
                  </div>
                </div>
              </div>
            </button>

            <button
              onClick={() => setStep("url")}
              className="w-full p-5 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-muted/50 transition-all duration-200 text-left group"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  <Globe className="h-6 w-6" />
                </div>
                <div>
                  <div className="font-semibold text-lg">
                    Start from existing website
                  </div>
                  <div className="text-sm text-muted-foreground">
                    We'll analyze and recreate it
                  </div>
                </div>
              </div>
            </button>

            <button
              onClick={() => setStep("import")}
              className="w-full p-5 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-muted/50 transition-all duration-200 text-left group"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  <Upload className="h-6 w-6" />
                </div>
                <div>
                  <div className="font-semibold text-lg">Import from ZIP</div>
                  <div className="text-sm text-muted-foreground">
                    Upload a previously exported project ZIP
                  </div>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* URL flow */}
        {step === "url" && (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onUrlSubmit)}
              className="space-y-4"
            >
              <UrlFormFields form={form} inputClassName="h-12" />

              <Button
                type="submit"
                disabled={isGenerating}
                className="w-full h-12"
                size="lg"
              >
                {isGenerating ? "Starting..." : "Generate"}
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
                className="h-12"
              />
              <div className="text-xs text-muted-foreground">
                Max 50MB. The imported project will be created as your project.
              </div>
            </div>

            <Button
              className="w-full h-12"
              size="lg"
              onClick={handleImport}
              disabled={!importFile || isImporting}
            >
              {isImporting ? "Importing..." : "Import"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
