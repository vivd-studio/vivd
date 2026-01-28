export type VivdTextNodePatch = {
  type: "setTextNode";
  selector: string;
  index: number;
  value: string;
};

export type VivdI18nPatch = {
  type: "setI18n";
  key: string;
  lang: string;
  value: string;
};

/**
 * Patch type for Astro components - uses source file info from dev server.
 * This allows direct patching of .astro source files instead of built HTML.
 */
export type AstroTextPatch = {
  type: "setAstroText";
  /** Relative path from project root, e.g. "src/components/Hero.astro" */
  sourceFile: string;
  /** Line:column hint from Astro dev server, e.g. "18:8" */
  sourceLoc?: string;
  /** Original text for matching in source file */
  oldValue: string;
  /** New text to replace with */
  newValue: string;
};

export type VivdPatch = VivdTextNodePatch | VivdI18nPatch | AstroTextPatch;

const normalizeLang = (lang: string) => lang.trim().toLowerCase();
const isLanguageCode = (value: string) => /^[a-z]{2}(-[a-z]{2})?$/.test(value);

export function detectActiveLanguage(doc: Document): string {
  try {
    const view = doc.defaultView ?? null;
    const storage = view?.localStorage ?? null;
    if (storage) {
      const candidates: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key) continue;
        if (!key.endsWith("_lang") && key !== "lang") continue;
        const value = storage.getItem(key);
        if (!value) continue;
        const normalized = normalizeLang(value);
        if (isLanguageCode(normalized))
          candidates.push(normalized.split("-")[0]!);
      }
      if (candidates.length === 1) return candidates[0]!;
    }
  } catch {
    // ignore
  }

  const langToggle = Array.from(
    doc.querySelectorAll<HTMLElement>('[id^="lang-"]'),
  ).find(
    (el) =>
      el.classList.contains("font-bold") ||
      el.getAttribute("aria-current") === "true",
  );
  if (langToggle) {
    const id = langToggle.id ?? "";
    const match = id.match(/^lang-([a-z]{2})$/i);
    if (match?.[1]) return normalizeLang(match[1]);
  }

  const htmlLang = doc.documentElement.getAttribute("lang") ?? "";
  if (htmlLang && isLanguageCode(normalizeLang(htmlLang))) {
    return normalizeLang(htmlLang).split("-")[0]!;
  }

  return "en";
}

export function getI18nKeyForEditableElement(el: HTMLElement): string | null {
  return (
    el.getAttribute("data-i18n") ??
    (el.closest?.("[data-i18n]") as HTMLElement | null)?.getAttribute(
      "data-i18n",
    ) ??
    null
  );
}

export function serializeI18nElementValue(i18nEl: HTMLElement): string {
  const clone = i18nEl.cloneNode(true) as HTMLElement;

  const helperSpans = clone.querySelectorAll<HTMLElement>(
    "[data-vivd-text-parent-selector][data-vivd-text-node-index]",
  );
  helperSpans.forEach((span) => {
    const text = span.textContent ?? "";
    span.replaceWith(clone.ownerDocument.createTextNode(text));
  });

  clone.querySelectorAll<HTMLElement>("[contenteditable]").forEach((el) => {
    el.removeAttribute("contenteditable");
  });
  clone
    .querySelectorAll<HTMLElement>("[data-vivd-editable-container]")
    .forEach((el) => {
      el.removeAttribute("data-vivd-editable-container");
    });

  const hasMarkup = clone.querySelector("*") !== null;
  return hasMarkup ? clone.innerHTML : (clone.textContent ?? "");
}

export function collectVivdTextPatchesFromDocument(doc: Document): VivdPatch[] {
  const patches: VivdPatch[] = [];
  const i18nEdits = new Map<string, HTMLElement>();
  // Track Astro edits by source file + location to dedupe
  const astroEdits = new Map<
    string,
    {
      sourceFile: string;
      sourceLoc?: string;
      oldValue: string;
      newValue: string;
    }
  >();

  const selectorIndex = new Map<string, HTMLElement>();
  doc.querySelectorAll<HTMLElement>("[data-vivd-selector]").forEach((el) => {
    const selector = el.getAttribute("data-vivd-selector");
    if (selector) selectorIndex.set(selector, el);
  });

  const activeLang = detectActiveLanguage(doc);

  const nodes = doc.querySelectorAll<HTMLElement>(
    "[data-vivd-text-parent-selector][data-vivd-text-node-index]",
  );

  nodes.forEach((node) => {
    const i18nKeyFromNode = node.getAttribute("data-vivd-i18n-key");
    const parentSelector = node.getAttribute("data-vivd-text-parent-selector");
    const indexStr = node.getAttribute("data-vivd-text-node-index");
    if (!parentSelector || !indexStr) return;

    const index = Number(indexStr);
    if (!Number.isFinite(index) || index < 1) return;

    const baseline = node.getAttribute("data-vivd-text-baseline");
    if (baseline === null) return;

    const current = node.textContent ?? "";
    if (current === baseline) return;

    // Check for Astro source file info (set during edit mode from data-astro-source-*)
    const sourceFile = node.getAttribute("data-vivd-source-file");
    const sourceLoc = node.getAttribute("data-vivd-source-loc");

    // PRIORITY 1: Check for i18n key first (works for both Astro and static HTML)
    // This allows data-i18n attributes to work even in Astro projects
    if (i18nKeyFromNode) {
      const selector = `[data-i18n="${i18nKeyFromNode.replace(/"/g, '\\"')}"]`;
      const i18nEl =
        (node.closest?.(selector) as HTMLElement | null) ??
        (doc.querySelector(selector) as HTMLElement | null);
      if (i18nEl) {
        i18nEdits.set(i18nKeyFromNode, i18nEl);
        return;
      }
    }

    // PRIORITY 2: Check for data-i18n on parent/ancestor elements
    const parentEl = selectorIndex.get(parentSelector) ?? null;
    const resolvedI18nEl = parentEl?.closest?.("[data-i18n]") ?? null;
    const i18nEl = resolvedI18nEl || node.closest?.("[data-i18n]");
    if (i18nEl instanceof HTMLElement) {
      const key = i18nEl.getAttribute("data-i18n") ?? "";
      if (key) {
        i18nEdits.set(key, i18nEl);
        return;
      }
    }

    // PRIORITY 3: Astro source file patching (only if no i18n key found)
    if (sourceFile) {
      const key = `${sourceFile}:${baseline}`;
      astroEdits.set(key, {
        sourceFile,
        sourceLoc: sourceLoc ?? undefined,
        oldValue: baseline,
        newValue: current,
      });
      return;
    }

    // PRIORITY 4: Fall back to direct text node patching (no i18n, no Astro source)
    patches.push({
      type: "setTextNode",
      selector: parentSelector,
      index,
      value: current,
    });
  });

  // Add i18n patches
  i18nEdits.forEach((el, key) => {
    patches.push({
      type: "setI18n",
      key,
      lang: activeLang,
      value: serializeI18nElementValue(el),
    });
  });

  // Add Astro patches
  astroEdits.forEach((edit) => {
    patches.push({
      type: "setAstroText",
      sourceFile: edit.sourceFile,
      sourceLoc: edit.sourceLoc,
      oldValue: edit.oldValue,
      newValue: edit.newValue,
    });
  });

  return patches;
}
