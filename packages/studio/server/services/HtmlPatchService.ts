import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { applyI18nPatchesToInlineScripts } from "./htmlPatching/i18nInlinePatches.js";

type HtmlDocument = DefaultTreeAdapterMap["document"];
type HtmlParentNode = DefaultTreeAdapterMap["parentNode"];
type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];
type HtmlTextNode = DefaultTreeAdapterMap["textNode"];

export type HtmlPatch =
  | {
      type: "setTextNode";
      selector: string;
      index: number;
      value: string;
    }
  | {
      type: "setI18n";
      key: string;
      lang: string;
      value: string;
    }
  | {
      type: "setAttr";
      selector: string;
      name: string;
      value: string;
    };

export interface ApplyHtmlPatchesResult {
  html: string;
  applied: number;
  skipped: number;
  errors: Array<{ selector: string; reason: string }>;
}

type HtmlEdit = { start: number; end: number; replacement: string };

function isElement(node: HtmlNode): node is HtmlElement {
  return (
    typeof (node as HtmlElement).tagName === "string" &&
    typeof (node as HtmlElement).nodeName === "string"
  );
}

function isTextNode(node: HtmlNode): node is HtmlTextNode {
  return (
    (node as HtmlTextNode).nodeName === "#text" &&
    typeof (node as HtmlTextNode).value === "string"
  );
}

function getChildElements(node: HtmlParentNode): HtmlElement[] {
  return node.childNodes.filter(isElement);
}

function getDirectNonWhitespaceTextNodes(element: HtmlElement): HtmlTextNode[] {
  return (element.childNodes as HtmlNode[])
    .filter(isTextNode)
    .filter((n) => n.value.trim().length > 0);
}

function findFirstElementByTagName(
  node: HtmlParentNode,
  tagName: string
): HtmlElement | null {
  const stack: HtmlParentNode[] = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    const children = getChildElements(current);
    for (const child of children) {
      if (child.tagName.toLowerCase() === tagName) return child;
      stack.push(child);
    }
  }
  return null;
}

function findElementById(
  node: HtmlParentNode,
  id: string
): HtmlElement | null {
  const stack: HtmlParentNode[] = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    const children = getChildElements(current);
    for (const child of children) {
      const attr = child.attrs.find((a) => a.name.toLowerCase() === "id");
      if (attr?.value === id) return child;
      stack.push(child);
    }
  }
  return null;
}

type PathSegment = { tagName: string; index: number };

function parseVivdSelector(selector: string):
  | { kind: "id"; id: string }
  | { kind: "path"; segments: PathSegment[] }
  | { kind: "unknown" } {
  const idMatch = selector.match(
    /^\/\/\*\[@id=(?:"([^"]+)"|'([^']+)')\]$/
  );
  if (idMatch) {
    return { kind: "id", id: idMatch[1] ?? idMatch[2] ?? "" };
  }

  if (selector.startsWith("/")) {
    const parts = selector
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);

    if (!parts.length) return { kind: "unknown" };

    const segments: PathSegment[] = [];
    for (const part of parts) {
      const match = part.match(/^([a-zA-Z0-9_-]+)(?:\[(\d+)\])?$/);
      if (!match) return { kind: "unknown" };
      const tagName = match[1].toLowerCase();
      const index = Number(match[2] ?? "1");
      if (!Number.isFinite(index) || index < 1) return { kind: "unknown" };
      segments.push({ tagName, index });
    }

    return { kind: "path", segments };
  }

  return { kind: "unknown" };
}

