import { X, Code } from "lucide-react";

interface SelectedElementPillProps {
  selector: string;
  description: string;
  onRemove?: () => void;
}

export function SelectedElementPill({
  selector,
  description,
  onRemove,
}: SelectedElementPillProps) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-sm max-w-full">
      <Code className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
      <span
        className="text-amber-700 dark:text-amber-300 truncate"
        title={selector}
      >
        {description}
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="shrink-0 p-0.5 rounded-full hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 transition-colors"
          aria-label="Remove element reference"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// Simpler pill for display in messages (no remove button, smaller)
export function ElementRefPill({ html }: { html: string }) {
  // For XPath, show a shortened version
  let label = html;

  // If it's an ID-based XPath, show the ID
  const idMatch = html.match(/\[@id="([^"]+)"\]/);
  if (idMatch) {
    label = `#${idMatch[1]}`;
  } else {
    // Otherwise show the last part of the path
    const parts = html.split("/").filter((p) => p);
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      // Remove position indicator for display
      label = lastPart.replace(/\[\d+\]$/, "");
    }
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-mono"
      title={html}
    >
      <Code className="w-3 h-3" />
      {label}
    </span>
  );
}

// Format the message with the element ref tag for the LLM
// Includes file and text excerpt for easier element identification
export function formatMessageWithSelector(
  message: string,
  selector: string,
  filename?: string,
  text?: string
): string {
  // Build a compact element reference with additional context
  let ref = selector;
  const parts: string[] = [];

  if (filename) {
    parts.push(`file: ${filename}`);
  }
  if (text) {
    // Take first 30 chars of text, clean up whitespace
    const cleanText = text.replace(/\s+/g, " ").trim().slice(0, 30);
    if (cleanText) {
      parts.push(`text: "${cleanText}${text.length > 30 ? "..." : ""}"`);
    }
  }

  if (parts.length > 0) {
    ref = `${selector} (${parts.join(", ")})`;
  }

  return `${message}\n\n<element-ref>${ref}</element-ref>`;
}

// Parse element ref from a message if it contains the tag
export function parseElementRef(message: string): {
  cleanMessage: string;
  elementHtml: string | null;
} {
  const match = message.match(/<element-ref>([\s\S]*?)<\/element-ref>/);
  if (match) {
    const cleanMessage = message
      .replace(/<element-ref>[\s\S]*?<\/element-ref>/, "")
      .trim();
    return { cleanMessage, elementHtml: match[1] };
  }
  return { cleanMessage: message, elementHtml: null };
}
