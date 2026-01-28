import type { DefaultTreeAdapterMap } from "parse5";

type HtmlDocument = DefaultTreeAdapterMap["document"];
type HtmlParentNode = DefaultTreeAdapterMap["parentNode"];
type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];
type HtmlTextNode = DefaultTreeAdapterMap["textNode"];

export type InlineI18nPatch = { key: string; lang: string; value: string };
export type HtmlEdit = { start: number; end: number; replacement: string };
export type PatchError = { selector: string; reason: string };

type ScanState =
  | { kind: "code" }
  | { kind: "lineComment" }
  | { kind: "blockComment" }
  | { kind: "singleQuote"; escaped: boolean }
  | { kind: "doubleQuote"; escaped: boolean }
  | { kind: "template"; escaped: boolean };

function isElement(
  node: HtmlNode
): node is HtmlElement {
  return (
    typeof (node as HtmlElement).tagName === "string" &&
    typeof (node as HtmlElement).nodeName === "string"
  );
}

function isTextNode(
  node: HtmlNode
): node is HtmlTextNode {
  return (
    (node as HtmlTextNode).nodeName === "#text" &&
    typeof (node as HtmlTextNode).value === "string"
  );
}

function scanToMatchingBrace(source: string, startIndex: number): number | null {
  if (source[startIndex] !== "{") return null;
  let depth = 0;
  let state: ScanState = { kind: "code" };

  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];
    const next = i + 1 < source.length ? source[i + 1] : "";

    if (state.kind === "lineComment") {
      if (ch === "\n") state = { kind: "code" };
      continue;
    }
    if (state.kind === "blockComment") {
      if (ch === "*" && next === "/") {
        state = { kind: "code" };
        i++;
      }
      continue;
    }
    if (state.kind === "singleQuote") {
      if (state.escaped) {
        state = { kind: "singleQuote", escaped: false };
        continue;
      }
      if (ch === "\\") {
        state = { kind: "singleQuote", escaped: true };
        continue;
      }
      if (ch === "'") {
        state = { kind: "code" };
      }
      continue;
    }
    if (state.kind === "doubleQuote") {
      if (state.escaped) {
        state = { kind: "doubleQuote", escaped: false };
        continue;
      }
      if (ch === "\\") {
        state = { kind: "doubleQuote", escaped: true };
        continue;
      }
      if (ch === '"') {
        state = { kind: "code" };
      }
      continue;
    }
    if (state.kind === "template") {
      if (state.escaped) {
        state = { kind: "template", escaped: false };
        continue;
      }
      if (ch === "\\") {
        state = { kind: "template", escaped: true };
        continue;
      }
      if (ch === "`") {
        state = { kind: "code" };
        continue;
      }
      continue;
    }

    // code
    if (ch === "/" && next === "/") {
      state = { kind: "lineComment" };
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      state = { kind: "blockComment" };
      i++;
      continue;
    }
    if (ch === "'") {
      state = { kind: "singleQuote", escaped: false };
      continue;
    }
    if (ch === '"') {
      state = { kind: "doubleQuote", escaped: false };
      continue;
    }
    if (ch === "`") {
      state = { kind: "template", escaped: false };
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return null;
    }
  }

  return null;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeJsSingleQuotedString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function findTranslationsObjectRange(
  script: string
): { start: number; end: number } | null {
  const patterns = [
    /\b(?:const|let|var)\s+translations\s*=\s*\{/,
    /\btranslations\s*=\s*\{/,
  ];

  for (const pattern of patterns) {
    const match = script.match(pattern);
    if (!match?.index && match?.index !== 0) continue;

    const matchIndex = match.index;
    const braceIndex = script.indexOf("{", matchIndex);
    if (braceIndex < 0) continue;
    const endBrace = scanToMatchingBrace(script, braceIndex);
    if (endBrace === null) continue;
    return { start: braceIndex, end: endBrace };
  }
  return null;
}

function upsertObjectPropertyString(
  objectSource: string,
  propertyName: string,
  newValue: string
): string | null {
  if (!objectSource.startsWith("{")) return null;
  const endBrace = scanToMatchingBrace(objectSource, 0);
  if (endBrace === null || endBrace !== objectSource.length - 1) return null;

  let state: ScanState = { kind: "code" };
  let depth = 0;

  const isIdentStart = (ch: string) => /[A-Za-z_$]/.test(ch);
  const isIdent = (ch: string) => /[A-Za-z0-9_$]/.test(ch);

  for (let i = 0; i < objectSource.length; i++) {
    const ch = objectSource[i];
    const next = i + 1 < objectSource.length ? objectSource[i + 1] : "";

    if (state.kind === "lineComment") {
      if (ch === "\n") state = { kind: "code" };
      continue;
    }
    if (state.kind === "blockComment") {
      if (ch === "*" && next === "/") {
        state = { kind: "code" };
        i++;
      }
      continue;
    }
    if (state.kind === "singleQuote") {
      if (state.escaped) {
        state = { kind: "singleQuote", escaped: false };
        continue;
      }
      if (ch === "\\") {
        state = { kind: "singleQuote", escaped: true };
        continue;
      }
      if (ch === "'") state = { kind: "code" };
      continue;
    }
    if (state.kind === "doubleQuote") {
      if (state.escaped) {
        state = { kind: "doubleQuote", escaped: false };
        continue;
      }
      if (ch === "\\") {
        state = { kind: "doubleQuote", escaped: true };
        continue;
      }
      if (ch === '"') state = { kind: "code" };
      continue;
    }
    if (state.kind === "template") {
      if (state.escaped) {
        state = { kind: "template", escaped: false };
        continue;
      }
      if (ch === "\\") {
        state = { kind: "template", escaped: true };
        continue;
      }
      if (ch === "`") state = { kind: "code" };
      continue;
    }

    // code
    if (ch === "/" && next === "/") {
      state = { kind: "lineComment" };
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      state = { kind: "blockComment" };
      i++;
      continue;
    }
    if (ch === "'") {
      state = { kind: "singleQuote", escaped: false };
      continue;
    }
    if (ch === '"') {
      state = { kind: "doubleQuote", escaped: false };
      continue;
    }
    if (ch === "`") {
      state = { kind: "template", escaped: false };
      continue;
    }

    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      continue;
    }

    if (depth !== 1) continue;
    if (!isIdentStart(ch)) continue;

    let j = i + 1;
    while (j < objectSource.length && isIdent(objectSource[j])) j++;
    const ident = objectSource.slice(i, j);
    if (ident !== propertyName) continue;

    let k = j;
    while (k < objectSource.length && /\s/.test(objectSource[k])) k++;
    if (objectSource[k] !== ":") continue;
    k++;
    while (k < objectSource.length && /\s/.test(objectSource[k])) k++;

    const quote = objectSource[k];
    if (quote !== "'" && quote !== '"') continue;

    const stringStart = k;
    let escaped = false;
    let m = k + 1;
    for (; m < objectSource.length; m++) {
      const c = objectSource[m];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === quote) break;
    }
    if (m >= objectSource.length) return null;
    const stringEndInclusive = m;

    const escapedValue =
      quote === "'"
        ? escapeJsSingleQuotedString(newValue)
        : newValue
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\r/g, "\\r")
            .replace(/\n/g, "\\n");
    const replacement = `${quote}${escapedValue}${quote}`;
    const before = objectSource.slice(0, stringStart);
    const after = objectSource.slice(stringEndInclusive + 1);
    return before + replacement + after;
  }

  const beforeClose = objectSource.slice(0, objectSource.length - 1);
  const trimmed = beforeClose.trimEnd();
  const isEmpty = trimmed === "{";
  const hasNewlines = beforeClose.includes("\n");

  let indent = "  ";
  if (hasNewlines) {
    const lastLineStart = beforeClose.lastIndexOf("\n");
    const line = beforeClose.slice(lastLineStart + 1);
    const match = line.match(/^(\s*)/);
    indent = match?.[1] ?? indent;
  }

  const entry = `${propertyName}: '${escapeJsSingleQuotedString(newValue)}'`;
  const insertion = isEmpty
    ? hasNewlines
      ? `\n${indent}${entry}\n`
      : ` ${entry} `
    : hasNewlines
    ? `,\n${indent}${entry}\n`
    : `, ${entry} `;

  return trimmed + insertion + "}";
}

