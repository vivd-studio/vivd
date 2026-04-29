import { type CanonicalTimelineItem } from "@/features/opencodeChat/render/timeline";
import {
  getToolActivityLabelParts,
  normalizeToolStatus,
  sanitizeThoughtText,
} from "../chatStreamUtils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getChatMarkdownComponents } from "./chatMarkdown";
import { TurnDiffPreview } from "./TurnDiffPreview";

const EDIT_LIKE_TOOL_NAMES = new Set([
  "edit",
  "write",
  "patch",
  "multiedit",
  "bash",
]);

const GROUPABLE_EDIT_TOOL_NAMES = new Set([
  "edit",
  "write",
  "patch",
  "multiedit",
  "apply_patch",
]);

type AgentDisplayItem =
  | {
      type: "part";
      key: string;
      part: any;
      index: number;
    }
  | {
      type: "activity-group";
      key: string;
      parts: any[];
    };

export function AgentMessageRow({
  item,
  orderedParts,
  workedOpen,
  onToggleWorked,
}: {
  item: Extract<CanonicalTimelineItem, { kind: "agent" }>;
  orderedParts: any[];
  workedOpen: boolean;
  onToggleWorked: () => void;
}) {
  const orderedActionParts = orderedParts.filter(
    (part) => part?.type === "reasoning" || part?.type === "tool",
  );
  const displayItems = buildAgentDisplayItems(orderedParts, {
    groupActivity: item.runInProgress || item.showWorkedSection,
    runInProgress: item.runInProgress,
  });
  const hasActivityGroup = displayItems.some(
    (displayItem) => displayItem.type === "activity-group",
  );
  const hasLegacyContent =
    item.message &&
    (!item.message.parts || item.message.parts.length === 0) &&
    item.message.content;
  const lastOrderedActionPart =
    orderedActionParts[orderedActionParts.length - 1];
  const hasActiveOrderedAction =
    Boolean(lastOrderedActionPart) &&
    (lastOrderedActionPart?.type === "reasoning" ||
      normalizeToolStatus(lastOrderedActionPart) === "running");
  const hasPotentialFileEditTool = orderedParts.some(
    (part) =>
      part?.type === "tool" &&
      EDIT_LIKE_TOOL_NAMES.has(String(part.tool ?? "").toLowerCase()),
  );
  const shouldShowDiffPreview =
    !item.runInProgress &&
    Boolean(item.userMessageId) &&
    (item.summaryDiffs.length > 0 || hasPotentialFileEditTool);

  return (
    <div className="flex flex-col gap-1 w-full items-start overflow-hidden chat-row-enter">
      {item.sessionDividerLabel ? (
        <SessionDivider label={item.sessionDividerLabel} className="mt-1" />
      ) : null}

      {displayItems.map((displayItem, index) => {
        if (displayItem.type === "activity-group") {
          const liveTextPart = item.runInProgress
            ? getLatestTextPart(displayItem.parts)
            : null;

          return (
            <Fragment key={displayItem.key}>
              <WorkedSessionSection
                className={item.runInProgress ? undefined : "mb-2"}
                label={buildActivityGroupLabel(
                  displayItem.parts,
                  item.runInProgress,
                  item.workedLabel,
                )}
                isOpen={workedOpen}
                onToggle={onToggleWorked}
              >
                {displayItem.parts.map((part, groupPartIndex) => (
                  <ActivityGroupDetailPart
                    key={
                      part?.id ?? `${displayItem.key}-part-${groupPartIndex}`
                    }
                    part={part}
                    isLast={groupPartIndex === displayItem.parts.length - 1}
                  />
                ))}
              </WorkedSessionSection>
              {liveTextPart ? (
                <AgentMarkdownBlock
                  text={liveTextPart.text ?? ""}
                  isStreaming={item.runInProgress}
                />
              ) : null}
            </Fragment>
          );
        }

        return (
          <MessagePartBubble
            key={displayItem.key}
            part={displayItem.part}
            isStreaming={item.runInProgress}
            isLast={index === displayItems.length - 1}
          />
        );
      })}
      {item.runInProgress &&
        item.fallbackState &&
        !hasActiveOrderedAction &&
        !hasActivityGroup && (
          <AgentStateRow
            label={
              <LoadingStateLabel
                prefix={
                  <span className="font-semibold">
                    {item.fallbackState === "waiting" ? "Waiting" : "Working"}
                  </span>
                }
              />
            }
            tone="muted"
          />
        )}

      {hasLegacyContent && (
        <AgentMarkdownBlock
          text={item.message?.content ?? ""}
          isStreaming={item.runInProgress}
        />
      )}

      {shouldShowDiffPreview && item.userMessageId ? (
        <TurnDiffPreview
          messageId={item.userMessageId}
          summaryDiffs={item.summaryDiffs}
        />
      ) : null}
    </div>
  );
}

