import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { CmsAssetRecord, CmsEntryRecord, CmsFieldDefinition, CmsModelRecord } from "../index.js";
import {
  SUPPORTED_ENTRY_EXTENSIONS,
  TITLE_FIELD_KEYS,
  isRecord,
  pathExists,
  titleizeKey,
  toPosix,
} from "./shared.js";
import type {
  AstroEntryLike,
  AstroReferenceCheck,
  ParsedCollectionDefinition,
} from "./shared.js";

function fieldAcceptsImages(field: CmsFieldDefinition): boolean {
  return (field.accepts ?? []).some((accept) => accept.startsWith("image/"));
}

async function collectEntryFiles(rootDir: string): Promise<string[]> {
  if (!(await pathExists(rootDir))) return [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectEntryFiles(absolutePath)));
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_ENTRY_EXTENSIONS.has(extension)) continue;
    results.push(absolutePath);
  }

  return results.sort((left, right) => left.localeCompare(right));
}

async function parseEntryValues(filePath: string): Promise<Record<string, unknown>> {
  const extension = path.extname(filePath).toLowerCase();
  const raw = await fs.readFile(filePath, "utf8");
  if (extension === ".json") {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  if (extension === ".yaml" || extension === ".yml") {
    const parsed = parseYaml(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }

  const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!frontmatterMatch) return {};
  const parsed = parseYaml(frontmatterMatch[1]) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseAstroReferenceTarget(
  field: CmsFieldDefinition,
  value: unknown,
): { modelKey: string; entryKey: string } | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const separator = trimmed.indexOf(":");
    if (separator > 0 && separator < trimmed.length - 1) {
      return {
        modelKey: trimmed.slice(0, separator),
        entryKey: trimmed.slice(separator + 1),
      };
    }

    const hintedModelKey = field.referenceModelKey?.trim();
    if (hintedModelKey) {
      return {
        modelKey: hintedModelKey,
        entryKey: trimmed,
      };
    }

    return null;
  }

  if (isRecord(value)) {
    const modelKey = typeof value.model === "string" ? value.model.trim() : "";
    const entryKey = typeof value.entry === "string" ? value.entry.trim() : "";
    if (modelKey && entryKey) {
      return { modelKey, entryKey };
    }
  }

  return null;
}

export function collectAstroReferenceChecks(options: {
  entry: AstroEntryLike;
  fields: Record<string, CmsFieldDefinition>;
  errors: string[];
  referenceChecks: AstroReferenceCheck[];
}): void {
  const { entry, fields, errors, referenceChecks } = options;

  function visitField(
    fieldKey: string,
    field: CmsFieldDefinition,
    value: unknown,
    pathPrefix = fieldKey,
  ): void {
    if (field.type === "reference") {
      if (typeof value === "undefined" || value === null) {
        if (field.required) {
          errors.push(`${entry.relativePath}: field ${pathPrefix} is required`);
        }
        return;
      }

      if (typeof value === "string" && !value.trim()) {
        if (field.required) {
          errors.push(`${entry.relativePath}: field ${pathPrefix} is required`);
        }
        return;
      }

      const target = parseAstroReferenceTarget(field, value);
      if (!target) {
        errors.push(
          `${entry.relativePath}: field ${pathPrefix} must be an entry id string or legacy "model:entry" reference`,
        );
        return;
      }

      const expectedModelKey = field.referenceModelKey?.trim();
      if (expectedModelKey && target.modelKey !== expectedModelKey) {
        errors.push(
          `${entry.relativePath}: field ${pathPrefix} must reference an entry in ${expectedModelKey}`,
        );
        return;
      }

      referenceChecks.push({
        sourcePath: entry.relativePath,
        fieldPath: pathPrefix,
        targetModelKey: target.modelKey,
        targetEntryKey: target.entryKey,
      });
      return;
    }

    if (field.type === "object" && field.fields) {
      if (!isRecord(value)) {
        return;
      }
      for (const [nestedKey, nestedField] of Object.entries(field.fields)) {
        visitField(
          nestedKey,
          nestedField,
          value[nestedKey],
          `${pathPrefix}.${nestedKey}`,
        );
      }
      return;
    }

    if (field.type === "list" && field.item && Array.isArray(value)) {
      value.forEach((item, index) => {
        visitField(pathPrefix, field.item as CmsFieldDefinition, item, `${pathPrefix}[${index}]`);
      });
    }
  }

  for (const [fieldKey, field] of Object.entries(fields)) {
    visitField(fieldKey, field, entry.values[fieldKey]);
  }
}

