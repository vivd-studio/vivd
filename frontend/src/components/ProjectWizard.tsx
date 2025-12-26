import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VersionDialog } from "./VersionDialog";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Globe, Sparkles, ArrowLeft, AlertTriangle, Plus } from "lucide-react";

type WizardStep = "choice" | "scratch" | "url";

const urlFormSchema = z.object({
  url: z.string().min(1, "URL is required"),
  disclaimer: z.boolean().refine((val) => val === true, {
    message: "You must confirm that you own this website",
  }),
});

type UrlFormValues = z.infer<typeof urlFormSchema>;

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
            processingResponse.version
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
      let urlToSubmit = data.url.trim();
      if (!/^https?:\/\//i.test(urlToSubmit)) {
        urlToSubmit = `https://${urlToSubmit}`;
      }

      setPendingUrl(urlToSubmit);
      await generate({ url: urlToSubmit });
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
    }
  };

  const handleBack = () => {
    setStep("choice");
    form.reset();
  };

  const getDialogTitle = () => {
    switch (step) {
      case "choice":
        return "How do you want to start?";
      case "scratch":
        return "Start from scratch";
      case "url":
        return "Start from existing website";
    }
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)} size="lg" className="gap-2">
        <Plus className="h-5 w-5" />
        New Project
      </Button>

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
              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate("/vivd-studio/projects/new/scratch");
                }}
                className="w-full p-4 rounded-lg border-2 border-border hover:border-primary/50 hover:bg-muted/50 transition-all duration-200 text-left group"
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
              </button>

              <button
                onClick={() => setStep("url")}
                className="w-full p-4 rounded-lg border-2 border-border hover:border-primary/50 hover:bg-muted/50 transition-all duration-200 text-left group"
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
              </button>
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
                  navigate("/vivd-studio/projects/new/scratch");
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
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          placeholder="Enter a URL (e.g., https://example.com)"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="disclaimer"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border">
                        <input
                          type="checkbox"
                          id="disclaimer"
                          checked={field.value}
                          onChange={field.onChange}
                          className="mt-1 h-4 w-4 rounded border-border"
                        />
                        <label
                          htmlFor="disclaimer"
                          className="text-sm text-muted-foreground cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5 text-foreground font-medium mb-1">
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                            I own this website and its content
                          </span>
                          By checking this box, you confirm that you have the
                          rights to use this website's content for generating a
                          new landing page.
                        </label>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.formState.errors.root && (
                  <p className="text-sm font-medium text-destructive">
                    {form.formState.errors.root.message}
                  </p>
                )}

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