function upsertI18nEntryInObjectSource(
  objectSource: string,
  key: string,
  lang: string,
  value: string
): string | null {
  if (!objectSource.startsWith("{")) return null;
  const endBrace = scanToMatchingBrace(objectSource, 0);
  if (endBrace === null || endBrace !== objectSource.length - 1) return null;

  const isIdentifierKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
  const quotedKeyRegex = new RegExp(
    `(^|[,{\\s])(['\"])${escapeRegex(key)}\\2\\s*:\\s*\\{`,
    "m"
  );
  const identKeyRegex = isIdentifierKey
    ? new RegExp(`(^|[,{\\s])${escapeRegex(key)}\\s*:\\s*\\{`, "m")
    : null;

  let match: RegExpMatchArray | null = objectSource.match(quotedKeyRegex);
  let keyMatchIndex: number | null = null;
  if (match?.index !== undefined) {
    keyMatchIndex = match.index + (match[1]?.length ?? 0);
  } else if (identKeyRegex) {
    match = objectSource.match(identKeyRegex);
    if (match?.index !== undefined) {
      keyMatchIndex = match.index + (match[1]?.length ?? 0);
    }
  }

  if (keyMatchIndex !== null) {
    const braceIndex = objectSource.indexOf("{", keyMatchIndex);
    if (braceIndex < 0) return null;
    const entryEndBrace = scanToMatchingBrace(objectSource, braceIndex);
    if (entryEndBrace === null) return null;

    const entrySource = objectSource.slice(braceIndex, entryEndBrace + 1);
    const updatedEntry = upsertObjectPropertyString(entrySource, lang, value);
    if (updatedEntry === null) return null;

    return (
      objectSource.slice(0, braceIndex) +
      updatedEntry +
      objectSource.slice(entryEndBrace + 1)
    );
  }

  const body = objectSource.slice(1, -1);
  const hasNewlines = body.includes("\n");

  let indent = "  ";
  const firstKey = objectSource.match(/\n(\s*)['"][^'"]+['"]\s*:/);
  if (firstKey) indent = firstKey[1] ?? indent;

  const langEntry = `${lang}: '${escapeJsSingleQuotedString(value)}'`;
  const newEntry = `'${key}': { ${langEntry} }`;

  const trimmedBody = body.trimEnd();
  const hasExistingEntries = trimmedBody.trim().length > 0;

  const insertion = hasNewlines
    ? hasExistingEntries
      ? `\n${indent}${newEntry},`
      : `\n${indent}${newEntry}\n`
    : hasExistingEntries
    ? ` ${newEntry}, `
    : ` ${newEntry} `;

  return "{" + trimmedBody + insertion + "}";
}

