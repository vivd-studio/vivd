import { type CanonicalTimelineItem } from "@/features/opencodeChat/render/timeline";
import {
  getToolActivityLabelParts,
  normalizeToolStatus,
  sanitizeThoughtText,
} from "../chatStreamUtils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const orderedResponseParts = orderedParts.filter(
    (part) => part?.type === "text",
  );
  const hasLegacyContent =
    item.message &&
    (!item.message.parts || item.message.parts.length === 0) &&
    item.message.content;
  const lastOrderedActionPart = orderedActionParts[orderedActionParts.length - 1];
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

      {item.showWorkedSection ? (
        <WorkedSessionSection
          label={item.workedLabel ?? "Worked session"}
          isOpen={workedOpen}
          onToggle={onToggleWorked}
        >
          {orderedActionParts.map((part, index) => (
            <MessagePartBubble
              key={part?.id ?? `worked-action-${index}`}
              part={part}
              isStreaming={false}
              isLast={index === orderedActionParts.length - 1}
            />
          ))}
        </WorkedSessionSection>
      ) : (
        <>
          {orderedParts.map((part, index) => (
            <MessagePartBubble
              key={part?.id ?? `live-part-${index}`}
              part={part}
              isStreaming={item.runInProgress}
              isLast={index === orderedParts.length - 1}
            />
          ))}
          {item.runInProgress && item.fallbackState && !hasActiveOrderedAction && (
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
        </>
      )}

      {item.showWorkedSection &&
        orderedResponseParts.map((part, index) => (
          <MessagePartBubble
            key={part?.id ?? `response-${index}`}
            part={part}
            isStreaming={item.runInProgress}
            isLast={index === orderedResponseParts.length - 1}
          />
        ))}

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

function WorkedSessionSection({
  label,
  children,
  isOpen,
  onToggle,
}: {
  label: string;
  children: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="w-full">
      <SessionDivider
        label={label}
        onClick={onToggle}
        icon={
          isOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )
        }
        className="text-muted-foreground/80 hover:text-muted-foreground"
      />
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isOpen ? "max-h-[30rem] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="max-h-[28rem] overflow-y-auto py-1.5 pr-1">
          <div className="flex flex-col gap-0.5">{children}</div>
        </div>
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
      <span className="inline-flex items-center gap-1 shrink-0">
        <span>{label}</span>
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
        className={`w-full flex items-center gap-3 my-4 py-1 text-xs transition-colors ${className}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`w-full flex items-center gap-3 my-4 py-1 text-xs text-muted-foreground ${className}`}
    >
      {content}
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
        renderContent={(isOpen) => <ThoughtContent text={thoughtText} isOpen={isOpen} />}
      />
    );
  }

  if (part.type === "tool") {
    const toolStatus = normalizeToolStatus(part) ?? "completed";
    const toolLabelParts = getToolActivityLabelParts(part);
    const toolInput = summarizeToolInput(part.input);
    const toolDescription =
      toolStatus === "error" ? undefined : extractToolDescription(part.input);
    const isRunning = toolStatus === "running";
    const actionText = isRunning
      ? stripTrailingDots(toolLabelParts.action)
      : toolLabelParts.action;
    const targetText = isRunning
      ? stripTrailingDots(toolLabelParts.target)
      : toolLabelParts.target;
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
              {toolDescription && (
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
          <div className="text-[11px] text-muted-foreground/90">
            Tool: <span className="font-mono">{String(part.tool ?? "unknown")}</span>
          </div>
          {part.title && (
            <div className="text-[11px] text-muted-foreground/90 whitespace-pre-wrap break-words">
              {String(part.title)}
            </div>
          )}
          {toolInput && (
            <pre className="text-[11px] text-muted-foreground/90 bg-muted/40 rounded px-2 py-1 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
              {toolInput}
            </pre>
          )}
          {toolStatus === "error" && (
            <div className="text-[11px] text-destructive/90">
              Action failed. Technical error details are hidden.
            </div>
          )}
        </div>
      </AgentActivityRow>
    );
  }

  if (part.type === "text") {
    return (
      <AgentMarkdownBlock text={part.text ?? ""} isStreaming={isStreaming && isLast} />
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
      className={`rounded-lg px-3 py-1.5 w-full min-w-0 text-sm leading-relaxed max-w-none break-words overflow-x-hidden ${
        animateChunk ? "chat-stream-chunk-fade" : ""
      }`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={getChatMarkdownComponents()}>
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
    <div ref={scrollRef} className="max-h-32 overflow-y-auto whitespace-pre-wrap pr-1">
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

function summarizeToolInput(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    return trimmed.length > 500 ? `${trimmed.slice(0, 500)}\n...` : trimmed;
  }
  try {
    const serialized = JSON.stringify(input, null, 2);
    if (!serialized || serialized === "{}") return null;
    return serialized.length > 500
      ? `${serialized.slice(0, 500)}\n...`
      : serialized;
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

function AgentStateRow({
  label,
  tone = "muted",
}: {
  label: ReactNode;
  tone?: "muted" | "destructive";
}) {
  const toneClass = tone === "destructive" ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="w-full max-w-md">
      <div className={`text-xs font-medium py-0.5 px-1 leading-5 ${toneClass}`}>
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

  const toneClass = tone === "destructive" ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="w-full max-w-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group w-full text-left hover:text-foreground transition-colors text-xs font-medium py-0.5 px-1"
      >
        <span className={`inline-flex max-w-full items-center gap-1 ${toneClass}`}>
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
          <div className="mt-0.5 ml-1 pl-2 pr-1 pb-1 border-l border-border/60 text-xs text-muted-foreground">
            {renderContent ? renderContent(isOpen) : children}
          </div>
        )}
      </div>
    </div>
  );
}