export function collectAssetRefs(
  projectDir: string,
  entry: Pick<CmsEntryRecord, "key" | "filePath" | "relativePath" | "values">,
  modelKey: string,
  fields: Record<string, CmsFieldDefinition>,
): CmsAssetRecord[] {
  const assetRefs: CmsAssetRecord[] = [];

  function visitField(fieldKey: string, field: CmsFieldDefinition, value: unknown, pathPrefix = fieldKey) {
    if (field.type === "asset" || (field.type === "string" && fieldAcceptsImages(field))) {
      const pathValue =
        typeof value === "string"
          ? value
          : value && typeof value === "object" && typeof (value as { path?: unknown }).path === "string"
            ? ((value as { path: string }).path)
            : null;
      if (!pathValue) return;
      const absolutePath = path.resolve(path.dirname(entry.filePath), pathValue);
      const relativePath = toPosix(path.relative(projectDir, absolutePath));
      assetRefs.push({
        id: `${modelKey}:${entry.key}:${pathPrefix}:${relativePath}`,
        modelKey,
        entryKey: entry.key,
        fieldKey: pathPrefix,
        filePath: absolutePath,
        relativePath: pathValue,
        artifactPath: relativePath,
      });
      return;
    }

    if (
      (field.type === "assetList" ||
        (field.type === "list" &&
          field.item?.type === "string" &&
          (fieldAcceptsImages(field) || fieldAcceptsImages(field.item)))) &&
      Array.isArray(value)
    ) {
      value.forEach((item, index) => {
        visitField(
          pathPrefix,
          { type: "asset", accepts: ["image/*"] },
          item,
          `${pathPrefix}[${index}]`,
        );
      });
      return;
    }

    if (field.type === "object" && field.fields && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [nestedKey, nestedField] of Object.entries(field.fields)) {
        visitField(nestedKey, nestedField, (value as Record<string, unknown>)[nestedKey], `${pathPrefix}.${nestedKey}`);
      }
      return;
    }

    if (field.type === "list" && field.item && Array.isArray(value)) {
      value.forEach((item, index) => {
        visitField(pathPrefix, field.item as CmsFieldDefinition, item, `${pathPrefix}[${index}]`);
      });
    }
  }

  for (const [fieldKey, field] of Object.entries(fields)) {
    visitField(fieldKey, field, entry.values[fieldKey]);
  }

  return assetRefs;
}

export async function buildEntriesForCollection(
  projectDir: string,
  model: ParsedCollectionDefinition,
): Promise<CmsEntryRecord[]> {
  if (!model.supportedEntries) return [];
  const files = await collectEntryFiles(model.collectionRoot);
  const entries: CmsEntryRecord[] = [];

  for (const filePath of files) {
    const relativePath = toPosix(path.relative(projectDir, filePath));
    const values = await parseEntryValues(filePath);
    const relativeToCollection = toPosix(path.relative(model.collectionRoot, filePath));
    const normalizedRelativeToCollection = relativeToCollection.replace(/\.[^.]+$/, "");
    const basename = path.posix.basename(normalizedRelativeToCollection);
    const isDirectoryIndexEntry = basename === "index";
    const key = isDirectoryIndexEntry
      ? path.posix.dirname(normalizedRelativeToCollection)
      : normalizedRelativeToCollection;
    const sortValue =
      model.sortField && typeof values[model.sortField] === "number"
        ? (values[model.sortField] as number)
        : typeof values.sortOrder === "number"
          ? (values.sortOrder as number)
          : typeof values.order === "number"
            ? (values.order as number)
            : null;
    const entry: CmsEntryRecord = {
      key,
      filePath,
      relativePath,
      deletePath: isDirectoryIndexEntry
        ? toPosix(path.relative(projectDir, path.dirname(filePath)))
        : relativePath,
      values,
      slug: typeof values.slug === "string" ? values.slug : key,
      status: typeof values.status === "string" ? values.status : null,
      sortOrder: sortValue,
      assetRefs: [],
    };
    entry.assetRefs = collectAssetRefs(projectDir, entry, model.key, model.fields);
    entries.push(entry);
  }

  return entries.sort((left, right) => {
    if (typeof left.sortOrder === "number" && typeof right.sortOrder === "number") {
      return left.sortOrder - right.sortOrder || left.key.localeCompare(right.key);
    }
    return left.key.localeCompare(right.key);
  });
}

