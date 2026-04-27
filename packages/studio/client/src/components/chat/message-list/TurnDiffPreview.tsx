import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useChatContext } from "../ChatContext";
import type { DetailedFileDiff } from "@/features/opencodeChat/diffs/types";
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

function hasDetailedPreviewData(
  diff: RenderableFileDiffSummary | DetailedFileDiff | null,
): diff is DetailedFileDiff | RenderableFileDiffSummary {
  return (
    diff !== null &&
    ((typeof (diff as DetailedFileDiff).patch === "string" &&
      (diff as DetailedFileDiff).patch!.trim().length > 0) ||
      typeof (diff as DetailedFileDiff).before === "string" ||
      typeof (diff as DetailedFileDiff).after === "string")
  );
}

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
  const [expandedFile, setExpandedFile] = useState<string | null>(
    summaryDiffs[0]?.file ?? null,
  );
  const needsQuery =
    summaryDiffs.length === 0 || summaryDiffs.some((diff) => !hasDetailedPreviewData(diff));

  const diffQuery = trpc.agentChat.messageDiff.useQuery(
    {
      projectSlug,
      version,
      sessionId: selectedSessionId ?? "",
      messageId,
    },
    {
      enabled: open && Boolean(selectedSessionId) && needsQuery,
      staleTime: 60_000,
    },
  );

  const displayDiffs = (
    summaryDiffs.length > 0 ? summaryDiffs : (diffQuery.data ?? [])
  ) as Array<
    RenderableFileDiffSummary | DetailedFileDiff
  >;

  useEffect(() => {
    if (expandedFile === null) {
      return;
    }

    if (displayDiffs.some((diff) => diff.file === expandedFile)) {
      return;
    }

    setExpandedFile(displayDiffs[0]?.file ?? null);
  }, [displayDiffs, expandedFile]);

  const detailedDiffsByFile = useMemo(() => {
    if (!Array.isArray(diffQuery.data)) {
      return new Map<string, DetailedFileDiff>();
    }

    return new Map(diffQuery.data.map((diff) => [diff.file, diff]));
  }, [diffQuery.data]);
  const summaryDiffsByFile = useMemo(
    () => new Map(summaryDiffs.map((diff) => [diff.file, diff])),
    [summaryDiffs],
  );

  const diffCount = displayDiffs.length;
  const hasDisplayDiffs = displayDiffs.length > 0;

  return (
    <div className="mt-2 w-full rounded-lg border border-border/60 bg-muted/15">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
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
          {!hasDisplayDiffs && diffQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading edited files...</div>
          ) : !hasDisplayDiffs && diffQuery.isError ? (
            <div className="text-sm text-muted-foreground">
              Could not load the tracked file changes for this run.
            </div>
          ) : !hasDisplayDiffs ? (
            <div className="text-sm text-muted-foreground">
              No tracked file changes were recorded for this run.
            </div>
          ) : (
            <div className="space-y-2">
              {displayDiffs.map((diff) => {
                const isExpanded = diff.file === expandedFile;
                const directory = getDirectory(diff.file);
                const status = resolveFileDiffStatus(diff);
                const summaryDetailedDiff = summaryDiffsByFile.get(diff.file) ?? null;
                const queriedDetailedDiff = detailedDiffsByFile.get(diff.file) ?? null;
                const detailedDiff = hasDetailedPreviewData(summaryDetailedDiff)
                  ? summaryDetailedDiff
                  : queriedDetailedDiff;
                const preview =
                  isExpanded && hasDetailedPreviewData(detailedDiff)
                    ? buildUnifiedDiffPreview(detailedDiff)
                    : null;

                return (
                  <div
                    key={diff.file}
                    data-chat-turn-diff-item={diff.file}
                    className={cn(
                      "overflow-hidden rounded-md border bg-background/80",
                      isExpanded
                        ? "border-foreground/20 text-foreground"
                        : "border-border/60 text-muted-foreground",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedFile((current) =>
                          current === diff.file ? null : diff.file,
                        )
                      }
                      className={cn(
                        "flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-xs transition-colors hover:text-foreground",
                        isExpanded ? "bg-background" : "bg-background/60",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        {directory ? (
                          <span className="mr-1 text-muted-foreground/70">{directory}/</span>
                        ) : null}
                        <span className="font-medium">{getFilename(diff.file)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {status !== "modified" ? (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em]",
                              status === "added" &&
                                "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                              status === "deleted" &&
                                "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                            )}
                          >
                            {formatFileDiffStatus(status)}
                          </span>
                        ) : null}
                        <span className="text-emerald-600">+{diff.additions}</span>
                        <span className="text-rose-600">-{diff.deletions}</span>
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </span>
                    </button>

                    {isExpanded ? (
                      <div className="border-t border-border/60">
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          {formatFileDiffStatus(status)} · +{diff.additions} / -
                          {diff.deletions}
                        </div>

                        {hasDetailedPreviewData(detailedDiff) ? (
                          preview && preview.lines.length > 0 ? (
                            <div className="max-h-80 overflow-auto font-mono text-xs leading-5">
                              {preview.lines.map((line, index) =>
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
                                      line.kind === "added" &&
                                        "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
                                      line.kind === "removed" &&
                                        "bg-rose-500/10 text-rose-900 dark:text-rose-200",
                                    )}
                                  >
                                    <span>{renderPreviewPrefix(line.kind)}</span>
                                    <span className="text-muted-foreground/70">
                                      {line.beforeLineNumber ?? ""}
                                    </span>
                                    <span className="text-muted-foreground/70">
                                      {line.afterLineNumber ?? ""}
                                    </span>
                                    <span className="whitespace-pre-wrap break-words">
                                      {line.text || " "}
                                    </span>
                                  </div>
                                ),
                              )}
                              {preview.truncated ? (
                                <div className="border-t border-border/60 px-3 py-2 text-sm text-muted-foreground">
                                  Preview truncated.
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="px-3 py-3 text-sm text-muted-foreground">
                              No inline text diff preview is available for this file.
                            </div>
                          )
                        ) : diffQuery.isLoading ? (
                          <div className="px-3 py-3 text-sm text-muted-foreground">
                            Loading diff preview...
                          </div>
                        ) : diffQuery.isError ? (
                          <div className="px-3 py-3 text-sm text-muted-foreground">
                            Could not load the diff preview for this file.
                          </div>
                        ) : (
                          <div className="px-3 py-3 text-sm text-muted-foreground">
                            No detailed diff preview is available for this file.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