function buildAgentDisplayItems(
  orderedParts: any[],
  options: { groupActivity: boolean; runInProgress: boolean },
): AgentDisplayItem[] {
  if (!options.groupActivity) {
    return orderedParts.map((part, index) => ({
      type: "part",
      key: part?.id ?? `part-${index}`,
      part,
      index,
    }));
  }

  const hasActionPart = orderedParts.some(isActionPart);
  if (!hasActionPart) {
    return orderedParts.map((part, index) => ({
      type: "part",
      key: part?.id ?? `part-${index}`,
      part,
      index,
    }));
  }

  if (options.runInProgress) {
    return [
      {
        type: "activity-group",
        key: `activity-${orderedParts[0]?.id ?? "running"}`,
        parts: orderedParts,
      },
    ];
  }

  const lastActionIndex = findLastActionPartIndex(orderedParts);
  if (lastActionIndex < 0) {
    return orderedParts.map((part, index) => ({
      type: "part",
      key: part?.id ?? `part-${index}`,
      part,
      index,
    }));
  }

  const activityParts = orderedParts.slice(0, lastActionIndex + 1);
  const answerParts = orderedParts.slice(lastActionIndex + 1);

  return [
    {
      type: "activity-group",
      key: `activity-${activityParts[0]?.id ?? "completed"}`,
      parts: activityParts,
    },
    ...answerParts.map((part, index) => ({
      type: "part" as const,
      key: part?.id ?? `part-${lastActionIndex + 1 + index}`,
      part,
      index: lastActionIndex + 1 + index,
    })),
  ];
}

function isActionPart(part: any): boolean {
  return part?.type === "reasoning" || part?.type === "tool";
}

function findLastActionPartIndex(parts: any[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isActionPart(parts[index])) return index;
  }
  return -1;
}

function isCheckCommand(part: any): boolean {
  const command = extractToolCommand(part);
  return Boolean(
    command &&
    /\b(test|vitest|typecheck|tsc|lint|eslint|build|validate|check)\b/i.test(
      command,
    ),
  );
}

function buildActivityGroupLabel(
  parts: any[],
  isWorking: boolean,
  workedLabel?: string,
): ReactNode {
  const activityParts = isWorking ? parts.filter(isActionPart) : parts;
  const summary = summarizeActivityGroup(activityParts);
  const latest = isWorking ? getLatestActivityLabel(activityParts) : null;
  if (isWorking) {
    return <ActiveActivityGroupLabel latest={latest} summary={summary} />;
  }

  const label = workedLabel ?? "Worked";

  if (!summary) return label;

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <span className="shrink-0">{label}</span>
      <span aria-hidden="true" className="shrink-0 text-muted-foreground/45">
        ·
      </span>
      <span className="min-w-0 truncate font-normal text-muted-foreground/75">
        {summary}
      </span>
    </span>
  );
}

function ActiveActivityGroupLabel({
  latest,
  summary,
}: {
  latest: string | null;
  summary: string;
}): ReactNode {
  const primary = latest ?? "Working";
  const details = latest ? summary : "";

  return (
    <span className="block min-w-0 max-w-full truncate">
      <span className="font-semibold chat-loading-wave">{primary}</span>
      <WorkingDots />
      {details ? (
        <>
          <span
            aria-hidden="true"
            className="px-1.5 text-muted-foreground/45"
          >
            ·
          </span>
          <span className="font-normal text-muted-foreground/75">{details}</span>
        </>
      ) : null}
    </span>
  );
}