function upsertTranslationsEntry(
  script: string,
  key: string,
  lang: string,
  value: string
): { script: string; changed: boolean } | null {
  const range = findTranslationsObjectRange(script);
  if (!range) return null;
  const objectSource = script.slice(range.start, range.end + 1);

  const updatedObjectSource = upsertI18nEntryInObjectSource(
    objectSource,
    key,
    lang,
    value
  );
  if (updatedObjectSource === null) return null;

  const updatedScript =
    script.slice(0, range.start) +
    updatedObjectSource +
    script.slice(range.end + 1);
  return { script: updatedScript, changed: updatedScript !== script };
}

function findObjectLiteralAssignments(
  script: string
): Array<{ start: number; end: number }> {
  const matches = Array.from(
    script.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*\{/g)
  );

  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of matches) {
    if (match.index === undefined) continue;
    const braceIndex = script.indexOf("{", match.index);
    if (braceIndex < 0) continue;
    const endBrace = scanToMatchingBrace(script, braceIndex);
    if (endBrace === null) continue;
    ranges.push({ start: braceIndex, end: endBrace });
  }
  return ranges;
}

function upsertI18nEntryAnywhere(
  script: string,
  key: string,
  lang: string,
  value: string
): { script: string; changed: boolean } | null {
  const direct = upsertTranslationsEntry(script, key, lang, value);
  if (direct) return direct;

  const ranges = findObjectLiteralAssignments(script);
  for (const range of ranges) {
    const objectSource = script.slice(range.start, range.end + 1);
    if (
      !objectSource.includes(`'${key}'`) &&
      !objectSource.includes(`"${key}"`) &&
      !objectSource.includes(`${key}:`)
    ) {
      continue;
    }

    const updatedObjectSource = upsertI18nEntryInObjectSource(
      objectSource,
      key,
      lang,
      value
    );
    if (updatedObjectSource === null) continue;

    const updatedScript =
      script.slice(0, range.start) +
      updatedObjectSource +
      script.slice(range.end + 1);
    return { script: updatedScript, changed: updatedScript !== script };
  }

  const quotedKeyRegex = new RegExp(
    `(^|[,{\\s])(['\"])${escapeRegex(key)}\\2\\s*:\\s*\\{`,
    "m"
  );
  const match = script.match(quotedKeyRegex);
  if (match?.index === undefined) return null;

  const keyMatchIndex = match.index + (match[1]?.length ?? 0);
  const braceIndex = script.indexOf("{", keyMatchIndex);
  if (braceIndex < 0) return null;
  const entryEndBrace = scanToMatchingBrace(script, braceIndex);
  if (entryEndBrace === null) return null;

  const entrySource = script.slice(braceIndex, entryEndBrace + 1);
  const updatedEntry = upsertObjectPropertyString(entrySource, lang, value);
  if (updatedEntry === null) return null;

  const updatedScript =
    script.slice(0, braceIndex) +
    updatedEntry +
    script.slice(entryEndBrace + 1);
  return { script: updatedScript, changed: updatedScript !== script };
}

