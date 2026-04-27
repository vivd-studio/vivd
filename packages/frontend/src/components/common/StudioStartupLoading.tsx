import type { ReactNode } from "react";
import { Loader2, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@vivd/ui";
import { cn } from "@/lib/utils";
import { FramedViewport } from "@/components/common/FramedHostShell";

interface StudioStartupLoadingProps {
  fullScreen?: boolean;
  className?: string;
  status?: "loading" | "stalled";
  onReload?: () => void | Promise<void>;
  onHardRestart?: () => void | Promise<void>;
  isHardRestartPending?: boolean;
  header?: ReactNode;
  headerClassName?: string;
}

const CHAT_PANEL_WIDTH_STORAGE_KEY = "previewModal.chatPanelWidth";
const DEFAULT_CHAT_PANEL_WIDTH = 400;
const MIN_CHAT_PANEL_WIDTH = 320;
const MAX_CHAT_PANEL_WIDTH = 600;

function getStoredChatPanelWidth(): number {
  if (typeof window === "undefined") return DEFAULT_CHAT_PANEL_WIDTH;

  const stored = window.localStorage.getItem(CHAT_PANEL_WIDTH_STORAGE_KEY);
  if (!stored) return DEFAULT_CHAT_PANEL_WIDTH;

  const parsed = Number.parseInt(stored, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CHAT_PANEL_WIDTH;

  return Math.min(
    MAX_CHAT_PANEL_WIDTH,
    Math.max(MIN_CHAT_PANEL_WIDTH, parsed),
  );
}

function ChatPanelGhost({ width }: { width: number }) {
  return (
    <aside
      aria-hidden="true"
      className="hidden shrink-0 min-w-[320px] max-w-[600px] bg-background md:block"
      style={{ width }}
      data-testid="studio-startup-chat-panel"
    />
  );
}

function PreviewPanel({
  status,
  onReload,
  onHardRestart,
  isHardRestartPending,
}: {
  status: "loading" | "stalled";
  onReload?: () => void | Promise<void>;
  onHardRestart?: () => void | Promise<void>;
  isHardRestartPending?: boolean;
}) {
  const stalled = status === "stalled";

  return (
    <div
      className="relative flex-1 min-w-0 bg-background px-1 pb-1 pt-0 md:pb-1.5 md:pl-0 md:pr-1.5"
      data-testid="studio-startup-preview-panel"
    >
      <FramedViewport className="relative">
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <div className="flex max-w-xs flex-col items-center gap-3 px-6 text-center">
            <Loader2
              className="h-8 w-8 animate-spin text-primary"
              data-testid="studio-startup-spinner"
            />

            <div className="space-y-1">
              <p className="text-sm font-medium">
                {stalled ? "Studio is still starting" : "Starting studio"}
              </p>
              <p className="text-xs text-muted-foreground">
                {stalled
                  ? "This is taking longer than usual."
                  : "This can take a little longer on first startup."}
              </p>
            </div>

            {stalled ? (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {onReload ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onReload()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reload
                  </Button>
                ) : null}
                {onHardRestart ? (
                  <Button
                    size="sm"
                    onClick={() => void onHardRestart()}
                    disabled={isHardRestartPending}
                  >
                    {isHardRestartPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCw className="mr-2 h-4 w-4" />
                    )}
                    {isHardRestartPending ? "Restarting" : "Hard restart"}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </FramedViewport>
    </div>
  );
}

export function StudioStartupLoading({
  fullScreen = false,
  className,
  status = "loading",
  onReload,
  onHardRestart,
  isHardRestartPending = false,
  header,
  headerClassName,
}: StudioStartupLoadingProps) {
  const chatPanelWidth = getStoredChatPanelWidth();

  return (
    <div
      className={cn(
        "flex w-full min-h-0 flex-col overflow-hidden bg-background",
        fullScreen ? "h-dvh w-screen" : "h-full",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label="Loading studio"
      data-testid="studio-startup-shell"
    >
      {header ? (
        <div
          className={cn("shrink-0 px-3 py-1 md:px-4", headerClassName)}
          data-testid="studio-startup-header"
        >
          {header}
        </div>
      ) : null}

      <div className="relative flex flex-1 min-h-0">
        <ChatPanelGhost width={chatPanelWidth} />
        <PreviewPanel
          status={status}
          onReload={onReload}
          onHardRestart={onHardRestart}
          isHardRestartPending={isHardRestartPending}
        />
      </div>

      <span className="sr-only">Loading studio interface</span>
    </div>
  );
}