function WorkingDots() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex w-5 items-baseline justify-center gap-px align-baseline text-muted-foreground"
    >
      <span className="chat-working-dot leading-none">.</span>
      <span className="chat-working-dot leading-none">.</span>
      <span className="chat-working-dot leading-none">.</span>
    </span>
  );
}

function summarizeActivityGroup(parts: any[]): string {
  let thoughts = 0;
  let reads = 0;
  let searches = 0;
  let lists = 0;
  let edits = 0;
  let checks = 0;
  let otherTools = 0;
  let failed = 0;

  for (const part of parts) {
    if (part?.type === "reasoning") {
      thoughts += 1;
      continue;
    }

    if (part?.type !== "tool") continue;

    const toolName = String(part.tool ?? "")
      .trim()
      .toLowerCase();
    const toolStatus = normalizeToolStatus(part) ?? "completed";
    if (toolStatus === "error") {
      failed += 1;
    }

    if (toolName === "read") {
      reads += 1;
    } else if (toolName === "grep" || toolName === "glob") {
      searches += 1;
    } else if (toolName === "list" || isListCommand(part)) {
      lists += 1;
    } else if (GROUPABLE_EDIT_TOOL_NAMES.has(toolName)) {
      edits += 1;
    } else if (toolName === "bash" && isCheckCommand(part)) {
      checks += 1;
    } else {
      otherTools += 1;
    }
  }

  return [
    formatActivityCount(reads, "Read 1 file", `Read ${reads} files`),
    formatActivityCount(
      searches,
      "Searched the project",
      `Searched ${searches} times`,
    ),
    formatActivityCount(lists, "Listed 1 folder", `Listed ${lists} folders`),
    formatActivityCount(edits, "Edited 1 file", `Edited ${edits} files`),
    formatActivityCount(checks, "Ran checks", `Ran ${checks} checks`),
    formatActivityCount(otherTools, "Ran 1 tool", `Ran ${otherTools} tools`),
    formatActivityCount(failed, "1 failed", `${failed} failed`),
    formatActivityCount(
      thoughts,
      "Thought through the change",
      "Thought through the change",
    ),
  ]
    .filter(Boolean)
    .join(", ");
}

function formatActivityCount(
  count: number,
  singular: string,
  plural: string,
): string | null {
  if (count <= 0) return null;
  return count === 1 ? singular : plural;
}

function getLatestActivityLabel(parts: any[]): string | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type === "reasoning") {
      return "Thinking through the change";
    }

    if (part?.type === "tool") {
      return getReadableToolActivityLabel(part);
    }
  }

  return null;
}

function getLatestTextPart(parts: any[]): any | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type !== "text") continue;
    if (typeof part.text !== "string" || !part.text.trim()) continue;
    return part;
  }
  return null;
}

function getReadableToolActivityLabel(part: any): string {
  const toolStatus = normalizeToolStatus(part) ?? "completed";
  const labelParts = getToolActivityLabelParts(part);
  const action = stripTrailingDots(labelParts.action);
  const target = stripTrailingDots(labelParts.target);
  const label = [action, target].filter(Boolean).join(" ").trim();

  if (label) return label;
  if (toolStatus === "running") return "Running tool";
  if (toolStatus === "error") return "Tool failed";
  return "Ran tool";
}

function isListCommand(part: any): boolean {
  const command = extractToolCommand(part);
  if (!command) return false;
  return /^\s*(?:ls|find|tree|pwd)\b/i.test(command);
}