export function applyI18nPatchesToInlineScripts(
  html: string,
  doc: HtmlDocument,
  patches: InlineI18nPatch[]
): { edits: HtmlEdit[]; skipped: number; errors: PatchError[] } {
  const edits: HtmlEdit[] = [];
  const errors: PatchError[] = [];
  let skipped = 0;

  const scriptNodes: Array<{ start: number; end: number; original: string }> =
    [];
  const stack: HtmlParentNode[] = [doc];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    const children = (current.childNodes as HtmlNode[]) ?? [];
    for (const child of children) {
      if (isElement(child) && child.tagName.toLowerCase() === "script") {
        const textChild = (child.childNodes as HtmlNode[]).find(isTextNode) ?? null;
        const loc = textChild?.sourceCodeLocation ?? null;
        if (textChild && loc) {
          scriptNodes.push({
            start: loc.startOffset,
            end: loc.endOffset,
            original: html.slice(loc.startOffset, loc.endOffset),
          });
        }
        continue;
      }

      if ((child as HtmlParentNode)?.childNodes) {
        stack.push(child as HtmlParentNode);
      }
    }
  }

  const nextByIndex = new Map<number, string>();
  for (const patch of patches) {
    let applied = false;
    for (let i = 0; i < scriptNodes.length; i++) {
      const node = scriptNodes[i]!;
      const currentScript = nextByIndex.get(i) ?? node.original;
      const updated = upsertI18nEntryAnywhere(
        currentScript,
        patch.key,
        patch.lang,
        patch.value
      );
      if (!updated) continue;
      nextByIndex.set(i, updated.script);
      applied = true;
      break;
    }

    if (!applied) {
      skipped++;
      errors.push({
        selector: `i18n:${patch.key}:${patch.lang}`,
        reason: "I18n entry not found in inline scripts",
      });
    }
  }

  for (const [idx, updatedScript] of nextByIndex.entries()) {
    const node = scriptNodes[idx];
    if (!node) continue;
    if (updatedScript !== node.original) {
      edits.push({
        start: node.start,
        end: node.end,
        replacement: updatedScript,
      });
    }
  }

  return { edits, skipped, errors };
}

