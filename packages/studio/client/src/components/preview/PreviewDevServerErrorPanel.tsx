import { useCallback, useState } from "react";
import { AlertCircle, Bot, ChevronDown, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { copyTextWithFallback } from "@/lib/browserActions";
import { cn } from "@/lib/utils";
import { useOptionalChatContext } from "../chat/ChatContext";

interface PreviewDevServerErrorPanelProps {
  projectSlug?: string;
  version?: number;
  devServerError?: string;
  restartPending: boolean;
  setChatOpen: (open: boolean) => void;
  onRestart: () => void;
  onCleanReinstall: () => void;
}

interface BuildPreviewRepairPromptOptions {
  projectSlug?: string;
  version?: number;
  devServerError?: string;
}

export function buildPreviewRepairPrompt({
  projectSlug,
  version,
  devServerError,
}: BuildPreviewRepairPromptOptions): string {
  const scope =
    projectSlug && version !== undefined
      ? `Project: ${projectSlug} (v${version})`
      : projectSlug
        ? `Project: ${projectSlug}`
        : version !== undefined
          ? `Version: v${version}`
          : null;
  const errorText =
    devServerError?.trim() || "No runtime error details were available.";

  return [
    "The Studio preview failed to start for this project. Please inspect the project files and fix whatever is blocking the preview/runtime so it can start again.",
    scope,
    "Runtime error:",
    errorText,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function PreviewDevServerErrorPanel({
  projectSlug,
  version,
  devServerError,
  restartPending,
  setChatOpen,
  onRestart,
  onCleanReinstall,
}: PreviewDevServerErrorPanelProps) {
  const chatContext = useOptionalChatContext();
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const repairPrompt = buildPreviewRepairPrompt({
    projectSlug,
    version,
    devServerError,
  });

  const handleCopyPrompt = useCallback(
    async (options?: { successMessage?: string }) => {
      const successMessage = options?.successMessage ?? "Copied prompt for agent";

      try {
        await copyTextWithFallback(repairPrompt);
        if (successMessage) {
          toast.success(successMessage);
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error("Failed to copy prompt for agent", { description: message });
        return false;
      }
    },
    [repairPrompt],
  );

  const handleAskAgent = useCallback(async () => {
    setChatOpen(true);

    if (!chatContext) {
      await handleCopyPrompt();
      return;
    }

    if (chatContext.input.trim().length > 0) {
      const copied = await handleCopyPrompt({ successMessage: "" });
      if (copied) {
        toast.info(
          "Opened the agent and copied the repair prompt so your existing draft stays intact.",
        );
      }
      return;
    }

    chatContext.handleNewSession();
    chatContext.setInput(repairPrompt);
    toast.success("Opened the agent with a repair prompt");
  }, [chatContext, handleCopyPrompt, repairPrompt, setChatOpen]);

  return (
    <div className="flex max-w-xl flex-col gap-4 rounded-xl border border-border/60 bg-background/95 p-5 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/12 text-amber-700 dark:bg-amber-400/12 dark:text-amber-300">
        <AlertCircle className="h-6 w-6" />
      </div>
      <div className="space-y-2">
        <p className="text-base font-semibold text-foreground">
          We couldn&apos;t open this preview yet
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          This project likely needs a quick fix before the preview can load.
          The easiest next step is to ask the built-in agent to fix it for you.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void handleAskAgent()}
          disabled={restartPending}
        >
          <Bot className="h-4 w-4" />
          Ask agent to fix it
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onRestart}
          disabled={restartPending}
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      </div>

      <Collapsible
        open={technicalDetailsOpen}
        onOpenChange={setTechnicalDetailsOpen}
        className="rounded-lg border border-border/50 bg-muted/15 text-left"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground/85"
            aria-label={
              technicalDetailsOpen
                ? "Hide technical details"
                : "Show technical details"
            }
          >
            <span>
              {technicalDetailsOpen
                ? "Hide technical details"
                : "Show technical details"}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 transition-transform",
                technicalDetailsOpen && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden border-t border-border/60 data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
          <div className="space-y-3 p-3">
            <p className="text-sm text-muted-foreground">
              If you want to pass the exact error to an agent or inspect it
              yourself, use the details below.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleCopyPrompt()}
                disabled={restartPending}
              >
                <Copy className="h-4 w-4" />
                Copy message for agent
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onCleanReinstall}
                disabled={restartPending}
              >
                Clean reinstall
              </Button>
            </div>
            <div className="rounded-md border border-border/60 bg-background/80 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Runtime error
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                {devServerError?.trim() || "No runtime error details were available."}
              </pre>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
