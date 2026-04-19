import { useState } from "react";
import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";
import {
  Button,
  Callout,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@vivd/ui";

import {
  describeStudioIframeFailure,
  type StudioIframeFailure,
} from "@/lib/studioIframeFailure";

type StudioLoadFailurePanelProps = {
  failure: StudioIframeFailure | null;
  onReload: () => void | Promise<void>;
  onHardRestart: () => void | Promise<void>;
  isHardRestartPending: boolean;
};

export function StudioLoadFailurePanel({
  failure,
  onReload,
  onHardRestart,
  isHardRestartPending,
}: StudioLoadFailurePanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const copy = describeStudioIframeFailure(failure);
  const details = [
    failure?.status ? `Status: ${failure.status}` : null,
    failure?.message?.trim() || null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Panel className="w-full max-w-md">
      <PanelHeader>
        <PanelTitle>{copy.title}</PanelTitle>
        <PanelDescription>{copy.description}</PanelDescription>
      </PanelHeader>
      <PanelContent className="space-y-4">
        {details ? (
          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-surface-sunken px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                <span>{detailsOpen ? "Hide error details" : "Show error details"}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 transition-transform ${
                    detailsOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <Callout tone="warn" icon={<AlertTriangle />}>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                  {details}
                </pre>
              </Callout>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" onClick={() => void onReload()}>
            Reload
          </Button>
          <Button
            onClick={() => void onHardRestart()}
            disabled={isHardRestartPending}
          >
            {isHardRestartPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Restarting…
              </>
            ) : (
              "Hard restart"
            )}
          </Button>
        </div>
      </PanelContent>
    </Panel>
  );
}
