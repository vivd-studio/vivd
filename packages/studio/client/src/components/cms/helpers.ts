import type {
  CmsEntryRecord,
  CmsFieldDefinition,
  CmsModelRecord,
} from "@vivd/shared/cms";

export type CmsFieldSegment = string | number;

export type RichTextSidecarSpec = {
  pathKey: string;
  fieldPath: CmsFieldSegment[];
  locale: string | null;
  relativeValue: string;
  filePath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function titleizeKey(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizePosix(value: string): string {
  return value.replace(/\\/g, "/");
}

export function dirnamePosix(value: string): string {
  const normalized = normalizePosix(value);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
}

function normalizeRelativeSegments(value: string): string[] {
  return normalizePosix(value)
    .split("/")
    .filter((segment) => segment.length > 0);
}

export function resolveRelativePath(baseFilePath: string, rawPath: string): string {
  const baseSegments = dirnamePosix(baseFilePath)
    .split("/")
    .filter(Boolean);
  const relativeSegments = normalizeRelativeSegments(rawPath);
  if (rawPath.startsWith("/")) {
    return relativeSegments.join("/");
  }

  const resolved = [...baseSegments];
  for (const segment of relativeSegments) {
    if (segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}

export function getValueAtPath(value: unknown, path: CmsFieldSegment[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
      continue;
    }
    if (isRecord(current) && typeof segment === "string") {
      current = current[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

export function setValueAtPath<T>(
  root: T,
  path: CmsFieldSegment[],
  nextValue: unknown,
): T {
  if (path.length === 0) {
    return nextValue as T;
  }

  const [head, ...tail] = path;
  if (typeof head === "number") {
    const currentArray = Array.isArray(root) ? [...root] : [];
    currentArray[head] = setValueAtPath(currentArray[head], tail, nextValue);
    return currentArray as T;
  }

  const currentRecord: Record<string, unknown> = isRecord(root) ? { ...root } : {};
  currentRecord[head] = setValueAtPath(currentRecord[head], tail, nextValue);
  return currentRecord as T;
}

export function getEntryTitle(
  entry: CmsEntryRecord,
  model: CmsModelRecord,
  defaultLocale: string,
): string {
  const primaryField = model.display?.primaryField;
  if (!primaryField) return titleizeKey(entry.key);

  const value = entry.values[primaryField];
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (isRecord(value)) {
    const preferred = value[defaultLocale];
    if (typeof preferred === "string" && preferred.trim()) {
      return preferred;
    }
    const firstString = Object.values(value).find(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    if (firstString) {
      return firstString;
    }
  }

  return titleizeKey(entry.key);
}

export function getAssetPathValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.path === "string") return value.path;
  return "";
}

export function setAssetPathValue(value: unknown, nextPath: string): unknown {
  if (isRecord(value)) {
    return {
      ...value,
      path: nextPath,
    };
  }
  return nextPath;
}

export function buildDefaultFieldValue(
  fieldKey: string,
  field: CmsFieldDefinition,
  defaultLocale: string,
): unknown {
  if (field.localized) {
    if (field.type === "richText" && field.storage === "sidecar-markdown") {
      return {
        [defaultLocale]: buildRichTextReference([fieldKey], defaultLocale),
      };
    }
    return { [defaultLocale]: "" };
  }

  switch (field.type) {
    case "slug":
    case "string":
    case "text":
    case "richText":
    case "date":
    case "datetime":
      return "";
    case "number":
      return typeof field.default === "number" ? field.default : 0;
    case "boolean":
      return typeof field.default === "boolean" ? field.default : false;
    case "enum":
      return field.default ?? field.options?.[0] ?? "";
    case "object": {
      const objectValue: Record<string, unknown> = {};
      for (const [nestedKey, nestedField] of Object.entries(field.fields ?? {})) {
        objectValue[nestedKey] = buildDefaultFieldValue(
          nestedKey,
          nestedField,
          defaultLocale,
        );
      }
      return objectValue;
    }
    case "list":
    case "assetList":
      return [];
    case "asset":
    case "reference":
      return "";
    default:
      return field.default ?? null;
  }
}

export function buildRichTextReference(
  fieldPath: CmsFieldSegment[],
  locale: string,
): string {
  const base = fieldPath
    .map((segment) => String(segment))
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `./${base || "content"}.${locale}.md`;
}

function collectRichTextSidecarsForField(options: {
  field: CmsFieldDefinition;
  value: unknown;
  fieldPath: CmsFieldSegment[];
  entryRelativePath: string;
  results: RichTextSidecarSpec[];
}): void {
  const { field, value, fieldPath, entryRelativePath, results } = options;

  if (field.localized && field.type === "richText" && field.storage === "sidecar-markdown") {
    if (!isRecord(value)) {
      return;
    }
    for (const [locale, relativeValue] of Object.entries(value)) {
      if (typeof relativeValue !== "string" || !relativeValue.trim()) continue;
      const filePath = resolveRelativePath(entryRelativePath, relativeValue);
      results.push({
        pathKey: filePath,
        fieldPath,
        locale,
        relativeValue,
        filePath,
      });
    }
    return;
  }

  if (field.type === "richText" && field.storage === "sidecar-markdown") {
    if (typeof value !== "string" || !value.trim()) {
      return;
    }
    const filePath = resolveRelativePath(entryRelativePath, value);
    results.push({
      pathKey: filePath,
      fieldPath,
      locale: null,
      relativeValue: value,
      filePath,
    });
    return;
  }

  if (field.type === "object" && isRecord(value)) {
    for (const [nestedKey, nestedField] of Object.entries(field.fields ?? {})) {
      collectRichTextSidecarsForField({
        field: nestedField,
        value: value[nestedKey],
        fieldPath: [...fieldPath, nestedKey],
        entryRelativePath,
        results,
      });
    }
    return;
  }

  if (field.type === "list" && Array.isArray(value) && field.item) {
    value.forEach((itemValue, index) => {
      collectRichTextSidecarsForField({
        field: field.item as CmsFieldDefinition,
        value: itemValue,
        fieldPath: [...fieldPath, index],
        entryRelativePath,
        results,
      });
    });
  }
}

export function collectRichTextSidecars(
  fields: Record<string, CmsFieldDefinition>,
  values: Record<string, unknown>,
  entryRelativePath: string,
): RichTextSidecarSpec[] {
  const results: RichTextSidecarSpec[] = [];
  for (const [fieldKey, field] of Object.entries(fields)) {
    collectRichTextSidecarsForField({
      field,
      value: values[fieldKey],
      fieldPath: [fieldKey],
      entryRelativePath,
      results,
    });
  }
  return results;
}

export function deriveReferenceValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    isRecord(value) &&
    typeof value.model === "string" &&
    typeof value.entry === "string"
  ) {
    return `${value.model}:${value.entry}`;
  }
  return "";
}
