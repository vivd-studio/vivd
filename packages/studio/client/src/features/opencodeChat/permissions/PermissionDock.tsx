import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { resolvePermissionRequestDisplay } from "../actionLabels";
import type { OpenCodePermissionRequest } from "../types";

function shouldOfferAlways(request: OpenCodePermissionRequest): boolean {
  if (request.always.length === 0) {
    return false;
  }

  if (
    request.permission === "bash" &&
    request.always.some((pattern) => pattern.trim() === "vivd *")
  ) {
    return false;
  }

  return true;
}

interface PermissionDockProps {
  request: OpenCodePermissionRequest;
  onRespond: (
    requestId: string,
    sessionId: string,
    response: "once" | "always" | "reject",
  ) => Promise<void>;
}

export function PermissionDock({
  request,
  onRespond,
}: PermissionDockProps) {
  const [responding, setResponding] = useState<"once" | "always" | "reject" | null>(
    null,
  );
  const display = useMemo(
    () => resolvePermissionRequestDisplay(request),
    [request],
  );
  const showAlways = shouldOfferAlways(request);

  const handleRespond = async (response: "once" | "always" | "reject") => {
    if (responding) return;
    setResponding(response);
    try {
      await onRespond(request.id, request.sessionID, response);
    } finally {
      setResponding(null);
    }
  };

  return (
    <div className="relative mt-auto px-3 pb-3 pt-0 md:px-6 md:pb-6 md:pt-0">
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-xl border border-border/80 bg-background px-4 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_10px_28px_rgba(0,0,0,0.34)] md:px-5 md:py-4">
          <div className="space-y-2">
            {display.destinationLabel ? (
              <>
                <p className="text-sm text-muted-foreground">{display.summary}</p>
                <a
                  href={display.destinationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[1.35rem] font-semibold leading-tight text-foreground underline decoration-foreground/25 underline-offset-[5px] transition-colors hover:text-foreground hover:decoration-foreground/55 md:text-[1.55rem]"
                >
                  {display.destinationLabel}
                </a>
              </>
            ) : (
              <>
                <div className="text-base font-semibold text-foreground">
                  {display.title}
                </div>
                <p className="text-sm text-muted-foreground">{display.summary}</p>
              </>
            )}
          </div>

          {display.showTechnicalDetails ? (
            <details className="mt-3 border-t border-border/50 pt-2">
              <summary className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                Technical details
              </summary>
              <div className="mt-2 space-y-1.5">
                <div className="text-[11px] text-muted-foreground">
                  Permission type: <code>{display.technicalPermission}</code>
                </div>
                {display.technicalPatterns.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[11px] text-muted-foreground">
                      Requested scope
                    </div>
                    {display.technicalPatterns.map((pattern) => (
                      <code
                        key={`${request.id}-${pattern}`}
                        className="block rounded-md border border-border/50 bg-muted/35 px-2 py-1.5 text-[11px] text-foreground break-all"
                      >
                        {pattern}
                      </code>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => handleRespond("reject")}
              disabled={responding !== null}
            >
              Don't allow
            </Button>
            {showAlways ? (
              <Button
                variant="secondary"
                onClick={() => handleRespond("always")}
                disabled={responding !== null}
              >
                Always allow
              </Button>
            ) : null}
            <Button
              onClick={() => handleRespond("once")}
              disabled={responding !== null}
            >
              Allow
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
