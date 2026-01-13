import { X, Code, Image } from "lucide-react";

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

// Pill for displaying dropped image attachments in message bubbles
export function DroppedImagePill({ filename }: { filename: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/15 border border-blue-500/30 text-xs"
      title={filename}
    >
      <Image className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
      <span className="text-blue-700 dark:text-blue-300 truncate max-w-[150px]">
        {filename}
      </span>
    </span>
  );
}

// Format the message with element ref as vivd-internal self-closing tag
// For Astro projects, use source file and loc. Otherwise, use XPath.
export function formatMessageWithSelector(
  message: string,
  selector: string,
  filename?: string,
  text?: string,
  astroSourceFile?: string | null,
  astroSourceLoc?: string | null
): string {
  // Build attributes for the tag
  const attrs: string[] = [`type="element-ref"`];

  // Prefer Astro source file info over XPath when available
  if (astroSourceFile) {
    attrs.push(`source-file="${astroSourceFile}"`);
    if (astroSourceLoc) {
      attrs.push(`source-loc="${astroSourceLoc}"`);
    }
  } else {
    // Fall back to XPath selector
    attrs.push(`selector="${selector}"`);
    if (filename) {
      attrs.push(`file="${filename}"`);
    }
  }

  if (text) {
    // Take first 30 chars of text, clean up whitespace, escape quotes
    const cleanText = text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 30)
      .replace(/"/g, "'");
    if (cleanText) {
      attrs.push(`text="${cleanText}${text.length > 30 ? "..." : ""}"`);
    }
  }

  return `${message}\n\n<vivd-internal ${attrs.join(" ")} />`;
}

// Interface for parsed vivd-internal tags (unified for all types)
export interface VivdInternalTag {
  type: string;
  // For dropped-image
  filename?: string;
  path?: string;
  // For element-ref (XPath fallback)
  selector?: string;
  file?: string;
  text?: string;
  // For element-ref (Astro source info)
  "source-file"?: string;
  "source-loc"?: string;
}

// Parse all vivd-internal self-closing tags from a message
export function parseVivdInternalTags(message: string): {
  cleanMessage: string;
  internalTags: VivdInternalTag[];
} {
  const internalTags: VivdInternalTag[] = [];

  // Match self-closing vivd-internal tags: <vivd-internal ... />
  const regex = /<vivd-internal\s+([^>]*?)\s*\/>/g;

  let match;
  while ((match = regex.exec(message)) !== null) {
    const attrsString = match[1];
    const tag: VivdInternalTag = { type: "" };

    // Parse attributes using regex
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrsString)) !== null) {
      const [, key, value] = attrMatch;
      (tag as any)[key] = value;
    }

    if (tag.type) {
      internalTags.push(tag);
    }
  }

  // Remove all vivd-internal tags from message
  const cleanMessage = message
    .replace(/<vivd-internal\s+[^>]*?\/>/g, "")
    .trim();

  return { cleanMessage, internalTags };
}

// Legacy function for backwards compatibility - now uses parseVivdInternalTags
export function parseElementRef(message: string): {
  cleanMessage: string;
  elementHtml: string | null;
} {
  // First try the new vivd-internal format
  const { cleanMessage: cleanAfterInternal, internalTags } =
    parseVivdInternalTags(message);
  const elementTag = internalTags.find((t) => t.type === "element-ref");
  if (elementTag?.selector) {
    return {
      cleanMessage: cleanAfterInternal,
      elementHtml: elementTag.selector,
    };
  }

  // Fall back to legacy <element-ref> format for older messages
  const match = message.match(/<element-ref>([\s\S]*?)<\/element-ref>/);
  if (match) {
    const cleanMessage = message
      .replace(/<element-ref>[\s\S]*?<\/element-ref>/, "")
      .trim();
    return { cleanMessage, elementHtml: match[1] };
  }
  return { cleanMessage: message, elementHtml: null };
}
