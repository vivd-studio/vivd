import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type CanonicalTimelineItem } from "@/features/opencodeChat/render/timeline";
import { ChevronDown, Undo2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AttachedFileRefPill,
  DroppedImagePill,
  ElementRefPill,
  parseVivdInternalTags,
} from "../SelectedElementPill";
import { getChatMarkdownComponents } from "./chatMarkdown";

const USER_MESSAGE_COLLAPSE_MAX_HEIGHT_PX = 204;
const USER_MESSAGE_COLLAPSE_OVERFLOW_EPSILON_PX = 4;
const USER_MESSAGE_COLLAPSE_FADE_HEIGHT_PX = 36;

export function UserMessageRow({
  message,
  onRevert,
  registerAnchor,
  registerRow,
}: {
  message: Extract<CanonicalTimelineItem, { kind: "user" }>["message"];
  onRevert: (messageId: string) => void;
  registerAnchor: (messageId: string, node: HTMLDivElement | null) => void;
  registerRow: (messageId: string, node: HTMLDivElement | null) => void;
}) {
  const { cleanMessage, internalTags } = parseVivdInternalTags(message.content);
  const imageTags = internalTags.filter((tag) => tag.type === "dropped-file");
  const fileTags = internalTags.filter((tag) => tag.type === "attached-file");
  const elementTag = internalTags.find((tag) => tag.type === "element-ref");
  const hasElementRef =
    Boolean(elementTag?.selector) || Boolean(elementTag?.["source-file"]);
  const messageId = message.id;

  return (
    <div
      ref={(node) => {
        if (messageId) {
          registerRow(messageId, node);
        }
      }}
      data-chat-user-row-id={messageId}
      className="flex flex-col gap-1 items-end chat-row-enter"
    >
      <div className="h-6 flex items-center justify-end">
        {messageId ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px] text-muted-foreground/75 hover:text-muted-foreground h-6 px-2"
            onClick={() => onRevert(messageId)}
          >
            <Undo2 className="w-3 h-3 mr-1" />
            Revert to here
          </Button>
        ) : (
          <span aria-hidden="true" className="h-6 w-px opacity-0" />
        )}
      </div>

      <div
        ref={(node) => {
          if (messageId) {
            registerAnchor(messageId, node);
          }
        }}
        data-chat-user-anchor-id={messageId}
        className="max-w-[90%] min-w-0"
      >
        <div
          className="overflow-x-hidden rounded-[18px] bg-muted/40 px-3.5 py-1.5 text-foreground text-sm leading-[1.45] dark:bg-muted/10"
          data-chat-user-message-id={messageId}
        >
          <UserMessageText messageId={messageId} text={cleanMessage} />

          {(imageTags.length > 0 || fileTags.length > 0 || hasElementRef) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {imageTags.map((tag, idx) => (
                <DroppedImagePill
                  key={`img-${idx}`}
                  filename={tag.filename || "image"}
                />
              ))}
              {fileTags.map((tag, idx) => (
                <AttachedFileRefPill
                  key={`file-${idx}`}
                  filename={tag.filename || "file"}
                />
              ))}
              {hasElementRef && (
                <ElementRefPill
                  key="element"
                  selector={elementTag?.selector}
                  sourceFile={elementTag?.["source-file"]}
                  sourceLoc={elementTag?.["source-loc"]}
                />
              )}
            </div>
          )}
        </div>
        {message.createdAt && (
          <div
            data-chat-user-message-time={messageId}
            className="mt-0.5 px-1 text-[10px] text-muted-foreground/60 text-right"
          >
            {formatMessageTime(message.createdAt)}
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessageText({
  messageId,
  text,
}: {
  messageId?: string;
  text: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [isCollapsible, setIsCollapsible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node || !text.trim()) {
      setContentHeight(0);
      setIsCollapsible(false);
      setIsExpanded(false);
      return;
    }

    const measure = () => {
      const nextContentHeight = node.scrollHeight;
      const nextIsCollapsible =
        nextContentHeight >
        USER_MESSAGE_COLLAPSE_MAX_HEIGHT_PX + USER_MESSAGE_COLLAPSE_OVERFLOW_EPSILON_PX;
      setContentHeight((prev) =>
        prev === nextContentHeight ? prev : nextContentHeight,
      );
      setIsCollapsible((prev) =>
        prev === nextIsCollapsible ? prev : nextIsCollapsible,
      );

      if (!nextIsCollapsible) {
        setIsExpanded(false);
      }
    };

    measure();

    const resizeObserver = new ResizeObserver(() => {
      measure();
    });
    resizeObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
    };
  }, [messageId, text]);

  if (!text.trim()) {
    return null;
  }

  const shouldClamp = isCollapsible && !isExpanded;
  const expandedTextMaxHeight =
    isCollapsible && isExpanded && contentHeight > 0
      ? contentHeight
      : undefined;
  const collapsedTextMask = `linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 1) calc(100% - ${USER_MESSAGE_COLLAPSE_FADE_HEIGHT_PX}px), rgba(0, 0, 0, 0) 100%)`;

  return (
    <div className="min-w-0">
      <div
        data-chat-user-message-text={messageId}
        data-chat-user-message-collapsed={shouldClamp ? "true" : "false"}
        className={cn(
          "relative min-w-0 overflow-hidden transition-[max-height] duration-200 ease-out",
          shouldClamp ? "max-h-[204px]" : "",
        )}
        style={
          shouldClamp
            ? {
                WebkitMaskImage: collapsedTextMask,
                maskImage: collapsedTextMask,
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskSize: "100% 100%",
                maskSize: "100% 100%",
              }
            : expandedTextMaxHeight
              ? { maxHeight: `${expandedTextMaxHeight}px` }
              : undefined
        }
      >
        <div ref={contentRef} data-chat-user-message-content={messageId}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={getChatMarkdownComponents({ compactParagraphs: true })}
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>

      {isCollapsible && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            data-chat-user-message-toggle={messageId}
            onClick={() => setIsExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            <span>{isExpanded ? "Show less" : "Show more"}</span>
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform duration-200",
                isExpanded ? "rotate-180" : "",
              )}
            />
          </button>
        </div>
      )}
    </div>
  );
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