export function normalizeEntryKey(entryKey: string): string {
  const normalized = entryKey
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();

  if (!normalized) {
    throw new Error("Entry key is required");
  }

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error(`Invalid entry key: ${entryKey}`);
    }
    if (!/^[a-z0-9][a-z0-9-_]*$/.test(segment)) {
      throw new Error(`Invalid entry key: ${entryKey}`);
    }
  }

  return segments.join("/");
}

export function buildDefaultAstroFieldValue(
  fieldKey: string,
  field: CmsFieldDefinition,
  entryKey: string,
  defaultLocale: string,
): unknown {
  const entrySeed = titleizeKey(entryKey.split("/").pop() || entryKey);
  const preferredText = TITLE_FIELD_KEYS.has(fieldKey) ? entrySeed : "";

  if (field.localized) {
    return { [defaultLocale]: preferredText };
  }

  switch (field.type) {
    case "slug":
      return entryKey.split("/").pop() || entryKey;
    case "string":
    case "text":
    case "richText":
    case "date":
    case "datetime":
      return preferredText;
    case "number":
      return typeof field.default === "number" ? field.default : 0;
    case "boolean":
      return typeof field.default === "boolean" ? field.default : false;
    case "enum":
      return field.default ?? field.options?.[0] ?? "";
    case "object": {
      const nested: Record<string, unknown> = {};
      for (const [nestedKey, nestedField] of Object.entries(field.fields ?? {})) {
        nested[nestedKey] = buildDefaultAstroFieldValue(
          nestedKey,
          nestedField,
          entryKey,
          defaultLocale,
        );
      }
      return nested;
    }
    case "list":
    case "assetList":
      return [];
    case "asset":
      return "";
    case "reference":
      return field.required ? "" : undefined;
    default:
      return field.default ?? null;
  }
}

export function serializeAstroEntryValues(
  filePath: string,
  value: Record<string, unknown>,
): string {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".yaml") || normalized.endsWith(".yml")) {
    return `${stringifyYaml(value)}\n`;
  }
  if (normalized.endsWith(".json")) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
  if (
    normalized.endsWith(".md") ||
    normalized.endsWith(".mdx") ||
    normalized.endsWith(".markdown")
  ) {
    return `---\n${stringifyYaml(value).trimEnd()}\n---\n`;
  }
  throw new Error(`Unsupported entry format for ${filePath}`);
}

export function inferEntryLayoutFromModel(model: CmsModelRecord): {
  extension: string;
  directoryIndexEntries: boolean;
} {
  if (model.entries.length === 0) {
    return {
      extension: model.entryFileExtension || ".yaml",
      directoryIndexEntries: Boolean(model.directoryIndexEntries),
    };
  }

  const counts = new Map<string, number>();
  for (const entry of model.entries) {
    const ext = path.extname(entry.relativePath).toLowerCase() || ".yaml";
    const basename = path.posix.basename(entry.relativePath).toLowerCase();
    const mode = basename.startsWith("index.") ? "dir" : "flat";
    const key = `${mode}:${ext}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const [winner] =
    [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ?? ["flat:.yaml", 0];
  const [mode, extension] = winner.split(":");

  return {
    extension: extension || ".yaml",
    directoryIndexEntries: mode === "dir",
  };
}
