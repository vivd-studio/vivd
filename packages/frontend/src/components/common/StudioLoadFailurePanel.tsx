import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Button,
  Callout,
  CalloutTitle,
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
          <Callout tone="warn" icon={<AlertTriangle />}>
            <CalloutTitle>Technical details</CalloutTitle>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
              {details}
            </pre>
          </Callout>
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