function resolveSelector(
  doc: HtmlDocument,
  selector: string
): HtmlElement | null {
  const parsed = parseVivdSelector(selector);
  if (parsed.kind === "unknown") return null;

  if (parsed.kind === "id") {
    return findElementById(doc, parsed.id);
  }

  const htmlEl = findFirstElementByTagName(doc, "html");
  if (!htmlEl) return null;
  const bodyEl = findFirstElementByTagName(htmlEl, "body");
  if (!bodyEl) return null;

  let current: HtmlElement = bodyEl;
  for (const segment of parsed.segments) {
    const candidates = getChildElements(current).filter(
      (el) => el.tagName.toLowerCase() === segment.tagName
    );
    const next = candidates[segment.index - 1] ?? null;
    if (!next) return null;
    current = next;
  }
  return current;
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function replaceAttributeSource(
  attrName: string,
  newValue: string,
  previousSource: string
): string {
  const quoteMatch = previousSource.match(/=(['"])/);
  const quote = quoteMatch?.[1] ?? '"';
  const escapedValue =
    quote === '"'
      ? escapeAttributeValue(newValue)
      : newValue.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
  return `${attrName}=${quote}${escapedValue}${quote}`;
}

function getStartTagInsertionOffset(
  html: string,
  startOffset: number,
  endOffset: number
): number | null {
  const source = html.slice(startOffset, endOffset);
  const gtIndex = source.lastIndexOf(">");
  if (gtIndex < 0) return null;

  let cursor = gtIndex - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor--;
  const lastNonWhitespace = cursor >= 0 ? source[cursor] : null;

  if (lastNonWhitespace === "/") {
    return startOffset + cursor;
  }

  return startOffset + gtIndex;
}

export function applyHtmlPatches(
  html: string,
  patches: HtmlPatch[]
): ApplyHtmlPatchesResult {
  const doc = parse<DefaultTreeAdapterMap>(html, {
    sourceCodeLocationInfo: true,
  });

  const errors: Array<{ selector: string; reason: string }> = [];
  const edits: HtmlEdit[] = [];
  let skipped = 0;

  const uniquePatches = new Map<string, HtmlPatch>();
  for (const patch of patches) {
    const key =
      patch.type === "setAttr"
        ? `${patch.type}:${patch.selector}:${patch.name}`
        : patch.type === "setI18n"
        ? `${patch.type}:${patch.key}:${patch.lang}`
        : `${patch.type}:${patch.selector}:${patch.index}`;
    uniquePatches.set(key, patch);
  }

  // Apply i18n patches to inline scripts (if present).
  const i18nPatches = Array.from(uniquePatches.values()).filter(
    (p): p is Extract<HtmlPatch, { type: "setI18n" }> => p.type === "setI18n"
  );

  if (i18nPatches.length) {
    const i18nResult = applyI18nPatchesToInlineScripts(
      html,
      doc,
      i18nPatches.map((p) => ({ key: p.key, lang: p.lang, value: p.value }))
    );
    skipped += i18nResult.skipped;
    errors.push(...i18nResult.errors);
    edits.push(...i18nResult.edits);
  }

  for (const patch of uniquePatches.values()) {
    if (patch.type === "setI18n") continue;
    const element = resolveSelector(doc, patch.selector);
    if (!element) {
      skipped++;
      errors.push({ selector: patch.selector, reason: "Element not found" });
      continue;
    }

    if (patch.type === "setTextNode") {
      if (!Number.isFinite(patch.index) || patch.index < 1) {
        skipped++;
        errors.push({
          selector: patch.selector,
          reason: "Invalid text node index",
        });
        continue;
      }

      const textNodes = getDirectNonWhitespaceTextNodes(element);
      const targetNode = textNodes[patch.index - 1] ?? null;
      if (!targetNode) {
        skipped++;
        errors.push({
          selector: patch.selector,
          reason: "Text node not found",
        });
        continue;
      }

      const nodeLoc = targetNode.sourceCodeLocation ?? null;
      if (!nodeLoc) {
        skipped++;
        errors.push({
          selector: patch.selector,
          reason: "Missing text node location info",
        });
        continue;
      }

      const start = nodeLoc.startOffset;
      const end = nodeLoc.endOffset;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        skipped++;
        errors.push({
          selector: patch.selector,
          reason: "Invalid text node range",
        });
        continue;
      }

      const originalValue = targetNode.value ?? "";
      const match = originalValue.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const prefix = match?.[1] ?? "";
      const suffix = match?.[3] ?? "";
      const replacement = escapeHtmlText(prefix + patch.value + suffix);
      const current = html.slice(start, end);
      if (current === replacement) {
        skipped++;
        continue;
      }

      edits.push({ start, end, replacement });
      continue;
    }

    const loc = element.sourceCodeLocation ?? null;
    if (!loc || !loc.startTag) {
      skipped++;
      errors.push({
        selector: patch.selector,
        reason: "Missing source location info",
      });
      continue;
    }

    const attrName = patch.name.toLowerCase();
    const attrLoc = loc.attrs?.[attrName];
    if (attrLoc) {
      const start = attrLoc.startOffset;
      const end = attrLoc.endOffset;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        skipped++;
        errors.push({
          selector: patch.selector,
          reason: `Invalid attribute range for ${attrName}`,
        });
        continue;
      }

      const previousSource = html.slice(start, end);
      const replacement = replaceAttributeSource(
        attrName,
        patch.value,
        previousSource
      );

      if (previousSource === replacement) {
        skipped++;
        continue;
      }

      edits.push({ start, end, replacement });
      continue;
    }

    const insertAt = getStartTagInsertionOffset(
      html,
      loc.startTag.startOffset,
      loc.startTag.endOffset
    );
    if (insertAt === null) {
      skipped++;
      errors.push({
        selector: patch.selector,
        reason: "Could not determine start tag insertion point",
      });
      continue;
    }

    edits.push({
      start: insertAt,
      end: insertAt,
      replacement: ` ${attrName}="${escapeAttributeValue(patch.value)}"`,
    });
  }

  if (!edits.length) {
    return { html, applied: 0, skipped, errors };
  }

  edits.sort((a, b) => b.start - a.start);

  let nextHtml = html;
  for (const edit of edits) {
    nextHtml =
      nextHtml.slice(0, edit.start) +
      edit.replacement +
      nextHtml.slice(edit.end);
  }

  return { html: nextHtml, applied: edits.length, skipped, errors };
}
