import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Image as ImageIcon, Link as LinkIcon, Sparkles } from "lucide-react";
import { useScratchWizard } from "./ScratchWizardContext";
import { FileDropzone } from "./FileDropzone";
import { ColorPaletteSelector } from "./ColorPaletteSelector";

export function ScratchForm() {
  const {
    form,
    stylePreset,
    isStyleExact,
    assets,
    setAssets,
    referenceImages,
    setReferenceImages,
    started,
    statusData,
    isGenerating,
    progress,
    submit,
  } = useScratchWizard();

  const isDisabled = isGenerating || !!started;

  return (
    <div className="flex-[4] border-l border-border bg-card flex flex-col">
      <div className="p-6 border-b border-border">
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          The better the brief, the better the result
        </p>
      </div>

      <ScrollArea className="flex-1">
        <form onSubmit={form.handleSubmit(submit)} className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Business name</label>
              <Input
                {...form.register("title")}
                placeholder="Acme Studio"
                disabled={isDisabled}
              />
              {form.formState.errors.title?.message && (
                <div className="text-xs text-destructive">
                  {form.formState.errors.title.message}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Business type</label>
              <Input
                {...form.register("businessType")}
                placeholder="Coffee shop, SaaS…"
                disabled={isDisabled}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              {...form.register("description")}
              rows={5}
              placeholder="What do you do? Who is it for? What's the main goal of the website?"
              disabled={isDisabled}
              className="resize-none"
            />
            {form.formState.errors.description?.message && (
              <div className="text-xs text-destructive">
                {form.formState.errors.description.message}
              </div>
            )}
          </div>

          {/* Color & Theme Settings */}
          <ColorPaletteSelector />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-muted-foreground" />
              <label className="text-sm font-medium">Reference URLs</label>
              <Badge variant="outline" className="text-xs font-normal">
                optional
              </Badge>
            </div>
            <Textarea
              {...form.register("referenceUrlsText")}
              rows={2}
              placeholder={"https://stripe.com\nhttps://linear.app"}
              disabled={isDisabled}
              className="resize-none font-mono text-sm"
            />
            <div className="text-xs text-muted-foreground">
              One URL per line. We'll use them as design references.
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              Assets
            </div>

            <FileDropzone
              title="Brand assets"
              hint="Drop logos / product photos"
              files={assets}
              onAddFiles={(files) => setAssets((prev) => [...prev, ...files])}
              onRemoveFile={(idx) =>
                setAssets((prev) => prev.filter((_, i) => i !== idx))
              }
            />

            <FileDropzone
              title="Design references"
              hint="Drop screenshots of designs you like"
              files={referenceImages}
              onAddFiles={(files) =>
                setReferenceImages((prev) => [...prev, ...files])
              }
              onRemoveFile={(idx) =>
                setReferenceImages((prev) => prev.filter((_, i) => i !== idx))
              }
            />
          </div>

          {!!started?.slug && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Generating…</div>
                <Badge variant="secondary" className="text-xs font-normal">
                  {statusData?.status || "starting"}
                </Badge>
              </div>
              <Progress value={progress} className="h-2" />
              <div className="text-xs text-muted-foreground">
                Project: <span className="font-mono">{started.slug}</span>
              </div>
            </div>
          )}

          <div className="sticky bottom-0 pt-4 pb-2 -mx-6 px-6 bg-card">
            <Button
              type="submit"
              disabled={isDisabled}
              className="w-full gap-2 h-12 text-base font-medium"
            >
              <Sparkles className="h-5 w-5" />
              {isGenerating ? "Starting…" : "Generate Website"}
            </Button>
            {stylePreset && (
              <div className="text-center text-xs text-muted-foreground mt-3">
                Using <span className="font-medium">{stylePreset.name}</span>{" "}
                palette
                <span className="mx-1">·</span>
                <span className="font-medium">
                  {isStyleExact ? "Strict" : "Inspiration"}
                </span>{" "}
                mode
              </div>
            )}
          </div>
        </form>
      </ScrollArea>
    </div>
  );
}