function WorkedSessionSection({
  className = "",
  label,
  children,
  isOpen,
  onToggle,
}: {
  className?: string;
  label: ReactNode;
  children: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`w-full max-w-full ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="group flex max-w-full items-center gap-1.5 px-1 py-0.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="inline-flex shrink-0 items-center text-muted-foreground/70 transition-colors group-hover:text-foreground">
          {isOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </span>
      </button>
      <div
        aria-hidden={!isOpen}
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isOpen ? "max-h-[30rem] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {isOpen ? (
          <div className="ml-1 max-h-[28rem] overflow-y-auto border-l border-border/60 py-1.5 pl-2 pr-1">
            <div className="flex flex-col gap-0.5">{children}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SessionDivider({
  label,
  icon,
  onClick,
  className = "",
}: {
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      <span className="h-px flex-1 bg-border/70" />
      <span className="inline-flex min-w-0 max-w-[82%] shrink items-center gap-1">
        <span className="min-w-0 truncate">{label}</span>
        {icon}
      </span>
      <span className="h-px flex-1 bg-border/70" />
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-3 my-4 py-1 text-sm transition-colors ${className}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`w-full flex items-center gap-3 my-4 py-1 text-sm text-muted-foreground ${className}`}
    >
      {content}
    </div>
  );
}

function ActivityGroupDetailPart({
  part,
  isLast = false,
}: {
  part: any;
  isLast?: boolean;
}) {
  if (part?.type !== "text") {
    return (
      <MessagePartBubble part={part} isStreaming={false} isLast={isLast} />
    );
  }

  const text = typeof part.text === "string" ? part.text.trim() : "";
  if (!text) return null;

  return (
    <div className="max-w-md px-1 py-0.5 text-sm leading-5 text-muted-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={getChatMarkdownComponents({ compactParagraphs: true })}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function MessagePartBubble({
  part,
  isStreaming = false,
  isLast = false,
}: {
  part: any;
  isStreaming?: boolean;
  isLast?: boolean;
}) {
  if (part.type === "reasoning") {
    const thoughtText = sanitizeThoughtText(part.text ?? "");
    if (!thoughtText.trim()) {
      return null;
    }

    const isActive = isStreaming && isLast;

    return (
      <AgentActivityRow
        label={
          isActive ? (
            <LoadingStateLabel
              prefix={<span className="font-bold">Thinking</span>}
            />
          ) : (
            <span className="font-semibold">Thought</span>
          )
        }
        tone="muted"
        renderContent={(isOpen) => (
          <ThoughtContent text={thoughtText} isOpen={isOpen} />
        )}
      />
    );
  }

  if (part.type === "tool") {
    const toolStatus = normalizeToolStatus(part) ?? "completed";
    const toolLabelParts = getToolActivityLabelParts(part);
    const isBashTool =
      String(part.tool ?? "")
        .trim()
        .toLowerCase() === "bash";
    const rawToolInput = part.input ?? part.state?.input;
    const toolOutput = summarizeToolOutput(part);
    const toolTranscript = isBashTool
      ? summarizeBashTranscript(part, toolOutput)
      : null;
    const toolInput = summarizeToolInput(rawToolInput, {
      omitKeys: toolTranscript ? ["command", "description"] : ["description"],
    });
    const toolDescription =
      toolStatus === "error" ? undefined : extractToolDescription(rawToolInput);
    const toolTitle = selectToolTitle(
      extractToolTitle(part),
      toolDescription,
      toolInput,
      toolTranscript ?? toolOutput,
    );
    const isRunning = toolStatus === "running";
    const actionText = isRunning
      ? stripTrailingDots(toolLabelParts.action)
      : toolLabelParts.action;
    const targetText = isRunning
      ? stripTrailingDots(toolLabelParts.target)
      : toolLabelParts.target;
    const toolLabelText = [actionText, targetText]
      .filter(Boolean)
      .join(" ")
      .trim();
    const showInlineDescription =
      !isBashTool && toolDescription && toolDescription !== toolLabelText;
    const toolActionLabel = (
      <span className="inline-flex shrink-0 items-baseline gap-1">
        <span className="font-bold">{actionText}</span>
        {targetText && <span className="font-normal">{targetText}</span>}
      </span>
    );

    return (
      <AgentActivityRow
        label={
          isRunning ? (
            <LoadingStateLabel prefix={toolActionLabel} />
          ) : (
            <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 whitespace-nowrap">
              {toolActionLabel}
              {showInlineDescription && (
                <span
                  className="min-w-0 truncate text-muted-foreground/70 font-normal"
                  title={toolDescription}
                >
                  {toolDescription}
                </span>
              )}
            </span>
          )
        }
        tone={toolStatus === "error" ? "destructive" : "muted"}
      >
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground/90">
            Tool:{" "}
            <span className="font-mono">{String(part.tool ?? "unknown")}</span>
          </div>
          {toolTitle && (
            <div className="text-xs text-muted-foreground/90 whitespace-pre-wrap break-words">
              {toolTitle}
            </div>
          )}
          {toolTranscript && (
            <ToolCodeBlock
              text={toolTranscript}
              className="font-mono text-sm text-foreground bg-muted/65"
            />
          )}
          {!toolTranscript && toolInput && (
            <ToolCodeBlock
              text={toolInput}
              className="text-xs text-foreground/90"
            />
          )}
          {!toolTranscript && toolOutput && (
            <ToolCodeBlock
              text={toolOutput}
              className="font-mono text-xs text-foreground/90 bg-muted/55"
            />
          )}
          {toolStatus === "error" && (
            <div className="text-xs text-destructive/90">
              Action failed. Technical error details are hidden.
            </div>
          )}
        </div>
      </AgentActivityRow>
    );
  }

  if (part.type === "text") {
    return (
      <AgentMarkdownBlock
        text={part.text ?? ""}
        isStreaming={isStreaming && isLast}
      />
    );
  }

  return null;
}

function AgentMarkdownBlock({
  text,
  isStreaming = false,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  const [animateChunk, setAnimateChunk] = useState(false);
  const previousTextRef = useRef(text);

  useEffect(() => {
    if (!isStreaming) {
      previousTextRef.current = text;
      setAnimateChunk(false);
      return;
    }
    if (text === previousTextRef.current) return;

    previousTextRef.current = text;
    setAnimateChunk(true);
    const timer = window.setTimeout(() => setAnimateChunk(false), 180);
    return () => window.clearTimeout(timer);
  }, [text, isStreaming]);

  return (
    <div
      className={`rounded-lg px-1 py-1.5 w-full min-w-0 text-base leading-relaxed max-w-none break-words overflow-x-hidden ${
        animateChunk ? "chat-stream-chunk-fade" : ""
      }`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={getChatMarkdownComponents()}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function stripTrailingDots(value?: string): string | undefined {
  if (!value) return value;
  return value.replace(/\.+\s*$/, "");
}

function ThoughtContent({ text, isOpen }: { text: string; isOpen: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [text, isOpen]);

  return (
    <div
      ref={scrollRef}
      className="max-h-32 overflow-y-auto whitespace-pre-wrap pr-1"
    >
      {text}
    </div>
  );
}

function LoadingStateLabel({ prefix }: { prefix: ReactNode }) {
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    const timer = setInterval(() => {
      setDotCount((prev) => (prev % 3) + 1);
    }, 420);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="inline-flex items-baseline gap-0.5 chat-loading-wave">
      <span>{prefix}</span>
      <span>{".".repeat(dotCount)}</span>
    </span>
  );
}

function ToolCodeBlock({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <pre
      className={`rounded px-2 py-1 whitespace-pre-wrap break-words max-h-28 overflow-y-auto ${className}`}
    >
      {text}
    </pre>
  );
}

function summarizeToolInput(
  input: unknown,
  options?: { omitKeys?: string[] },
): string | null {
  if (input == null) return null;
  if (typeof input === "string") {
    const trimmed = sanitizeToolText(input);
    if (!trimmed) return null;
    return trimmed.length > 500 ? `${trimmed.slice(0, 500)}\n...` : trimmed;
  }

  let value = input;
  if (
    options?.omitKeys?.length &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    const omitKeys = new Set(options.omitKeys);
    value = Object.fromEntries(
      Object.entries(input as Record<string, unknown>).filter(
        ([key, candidate]) =>
          !omitKeys.has(key) && candidate !== undefined && candidate !== null,
      ),
    );
  }

  try {
    const serialized = JSON.stringify(value, null, 2);
    if (!serialized || serialized === "{}") return null;
    const normalized = sanitizeToolText(serialized);
    if (!normalized) return null;
    return normalized.length > 500
      ? `${normalized.slice(0, 500)}\n...`
      : normalized;
  } catch {
    return null;
  }
}

function parseToolObjectInput(input: unknown): Record<string, unknown> | null {
  if (!input) return null;
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid JSON input.
  }
  return null;
}

function extractToolDescription(input: unknown): string | undefined {
  const obj = parseToolObjectInput(input);
  if (!obj) return undefined;

  const description = obj.description;
  if (typeof description !== "string") return undefined;

  const normalized = description.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function extractToolTitle(part: any): string | undefined {
  const value = part?.title ?? part?.state?.title;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function normalizeToolLabelDetail(
  value: string | undefined,
  duplicateOf?: string,
): string | undefined {
  if (!value) return undefined;
  if (!duplicateOf) return value;
  return value === duplicateOf ? undefined : value;
}

function selectToolTitle(
  title: string | undefined,
  duplicateOf?: string,
  toolInput?: string | null,
  toolDetails?: string | null,
): string | undefined {
  const normalizedTitle = normalizeToolLabelDetail(title, duplicateOf);
  if (!normalizedTitle) return undefined;

  const lowerTitle = normalizedTitle.toLowerCase();
  const duplicateCandidates = [toolInput, toolDetails]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return duplicateCandidates.some((candidate) => candidate.includes(lowerTitle))
    ? undefined
    : normalizedTitle;
}

function summarizeToolOutput(part: any): string | null {
  const candidates = [
    part?.output,
    part?.state?.output,
    part?.metadata?.output,
    part?.state?.metadata?.output,
  ];

  for (const candidate of candidates) {
    const normalized = formatToolDetailText(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function summarizeBashTranscript(
  part: any,
  output: string | null,
): string | null {
  const command = extractToolCommand(part);
  const lines = [command ? `$ ${command}` : null, output].filter(
    (value): value is string => Boolean(value),
  );
  if (lines.length === 0) return null;
  return lines.join("\n\n");
}

function extractToolCommand(part: any): string | undefined {
  const candidates = [
    part?.input?.command,
    part?.state?.input?.command,
    part?.metadata?.command,
    part?.state?.metadata?.command,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = sanitizeToolText(candidate);
    if (normalized) return normalized;
  }

  return undefined;
}

function formatToolDetailText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    return sanitizeToolText(value) || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value, null, 2);
    return sanitizeToolText(serialized) || null;
  } catch {
    return null;
  }
}

function sanitizeToolText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .trim();
}

function AgentStateRow({
  label,
  tone = "muted",
}: {
  label: ReactNode;
  tone?: "muted" | "destructive";
}) {
  const toneClass =
    tone === "destructive" ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="w-full max-w-md">
      <div className={`text-sm font-medium py-0.5 px-1 leading-5 ${toneClass}`}>
        <span className="inline-flex items-center gap-1">{label}</span>
      </div>
    </div>
  );
}

function AgentActivityRow({
  label,
  children,
  renderContent,
  defaultOpen = false,
  tone = "muted",
}: {
  label: ReactNode;
  children?: ReactNode;
  renderContent?: (isOpen: boolean) => ReactNode;
  defaultOpen?: boolean;
  tone?: "muted" | "destructive";
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen]);

  const toneClass =
    tone === "destructive" ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="w-full max-w-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group w-full text-left hover:text-foreground transition-colors text-sm font-medium py-0.5 px-1"
      >
        <span
          className={`inline-flex max-w-full items-center gap-1 ${toneClass}`}
        >
          <span className="min-w-0">{label}</span>
          <span className="inline-flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150">
            {isOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        </span>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          isOpen
            ? "max-h-64 opacity-100 translate-y-0"
            : "max-h-0 opacity-0 -translate-y-0.5"
        }`}
      >
        {isOpen && (
          <div className="mt-0.5 ml-1 pl-2 pr-1 pb-1 border-l border-border/60 text-sm text-muted-foreground">
            {renderContent ? renderContent(isOpen) : children}
          </div>
        )}
      </div>
    </div>
  );
}
