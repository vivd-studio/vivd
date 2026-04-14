import path from "path";
import { stringify as stringifyYaml } from "yaml";
import type { CmsFieldDefinition, CmsSourceKind } from "./index.js";

const NON_LOCAL_ASSET_REFERENCE_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function dirnamePosix(value: string): string {
  const normalized = normalizePosixPath(value);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
}

function buildRelativeReferencePath(baseFilePath: string, targetPath: string): string {
  const baseDir = dirnamePosix(baseFilePath) || ".";
  return (
    path.posix.relative(
      baseDir,
      normalizePosixPath(targetPath).replace(/^\/+/, ""),
    ) || "."
  );
}

function getCmsEntryFileFormat(
  filePath: string,
): "yaml" | "json" | "markdown" | "unsupported" {
  const normalized = normalizePosixPath(filePath).toLowerCase();
  if (normalized.endsWith(".yaml") || normalized.endsWith(".yml")) {
    return "yaml";
  }
  if (normalized.endsWith(".json")) {
    return "json";
  }
  if (
    normalized.endsWith(".md") ||
    normalized.endsWith(".mdx") ||
    normalized.endsWith(".markdown")
  ) {
    return "markdown";
  }
  return "unsupported";
}

export function serializeCmsEntryValues(
  filePath: string,
  value: Record<string, unknown>,
  currentContent = "",
): string {
  const format = getCmsEntryFileFormat(filePath);
  switch (format) {
    case "yaml":
      return `${stringifyYaml(value)}\n`;
    case "json":
      return `${JSON.stringify(value, null, 2)}\n`;
    case "markdown": {
      const frontmatter = stringifyYaml(value).trimEnd();
      const existingMatch = currentContent.match(
        /^---[ \t]*\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/,
      );
      const body = existingMatch
        ? currentContent.slice(existingMatch[0].length)
        : currentContent;
      if (!body.length) {
        return `---\n${frontmatter}\n---\n`;
      }
      return `---\n${frontmatter}\n---\n\n${body.replace(/^\r?\n/, "")}`;
    }
    default:
      throw new Error(`Unsupported CMS entry format for ${filePath}`);
  }
}

export function setValueAtPath<T>(
  root: T,
  pathSegments: Array<string | number>,
  nextValue: unknown,
): T {
  if (pathSegments.length === 0) {
    return nextValue as T;
  }

  const [head, ...tail] = pathSegments;
  if (typeof head === "number") {
    const currentArray = Array.isArray(root) ? [...root] : [];
    currentArray[head] = setValueAtPath(currentArray[head], tail, nextValue);
    return currentArray as T;
  }

  const currentRecord: Record<string, unknown> = isRecord(root) ? { ...root } : {};
  currentRecord[head] = setValueAtPath(currentRecord[head], tail, nextValue);
  return currentRecord as T;
}

export function resolveFieldDefinitionAtPath(
  fields: Record<string, CmsFieldDefinition>,
  fieldPath: Array<string | number>,
): CmsFieldDefinition | null {
  const [rootSegment, ...rest] = fieldPath;
  if (typeof rootSegment !== "string") {
    return null;
  }

  let current: CmsFieldDefinition | undefined = fields[rootSegment];
  if (!current) {
    return null;
  }

  let index = 0;
  while (index < rest.length) {
    const segment = rest[index];

    if (current.localized) {
      if (typeof segment !== "string") {
        return null;
      }
      index += 1;
      if (index >= rest.length) {
        return current;
      }
      continue;
    }

    if (current.type === "object") {
      if (typeof segment !== "string") {
        return null;
      }
      current = current.fields?.[segment];
      if (!current) {
        return null;
      }
      index += 1;
      continue;
    }

    if (current.type === "list") {
      if (typeof segment !== "number" || !current.item) {
        return null;
      }
      current = current.item;
      index += 1;
      continue;
    }

    if (current.type === "assetList") {
      if (typeof segment !== "number") {
        return null;
      }
      current = {
        type: "asset",
        required: current.required,
        accepts: current.accepts,
      };
      index += 1;
      continue;
    }

    return null;
  }

  return current;
}

export function normalizeUpdatedFieldValue(
  entryRelativePath: string,
  field: CmsFieldDefinition | null,
  value: unknown,
  options?: { sourceKind?: CmsSourceKind },
): unknown {
  if (field?.type === "reference") {
    return normalizeReferenceFieldValue(field, value, options?.sourceKind);
  }

  const fieldActsLikeAsset =
    field &&
    typeof value === "string" &&
    (field.type === "asset" ||
      (field.type === "string" &&
        (field.accepts ?? []).some((accept) => accept.startsWith("image/"))));

  if (!fieldActsLikeAsset) {
    return value;
  }

  const trimmed = normalizePosixPath(value.trim());
  if (!trimmed) {
    return "";
  }

  const strippedLeadingSlash = trimmed.replace(/^\/+/, "");
  if (
    strippedLeadingSlash === "src/content/media" ||
    strippedLeadingSlash.startsWith("src/content/media/")
  ) {
    return buildRelativeReferencePath(entryRelativePath, strippedLeadingSlash);
  }

  if (
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("/") ||
    NON_LOCAL_ASSET_REFERENCE_REGEX.test(trimmed)
  ) {
    return trimmed;
  }

  return buildRelativeReferencePath(entryRelativePath, trimmed);
}

export function normalizeReferenceFieldValue(
  field: CmsFieldDefinition | null,
  value: unknown,
  sourceKind?: CmsSourceKind,
): unknown {
  if (field?.type !== "reference") {
    return value;
  }

  if (sourceKind !== "astro-collections") {
    return value;
  }

  if (typeof value === "undefined" || value === null) {
    return field.required ? "" : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return field.required ? "" : undefined;
    }

    const targetPrefix = field.referenceModelKey?.trim();
    if (targetPrefix) {
      const prefixedValue = `${targetPrefix}:`;
      if (trimmed.startsWith(prefixedValue)) {
        const entryKey = trimmed.slice(prefixedValue.length).trim();
        return entryKey || (field.required ? "" : undefined);
      }
    }

    return trimmed;
  }

  if (isRecord(value)) {
    const modelKey = typeof value.model === "string" ? value.model.trim() : "";
    const entryKey = typeof value.entry === "string" ? value.entry.trim() : "";
    if (!entryKey) {
      return field.required ? "" : undefined;
    }

    if (!modelKey || modelKey === field.referenceModelKey?.trim()) {
      return entryKey;
    }

    return `${modelKey}:${entryKey}`;
  }

  return value;
}
