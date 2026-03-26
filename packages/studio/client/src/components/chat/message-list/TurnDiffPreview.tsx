import { useEffect, useMemo, useState } from "react";
import type { FileDiff } from "@opencode-ai/sdk/v2";
import { ChevronDown, ChevronRight, FileCode2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useChatContext } from "../ChatContext";
import {
  buildUnifiedDiffPreview,
  type UnifiedPreviewLine,
} from "@/features/opencodeChat/diffs/unifiedPreview";
import {
  formatFileDiffStatus,
  resolveFileDiffStatus,
} from "@/features/opencodeChat/diffs/status";
import type { RenderableFileDiffSummary } from "@/features/opencodeChat/render/timeline";

type TurnDiffPreviewProps = {
  messageId: string;
  summaryDiffs: RenderableFileDiffSummary[];
};

function getFilename(file: string): string {
  const parts = file.split("/");
  return parts[parts.length - 1] || file;
}

function getDirectory(file: string): string {
  const parts = file.split("/");
  parts.pop();
  return parts.join("/");
}

function renderPreviewPrefix(kind: UnifiedPreviewLine["kind"]) {
  if (kind === "added") return "+";
  if (kind === "removed") return "-";
  if (kind === "context") return " ";
  return "…";
}

export function TurnDiffPreview({
  messageId,
  summaryDiffs,
}: TurnDiffPreviewProps) {
  const { projectSlug, version, selectedSessionId } = useChatContext();
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(
    summaryDiffs[0]?.file ?? null,
  );

  const diffQuery = trpc.agentChat.messageDiff.useQuery(
    {
      projectSlug,
      version,
      sessionId: selectedSessionId ?? "",
      messageId,
    },
    {
      enabled: open && Boolean(selectedSessionId),
      staleTime: 60_000,
    },
  );

  const displayDiffs = (diffQuery.data ?? summaryDiffs) as Array<
    RenderableFileDiffSummary | FileDiff
  >;

  useEffect(() => {
    if (selectedFile && displayDiffs.some((diff) => diff.file === selectedFile)) {
      return;
    }
    setSelectedFile(displayDiffs[0]?.file ?? null);
  }, [displayDiffs, selectedFile]);

  const selectedDiff = useMemo(() => {
    if (!Array.isArray(diffQuery.data) || !selectedFile) {
      return null;
    }
    return diffQuery.data.find((diff) => diff.file === selectedFile) ?? diffQuery.data[0] ?? null;
  }, [diffQuery.data, selectedFile]);

  const preview = useMemo(
    () => (selectedDiff ? buildUnifiedDiffPreview(selectedDiff) : null),
    [selectedDiff],
  );

  const diffCount = diffQuery.data?.length ?? summaryDiffs.length;

  return (
    <div className="mt-2 w-full rounded-lg border border-border/60 bg-muted/15">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <FileCode2 className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">
            {diffCount > 0 ? `Files edited (${diffCount})` : "Files edited"}
          </span>
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      {open ? (
        <div className="border-t border-border/60 px-3 py-3">
          {diffQuery.isLoading ? (
            <div className="text-xs text-muted-foreground">Loading edited files...</div>
          ) : diffQuery.isError ? (
            <div className="text-xs text-muted-foreground">
              Could not load the tracked file changes for this run.
            </div>
          ) : diffQuery.data && diffQuery.data.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              No tracked file changes were recorded for this run.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {displayDiffs.map((diff) => {
                  const isSelected = diff.file === selectedFile;
                  const directory = getDirectory(diff.file);
                  const status = resolveFileDiffStatus(diff);
                  return (
                    <button
                      key={diff.file}
                      type="button"
                      onClick={() => setSelectedFile(diff.file)}
                      className={cn(
                        "inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-colors",
                        isSelected
                          ? "border-foreground/20 bg-background text-foreground"
                          : "border-border/60 bg-background/60 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="min-w-0">
                        {directory ? (
                          <span className="mr-1 text-muted-foreground/70">{directory}/</span>
                        ) : null}
                        <span className="font-medium">{getFilename(diff.file)}</span>
                      </span>
                      {status !== "modified" ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
                            status === "added" &&
                              "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                            status === "deleted" &&
                              "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                          )}
                        >
                          {formatFileDiffStatus(status)}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-emerald-600">+{diff.additions}</span>
                      <span className="shrink-0 text-rose-600">-{diff.deletions}</span>
                    </button>
                  );
                })}
              </div>

              {selectedDiff ? (
                <div className="overflow-hidden rounded-md border border-border/60 bg-background/80">
                  <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
                    <div className="min-w-0 text-xs">
                      <div className="truncate font-medium">{selectedDiff.file}</div>
                      <div className="text-muted-foreground">
                        {formatFileDiffStatus(resolveFileDiffStatus(selectedDiff))} · +
                        {selectedDiff.additions} / -
                        {selectedDiff.deletions}
                      </div>
                    </div>
                  </div>

                  <div className="max-h-80 overflow-auto font-mono text-[11px] leading-5">
                    {preview?.lines.map((line, index) =>
                      line.kind === "omitted" ? (
                        <div
                          key={`omitted-${index}`}
                          className="grid grid-cols-[3ch_5ch_5ch_1fr] gap-2 px-3 py-1 text-muted-foreground/70"
                        >
                          <span>{renderPreviewPrefix(line.kind)}</span>
                          <span />
                          <span />
                          <span>{line.count} unchanged line(s) hidden</span>
                        </div>
                      ) : (
                        <div
                          key={`${line.kind}-${index}`}
                          className={cn(
                            "grid grid-cols-[3ch_5ch_5ch_1fr] gap-2 px-3 py-0.5",
                            line.kind === "added" && "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
                            line.kind === "removed" && "bg-rose-500/10 text-rose-900 dark:text-rose-200",
                          )}
                        >
                          <span>{renderPreviewPrefix(line.kind)}</span>
                          <span className="text-muted-foreground/70">
                            {line.beforeLineNumber ?? ""}
                          </span>
                          <span className="text-muted-foreground/70">
                            {line.afterLineNumber ?? ""}
                          </span>
                          <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
                        </div>
                      ),
                    )}
                    {preview?.truncated ? (
                      <div className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                        Preview truncated.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
