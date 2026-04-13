import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { OpenCodePermissionRequest } from "../types";

function readMetadataText(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

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
  const description = useMemo(() => {
    return (
      readMetadataText(request.metadata, "description") ??
      readMetadataText(request.metadata, "tool") ??
      request.permission
    );
  }, [request.metadata, request.permission]);
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
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-[1.4rem] border border-border/70 bg-background/95 px-4 py-4 shadow-2xl shadow-black/10 backdrop-blur-md supports-[backdrop-filter]:bg-background/82 dark:border-white/10 dark:shadow-black/45 md:px-5 md:py-5">
          <div className="space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Agent Permission
            </div>
            <div className="text-sm font-semibold text-foreground">
              Explicit approval required
            </div>
            <div className="text-xs text-muted-foreground">
              Approve or reject this action to let the run continue.
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="text-sm font-semibold text-foreground">{description}</div>
            <div className="text-xs text-muted-foreground">
              Permission type: <code>{request.permission}</code>
            </div>
          </div>

          {request.patterns.length > 0 ? (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Requested scope
              </div>
              <div className="space-y-2">
                {request.patterns.map((pattern) => (
                  <code
                    key={`${request.id}-${pattern}`}
                    className="block rounded-lg border border-border/60 bg-muted/45 px-3 py-2 text-xs text-foreground break-all"
                  >
                    {pattern}
                  </code>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => handleRespond("reject")}
              disabled={responding !== null}
            >
              Deny
            </Button>
            {showAlways ? (
              <Button
                variant="secondary"
                onClick={() => handleRespond("always")}
                disabled={responding !== null}
              >
                Allow always
              </Button>
            ) : null}
            <Button
              onClick={() => handleRespond("once")}
              disabled={responding !== null}
            >
              Allow once
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
