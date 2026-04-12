export type CmsFieldPathSegment = string | number;

export type CmsPreviewBindingKind = "text" | "asset";

export interface CmsPreviewBinding {
  modelKey: string;
  entryKey: string;
  fieldPath: CmsFieldPathSegment[];
  kind: CmsPreviewBindingKind | null;
}

export interface CmsPreviewFieldUpdate {
  type: "setCmsField";
  modelKey: string;
  entryKey: string;
  fieldPath: CmsFieldPathSegment[];
  value: unknown;
}

const CMS_COLLECTION_ATTR = "data-cms-collection";
const CMS_ENTRY_ATTR = "data-cms-entry";
const CMS_FIELD_ATTR = "data-cms-field";
const CMS_KIND_ATTR = "data-cms-kind";
const CMS_LOCALE_ATTR = "data-cms-locale";
export const CMS_BINDING_SELECTOR = `[${CMS_COLLECTION_ATTR}][${CMS_ENTRY_ATTR}][${CMS_FIELD_ATTR}]`;

function isElementLike(value: unknown): value is Element {
  return Boolean(
    value &&
      typeof value === "object" &&
      "getAttribute" in value &&
      typeof (value as Element).getAttribute === "function" &&
      "closest" in value &&
      typeof (value as Element).closest === "function",
  );
}

export function parseCmsFieldPath(rawFieldPath: string): CmsFieldPathSegment[] {
  const normalized = rawFieldPath.trim();
  if (!normalized) {
    return [];
  }

  const tokens = normalized.match(/[^.[\]]+|\[\d+\]/g) ?? [];
  return tokens.map((token) => {
    if (token.startsWith("[") && token.endsWith("]")) {
      return Number(token.slice(1, -1));
    }
    return /^\d+$/.test(token) ? Number(token) : token;
  });
}

export function readCmsBindingFromElement(element: Element | null): CmsPreviewBinding | null {
  const bindingElement =
    element && isElementLike(element) ? element.closest(CMS_BINDING_SELECTOR) : null;
  if (!isElementLike(bindingElement)) {
    return null;
  }

  const modelKey = bindingElement.getAttribute(CMS_COLLECTION_ATTR)?.trim() ?? "";
  const entryKey = bindingElement.getAttribute(CMS_ENTRY_ATTR)?.trim() ?? "";
  const rawFieldPath = bindingElement.getAttribute(CMS_FIELD_ATTR)?.trim() ?? "";
  const locale = bindingElement.getAttribute(CMS_LOCALE_ATTR)?.trim() ?? "";
  const rawKind = bindingElement.getAttribute(CMS_KIND_ATTR)?.trim() ?? "";
  const fieldPath = parseCmsFieldPath(rawFieldPath);

  if (!modelKey || !entryKey || fieldPath.length === 0) {
    return null;
  }

  if (locale) {
    fieldPath.push(locale);
  }

  return {
    modelKey,
    entryKey,
    fieldPath,
    kind: rawKind === "text" || rawKind === "asset" ? rawKind : null,
  };
}

export function copyCmsBindingAttributes(source: HTMLElement, target: HTMLElement): void {
  for (const attributeName of [
    CMS_COLLECTION_ATTR,
    CMS_ENTRY_ATTR,
    CMS_FIELD_ATTR,
    CMS_KIND_ATTR,
    CMS_LOCALE_ATTR,
  ]) {
    const value = source.getAttribute(attributeName);
    if (value) {
      target.setAttribute(attributeName, value);
    }
  }
}
