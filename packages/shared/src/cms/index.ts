import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import {
  createAstroCollectionModel,
  createAstroCollectionEntry,
  inspectAstroCollectionsWorkspace,
  updateAstroCollectionModel,
} from "./astroCollections.js";

export const CMS_VERSION = 1;
export const CMS_CONTENT_ROOT = path.join("src", "content");

const SUPPORTED_FIELD_TYPES = new Set([
  "string",
  "text",
  "richText",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "object",
  "list",
  "reference",
  "asset",
  "assetList",
  "slug",
]);

const LOCALIZED_FIELD_TYPES = new Set(["string", "text", "richText"]);
const TITLE_FIELD_KEYS = new Set(["title", "name", "label"]);
const NON_LOCAL_ASSET_REFERENCE_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export interface CmsPaths {
  projectDir: string;
  contentRoot: string;
  rootConfigPath: string;
  modelsRoot: string;
  collectionsRoot: string;
  mediaRoot: string;
}

export type CmsSourceKind = "legacy-yaml" | "astro-collections";

export interface CmsModelRef {
  key: string;
  kind: "collection";
  schema: string;
}

export interface CmsRootConfig {
  version: number;
  defaultLocale: string;
  locales: string[];
  models: CmsModelRef[];
}

export interface CmsFieldDefinition {
  type: string;
  label?: string;
  description?: string;
  required?: boolean;
  localized?: boolean;
  default?: unknown;
  options?: string[];
  accepts?: string[];
  storage?: string;
  referenceModelKey?: string;
  fields?: Record<string, CmsFieldDefinition>;
  item?: CmsFieldDefinition;
}

export interface CmsModelSchema {
  label: string;
  storage: {
    path: string;
    entryFormat: "directory" | "file";
  };
  display?: {
    primaryField?: string;
  };
  route?: {
    detail?: string;
  };
  entry: {
    statusField?: string;
    sortField?: string;
    fields: Record<string, CmsFieldDefinition>;
  };
}

export interface CmsAssetRecord {
  id: string;
  modelKey: string;
  entryKey: string;
  fieldKey: string;
  filePath: string;
  relativePath: string;
  artifactPath: string;
}

export interface CmsEntryRecord {
  key: string;
  filePath: string;
  relativePath: string;
  deletePath: string;
  values: Record<string, unknown>;
  slug: string | null;
  status: string | null;
  sortOrder: number | null;
  assetRefs: CmsAssetRecord[];
}

export interface CmsModelRecord {
  key: string;
  label: string;
  schemaPath: string;
  relativeSchemaPath: string;
  collectionRoot: string;
  relativeCollectionRoot: string;
  entryFormat: "directory" | "file";
  entryFileExtension?: string | null;
  directoryIndexEntries?: boolean;
  sortField: string | null;
  fields: Record<string, CmsFieldDefinition>;
  display?: {
    primaryField?: string;
  };
  entries: CmsEntryRecord[];
}

export interface CmsValidationReport {
  sourceKind: CmsSourceKind;
  initialized: boolean;
  valid: boolean;
  paths: CmsPaths;
  defaultLocale: string | null;
  locales: string[];
  modelCount: number;
  entryCount: number;
  assetCount: number;
  mediaFileCount: number;
  errors: string[];
  models: CmsModelRecord[];
}

export interface CmsScaffoldResult {
  created: string[];
  skipped: string[];
  paths: CmsPaths;
}

export interface CmsCreateEntryResult extends CmsScaffoldResult {
  createdEntryKey: string;
  createdEntryRelativePath: string;
}

export interface CmsUpdateModelResult {
  updated: string[];
  paths: CmsPaths;
}

export interface CmsEntryFieldUpdate {
  modelKey: string;
  entryKey: string;
  fieldPath: Array<string | number>;
  value: unknown;
}

export interface CmsUpdateEntriesResult {
  updated: string[];
  paths: CmsPaths;
}

type ReferenceCheck = {
  sourcePath: string;
  modelKey: string;
  entryKey: string;
  fieldKey: string;
  targetModelKey: string;
  targetEntryKey: string;
};

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function titleizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
  return path.posix.relative(baseDir, normalizePosixPath(targetPath).replace(/^\/+/, "")) || ".";
}

function getCmsEntryFileFormat(filePath: string): "yaml" | "json" | "markdown" | "unsupported" {
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

function serializeCmsEntryValues(
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
      const existingMatch = currentContent.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/);
      const body = existingMatch ? currentContent.slice(existingMatch[0].length) : currentContent;
      if (!body.length) {
        return `---\n${frontmatter}\n---\n`;
      }
      return `---\n${frontmatter}\n---\n\n${body.replace(/^\r?\n/, "")}`;
    }
    default:
      throw new Error(`Unsupported CMS entry format for ${filePath}`);
  }
}

function setValueAtPath<T>(
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

function resolveFieldDefinitionAtPath(
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

function normalizeUpdatedFieldValue(
  entryRelativePath: string,
  field: CmsFieldDefinition | null,
  value: unknown,
): unknown {
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readYamlObject(
  filePath: string,
  errors: string[],
  label: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseYaml(raw) as unknown;
    if (!isRecord(parsed)) {
      errors.push(`${label}: expected a YAML object`);
      return null;
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${label}: ${message}`);
    return null;
  }
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function ensurePlaceholderFile(filePath: string): Promise<boolean> {
  if (await pathExists(filePath)) return false;
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, "", "utf8");
  return true;
}

function defaultRootConfig(): CmsRootConfig {
  return {
    version: CMS_VERSION,
    defaultLocale: "en",
    locales: ["en"],
    models: [],
  };
}

function getDefaultAstroCmsPaths(projectDir: string): CmsPaths {
  return {
    projectDir,
    contentRoot: path.join(projectDir, "src", "content"),
    rootConfigPath: path.join(projectDir, "src", "content.config.ts"),
    modelsRoot: path.join(projectDir, "src"),
    collectionsRoot: path.join(projectDir, "src", "content"),
    mediaRoot: path.join(projectDir, "src", "content", "media"),
  };
}

export function getCmsPaths(projectDir: string): CmsPaths {
  return {
    projectDir,
    contentRoot: path.join(projectDir, CMS_CONTENT_ROOT),
    rootConfigPath: path.join(projectDir, CMS_CONTENT_ROOT, "vivd.content.yaml"),
    modelsRoot: path.join(projectDir, CMS_CONTENT_ROOT, "models"),
    collectionsRoot: path.join(projectDir, CMS_CONTENT_ROOT, "collections"),
    mediaRoot: path.join(projectDir, CMS_CONTENT_ROOT, "media"),
  };
}

async function readRootConfig(paths: CmsPaths, errors: string[]): Promise<CmsRootConfig | null> {
  if (!(await pathExists(paths.rootConfigPath))) {
    return null;
  }

  const parsed = await readYamlObject(
    paths.rootConfigPath,
    errors,
    toPosix(path.relative(paths.projectDir, paths.rootConfigPath)),
  );
  if (!parsed) return null;

  const version = Number(parsed.version);
  const defaultLocale = typeof parsed.defaultLocale === "string" ? parsed.defaultLocale.trim() : "";
  const locales = Array.isArray(parsed.locales)
    ? parsed.locales.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const models = Array.isArray(parsed.models)
    ? parsed.models
        .map((model) => {
          if (typeof model === "string") {
            const key = model.trim();
            return {
              key,
              kind: "collection" as const,
              schema: key ? `./models/${key}.yaml` : "",
            };
          }
          if (!isRecord(model)) return null;
          const key = typeof model.key === "string" ? model.key.trim() : "";
          return {
            key,
            kind: model.kind === "collection" ? "collection" : (model.kind as "collection"),
            schema:
              typeof model.schema === "string" && model.schema.trim().length > 0
                ? model.schema.trim()
                : key
                  ? `./models/${key}.yaml`
                  : "",
          };
        })
        .filter((model): model is CmsModelRef => Boolean(model))
    : [];

  if (version !== CMS_VERSION) {
    errors.push(
      `${toPosix(path.relative(paths.projectDir, paths.rootConfigPath))}: version must be ${CMS_VERSION}`,
    );
  }
  if (!defaultLocale) {
    errors.push(
      `${toPosix(path.relative(paths.projectDir, paths.rootConfigPath))}: defaultLocale is required`,
    );
  }
  if (locales.length === 0) {
    errors.push(
      `${toPosix(path.relative(paths.projectDir, paths.rootConfigPath))}: locales must contain at least one locale`,
    );
  }
  if (defaultLocale && !locales.includes(defaultLocale)) {
    errors.push(
      `${toPosix(path.relative(paths.projectDir, paths.rootConfigPath))}: locales must include defaultLocale (${defaultLocale})`,
    );
  }

  const seenKeys = new Set<string>();
  for (const model of models) {
    if (!model.key) {
      errors.push(
        `${toPosix(path.relative(paths.projectDir, paths.rootConfigPath))}: model key is required`,
      );
      continue;
    }
    if (seenKeys.has(model.key)) {
      errors.push(
        `${toPosix(path.relative(paths.projectDir, paths.rootConfigPath))}: duplicate model key ${model.key}`,
      );
    }
    seenKeys.add(model.key);
    if (model.kind !== "collection") {
      errors.push(
        `${toPosix(path.relative(paths.projectDir, paths.rootConfigPath))}: model ${model.key} kind must be collection in v1`,
      );
    }
  }

  return {
    version,
    defaultLocale,
    locales,
    models: models.filter((model) => model.key && model.schema),
  };
}

function validateFieldDefinition(
  fieldKey: string,
  field: CmsFieldDefinition,
  errors: string[],
  schemaLabel: string,
): void {
  if (!SUPPORTED_FIELD_TYPES.has(field.type)) {
    errors.push(`${schemaLabel}: field ${fieldKey} uses unsupported type ${field.type}`);
    return;
  }
  if (field.localized && !LOCALIZED_FIELD_TYPES.has(field.type)) {
    errors.push(
      `${schemaLabel}: field ${fieldKey} uses localized: true on unsupported type ${field.type}`,
    );
  }
  if (field.type === "enum" && (!Array.isArray(field.options) || field.options.length === 0)) {
    errors.push(`${schemaLabel}: field ${fieldKey} enum options are required`);
  }
  if (field.type === "object") {
    if (!field.fields || !isRecord(field.fields) || Object.keys(field.fields).length === 0) {
      errors.push(`${schemaLabel}: field ${fieldKey} object fields are required`);
      return;
    }
    for (const [nestedKey, nestedField] of Object.entries(field.fields)) {
      validateFieldDefinition(nestedKey, nestedField, errors, schemaLabel);
    }
  }
  if (field.type === "list") {
    if (!field.item) {
      errors.push(`${schemaLabel}: field ${fieldKey} list item definition is required`);
      return;
    }
    validateFieldDefinition(`${fieldKey}[]`, field.item, errors, schemaLabel);
  }
}

function inferPrimaryField(fields: Record<string, CmsFieldDefinition>): string | undefined {
  for (const candidate of TITLE_FIELD_KEYS) {
    if (candidate in fields) {
      return candidate;
    }
  }
  return Object.keys(fields)[0];
}

function inferSortField(fields: Record<string, CmsFieldDefinition>): string | undefined {
  if (fields.sortOrder?.type === "number") return "sortOrder";
  if (fields.order?.type === "number") return "order";
  return undefined;
}

function normalizeFieldDefinition(
  fieldKey: string,
  rawField: unknown,
  errors: string[],
  schemaLabel: string,
): CmsFieldDefinition | null {
  if (!isRecord(rawField) || typeof rawField.type !== "string") {
    errors.push(`${schemaLabel}: field ${fieldKey} must be an object with a type`);
    return null;
  }

  const normalizedType =
    rawField.type === "string" &&
    Array.isArray(rawField.options) &&
    rawField.options.some((option) => typeof option === "string" && option.trim().length > 0)
      ? "enum"
      : rawField.type;

  const field: CmsFieldDefinition = {
    type: normalizedType,
    label: typeof rawField.label === "string" ? rawField.label.trim() : undefined,
    description:
      typeof rawField.description === "string" ? rawField.description.trim() : undefined,
    required: typeof rawField.required === "boolean" ? rawField.required : undefined,
    localized: typeof rawField.localized === "boolean" ? rawField.localized : undefined,
    default: rawField.default,
    options: Array.isArray(rawField.options)
      ? rawField.options.filter(
          (option): option is string => typeof option === "string" && option.trim().length > 0,
        )
      : undefined,
    accepts: Array.isArray(rawField.accepts)
      ? rawField.accepts.filter(
          (option): option is string => typeof option === "string" && option.trim().length > 0,
        )
      : undefined,
    storage: typeof rawField.storage === "string" ? rawField.storage.trim() : undefined,
  };

  if (field.type === "object") {
    const rawNestedFields = rawField.fields;
    const nestedFields: Record<string, CmsFieldDefinition> = {};
    if (isRecord(rawNestedFields)) {
      for (const [nestedKey, nestedRawField] of Object.entries(rawNestedFields)) {
        const normalized = normalizeFieldDefinition(nestedKey, nestedRawField, errors, schemaLabel);
        if (normalized) {
          nestedFields[nestedKey] = normalized;
        }
      }
    } else if (Array.isArray(rawNestedFields)) {
      for (const nestedRawField of rawNestedFields) {
        if (!isRecord(nestedRawField) || typeof nestedRawField.name !== "string") {
          errors.push(`${schemaLabel}: object field ${fieldKey} must define nested field names`);
          continue;
        }
        const nestedKey = nestedRawField.name.trim();
        if (!nestedKey) {
          errors.push(`${schemaLabel}: object field ${fieldKey} must define nested field names`);
          continue;
        }
        const normalized = normalizeFieldDefinition(nestedKey, nestedRawField, errors, schemaLabel);
        if (normalized) {
          nestedFields[nestedKey] = normalized;
        }
      }
    }
    field.fields = nestedFields;
  }

  if (field.type === "list" && typeof rawField.item !== "undefined") {
    const normalizedItem = normalizeFieldDefinition(
      `${fieldKey}[]`,
      rawField.item,
      errors,
      schemaLabel,
    );
    if (normalizedItem) {
      field.item = normalizedItem;
    }
  }

  validateFieldDefinition(fieldKey, field, errors, schemaLabel);
  return field;
}

function parseModelSchema(
  parsed: Record<string, unknown>,
  modelKey: string,
  schemaLabel: string,
  errors: string[],
): CmsModelSchema | null {
  const label =
    typeof parsed.label === "string" && parsed.label.trim().length > 0
      ? parsed.label.trim()
      : titleizeKey(modelKey);
  const storage = isRecord(parsed.storage) ? parsed.storage : null;
  const entry = isRecord(parsed.entry) ? parsed.entry : null;
  const fields: Record<string, CmsFieldDefinition> = {};
  const fieldsValue = entry && isRecord(entry.fields) ? entry.fields : null;
  const legacyFieldsValue = Array.isArray(parsed.fields) ? parsed.fields : null;
  const storagePath =
    storage && typeof storage.path === "string" && storage.path.trim().length > 0
      ? storage.path.trim()
      : `./${modelKey}`;
  const entryFormat =
    storage?.entryFormat === "directory" || storage?.entryFormat === "file"
      ? storage.entryFormat
      : storagePath === `./collections/${modelKey}`
        ? "directory"
        : "file";

  if (!fieldsValue && !legacyFieldsValue) {
    errors.push(`${schemaLabel}: entry.fields is required`);
    return null;
  }
  if (storagePath !== `./${modelKey}` && storagePath !== `./collections/${modelKey}`) {
    errors.push(
      `${schemaLabel}: storage.path should be ./${modelKey} or ./collections/${modelKey} for collection model ${modelKey}`,
    );
    return null;
  }

  if (fieldsValue) {
    for (const [fieldKey, rawField] of Object.entries(fieldsValue)) {
      const normalized = normalizeFieldDefinition(fieldKey, rawField, errors, schemaLabel);
      if (normalized) {
        fields[fieldKey] = normalized;
      }
    }
  } else if (legacyFieldsValue) {
    for (const rawField of legacyFieldsValue) {
      if (!isRecord(rawField) || typeof rawField.name !== "string") {
        errors.push(`${schemaLabel}: legacy field list entries must define a name`);
        continue;
      }
      const fieldKey = rawField.name.trim();
      if (!fieldKey) {
        errors.push(`${schemaLabel}: legacy field list entries must define a name`);
        continue;
      }
      const normalized = normalizeFieldDefinition(fieldKey, rawField, errors, schemaLabel);
      if (normalized) {
        fields[fieldKey] = normalized;
      }
    }
  }
  if (Object.keys(fields).length === 0) return null;

  const display = isRecord(parsed.display) ? parsed.display : null;
  const route = isRecord(parsed.route) ? parsed.route : null;
  const primaryField =
    display && typeof display.primaryField === "string" && display.primaryField.trim().length > 0
      ? display.primaryField
      : inferPrimaryField(fields);
  const statusField =
    entry && typeof entry.statusField === "string" && entry.statusField.trim().length > 0
      ? entry.statusField
      : fields.status
        ? "status"
        : undefined;
  const sortField =
    entry && typeof entry.sortField === "string" && entry.sortField.trim().length > 0
      ? entry.sortField
      : inferSortField(fields);

  return {
    label,
    storage: {
      path: storagePath,
      entryFormat,
    },
    display: primaryField ? { primaryField } : undefined,
    route: route
      ? { detail: typeof route.detail === "string" ? route.detail : undefined }
      : undefined,
    entry: {
      statusField,
      sortField,
      fields,
    },
  };
}

function makeAssetId(modelKey: string, entryKey: string, fieldKey: string, relativePath: string): string {
  return `${modelKey}:${entryKey}:${fieldKey}:${relativePath}`;
}

function resolveRelativeToEntry(
  rawPath: string,
  entryDir: string,
  contentRoot: string,
): { absolutePath: string; relativePath: string } | null {
  const resolved = path.isAbsolute(rawPath) ? rawPath : path.resolve(entryDir, rawPath);
  const normalizedContentRoot = path.resolve(contentRoot);
  const normalizedResolved = path.resolve(resolved);
  if (
    normalizedResolved !== normalizedContentRoot &&
    !normalizedResolved.startsWith(`${normalizedContentRoot}${path.sep}`)
  ) {
    return null;
  }

  return {
    absolutePath: normalizedResolved,
    relativePath: toPosix(path.relative(normalizedContentRoot, normalizedResolved)),
  };
}

function parseReferenceTarget(
  value: unknown,
): { modelKey: string; entryKey: string } | null {
  if (typeof value === "string") {
    const separator = value.indexOf(":");
    if (separator > 0 && separator < value.length - 1) {
      return {
        modelKey: value.slice(0, separator),
        entryKey: value.slice(separator + 1),
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

function buildFieldLocation(entryLabel: string, fieldKey: string): string {
  return `${entryLabel}: field ${fieldKey}`;
}

async function validateFieldValue(options: {
  fieldKey: string;
  field: CmsFieldDefinition;
  value: unknown;
  defaultLocale: string;
  entryDir: string;
  contentRoot: string;
  mediaRoot: string;
  entryLabel: string;
  errors: string[];
  modelKey: string;
  entryKey: string;
  assetRefs: CmsAssetRecord[];
  referenceChecks: ReferenceCheck[];
}): Promise<void> {
  const {
    fieldKey,
    field,
    value,
    defaultLocale,
    entryDir,
    contentRoot,
    mediaRoot,
    entryLabel,
    errors,
    modelKey,
    entryKey,
    assetRefs,
    referenceChecks,
  } = options;

  if (field.localized) {
    if (!isRecord(value)) {
      errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must be a locale object`);
      return;
    }
    if (field.required && typeof value[defaultLocale] === "undefined") {
      errors.push(
        `${buildFieldLocation(entryLabel, fieldKey)} must include the default locale ${defaultLocale}`,
      );
    }
    for (const [localeKey, localeValue] of Object.entries(value)) {
      if (field.type === "richText" && field.storage === "sidecar-markdown") {
        if (typeof localeValue !== "string" || !localeValue.trim()) {
          errors.push(
            `${buildFieldLocation(entryLabel, `${fieldKey}.${localeKey}`)} must reference a markdown file`,
          );
          continue;
        }
        const resolved = resolveRelativeToEntry(localeValue, entryDir, contentRoot);
        if (!resolved) {
          errors.push(
            `${buildFieldLocation(entryLabel, `${fieldKey}.${localeKey}`)} must stay inside src/content`,
          );
          continue;
        }
        if (!(await pathExists(resolved.absolutePath))) {
          errors.push(
            `${buildFieldLocation(entryLabel, `${fieldKey}.${localeKey}`)} points to a missing file (${resolved.relativePath})`,
          );
        }
        continue;
      }

      if (typeof localeValue !== "string") {
        errors.push(`${buildFieldLocation(entryLabel, `${fieldKey}.${localeKey}`)} must be a string`);
      }
    }
    return;
  }

  switch (field.type) {
    case "string":
    case "text":
    case "slug":
    case "date":
    case "datetime":
      if (typeof value !== "string") {
        errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must be a string`);
      }
      return;
    case "number":
      if (typeof value !== "number") {
        errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must be a number`);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must be a boolean`);
      }
      return;
    case "enum":
      if (typeof value !== "string") {
        errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must be a string enum value`);
      } else if (field.options && !field.options.includes(value)) {
        errors.push(
          `${buildFieldLocation(entryLabel, fieldKey)} must be one of ${field.options.join(", ")}`,
        );
      }
      return;
    case "object":
      if (!isRecord(value)) {
        errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must be an object`);
        return;
      }
      for (const [nestedKey, nestedField] of Object.entries(field.fields ?? {})) {
        const nestedValue = value[nestedKey];
        if (typeof nestedValue === "undefined") {
          if (nestedField.required) {
            errors.push(
              `${buildFieldLocation(entryLabel, `${fieldKey}.${nestedKey}`)} is required`,
            );
          }
          continue;
        }
        await validateFieldValue({
          ...options,
          fieldKey: `${fieldKey}.${nestedKey}`,
          field: nestedField,
          value: nestedValue,
        });
      }
      return;
    case "list":
      if (!Array.isArray(value)) {
        errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must be a list`);
        return;
      }
      for (const [index, item] of value.entries()) {
        await validateFieldValue({
          ...options,
          fieldKey: `${fieldKey}[${index}]`,
          field: field.item ?? { type: "string" },
          value: item,
        });
      }
      return;
    case "reference": {
      const target = parseReferenceTarget(value);
      if (!target) {
        errors.push(
          `${buildFieldLocation(entryLabel, fieldKey)} must be a "model:entry" string or { model, entry } object`,
        );
        return;
      }
      referenceChecks.push({
        sourcePath: entryLabel,
        modelKey,
        entryKey,
        fieldKey,
        targetModelKey: target.modelKey,
        targetEntryKey: target.entryKey,
      });
      return;
    }
    case "asset": {
      const rawPath =
        typeof value === "string"
          ? value
          : isRecord(value) && typeof value.path === "string"
            ? value.path
            : null;
      if (!rawPath) {
        errors.push(
          `${buildFieldLocation(entryLabel, fieldKey)} must be a path string or object with a path`,
        );
        return;
      }
      const resolved = resolveRelativeToEntry(rawPath, entryDir, contentRoot);
      if (!resolved) {
        errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must stay inside src/content`);
        return;
      }
      const normalizedMediaRoot = path.resolve(mediaRoot);
      if (
        resolved.absolutePath !== normalizedMediaRoot &&
        !resolved.absolutePath.startsWith(`${normalizedMediaRoot}${path.sep}`)
      ) {
        errors.push(
          `${buildFieldLocation(entryLabel, fieldKey)} must point to a file under src/content/media`,
        );
        return;
      }
      if (!(await pathExists(resolved.absolutePath))) {
        errors.push(
          `${buildFieldLocation(entryLabel, fieldKey)} points to a missing file (${resolved.relativePath})`,
          );
        return;
      }
      assetRefs.push({
        id: makeAssetId(modelKey, entryKey, fieldKey, resolved.relativePath),
        modelKey,
        entryKey,
        fieldKey,
        filePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        artifactPath: toPosix(path.join("media", path.relative(path.join(contentRoot, "media"), resolved.absolutePath))),
      });
      return;
    }
    case "assetList":
      if (!Array.isArray(value)) {
        errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must be a list of assets`);
        return;
      }
      for (const [index, item] of value.entries()) {
        await validateFieldValue({
          ...options,
          fieldKey: `${fieldKey}[${index}]`,
          field: { type: "asset" },
          value: item,
        });
      }
      return;
    case "richText":
      if (field.storage === "sidecar-markdown") {
        if (typeof value !== "string") {
          errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must reference a markdown file`);
          return;
        }
        const resolved = resolveRelativeToEntry(value, entryDir, contentRoot);
        if (!resolved) {
          errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must stay inside src/content`);
          return;
        }
        if (!(await pathExists(resolved.absolutePath))) {
          errors.push(
            `${buildFieldLocation(entryLabel, fieldKey)} points to a missing file (${resolved.relativePath})`,
          );
        }
        return;
      }
      if (typeof value !== "string") {
        errors.push(`${buildFieldLocation(entryLabel, fieldKey)} must be a string`);
      }
      return;
    default:
      return;
  }
}

async function loadEntryRecord(options: {
  entryKey: string;
  entryDir: string;
  entryFilePath: string;
  entryRelativePath: string;
  deletePath: string;
  paths: CmsPaths;
  rootConfig: CmsRootConfig;
  schema: CmsModelSchema;
  modelKey: string;
  errors: string[];
  referenceChecks: ReferenceCheck[];
  seenSlugs: Map<string, string>;
}): Promise<CmsEntryRecord | null> {
  const {
    entryKey,
    entryDir,
    entryFilePath,
    entryRelativePath,
    deletePath,
    paths,
    rootConfig,
    schema,
    modelKey,
    errors,
    referenceChecks,
    seenSlugs,
  } = options;

  const values = await readYamlObject(entryFilePath, errors, entryRelativePath);
  if (!values) return null;

  const assetRefs: CmsAssetRecord[] = [];
  for (const [fieldKey, field] of Object.entries(schema.entry.fields)) {
    const value = values[fieldKey];
    if (typeof value === "undefined") {
      if (field.required) {
        errors.push(`${entryRelativePath}: field ${fieldKey} is required`);
      }
      continue;
    }
    await validateFieldValue({
      fieldKey,
      field,
      value,
      defaultLocale: rootConfig.defaultLocale,
      entryDir,
      contentRoot: paths.contentRoot,
      mediaRoot: paths.mediaRoot,
      entryLabel: entryRelativePath,
      errors,
      modelKey,
      entryKey,
      assetRefs,
      referenceChecks,
    });
  }

  const statusField = schema.entry.statusField;
  const statusValue =
    statusField && typeof values[statusField] === "string" ? values[statusField] : null;
  const slugValue = typeof values.slug === "string" ? values.slug : null;
  const sortField = schema.entry.sortField;
  const sortOrderValue =
    sortField && typeof values[sortField] === "number"
      ? values[sortField]
      : typeof values.sortOrder === "number"
        ? values.sortOrder
        : typeof values.order === "number"
          ? values.order
          : null;

  if (slugValue) {
    const existingEntry = seenSlugs.get(slugValue);
    if (existingEntry) {
      errors.push(`${entryRelativePath}: duplicate slug ${slugValue} already used by ${existingEntry}`);
    } else {
      seenSlugs.set(slugValue, entryRelativePath);
    }
  }

  return {
    key: entryKey,
    filePath: entryFilePath,
    relativePath: entryRelativePath,
    deletePath,
    values,
    slug: slugValue,
    status: statusValue,
    sortOrder: sortOrderValue,
    assetRefs,
  };
}

async function loadModelRecord(options: {
  paths: CmsPaths;
  rootConfig: CmsRootConfig;
  modelRef: CmsModelRef;
  errors: string[];
  referenceChecks: ReferenceCheck[];
}): Promise<CmsModelRecord | null> {
  const { paths, rootConfig, modelRef, errors, referenceChecks } = options;
  const schemaPath = path.resolve(paths.contentRoot, modelRef.schema);
  const relativeSchemaPath = toPosix(path.relative(paths.projectDir, schemaPath));
  if (!(await pathExists(schemaPath))) {
    errors.push(`${relativeSchemaPath}: schema file is missing`);
    return null;
  }

  const schemaParsed = await readYamlObject(schemaPath, errors, relativeSchemaPath);
  if (!schemaParsed) return null;
  const schema = parseModelSchema(schemaParsed, modelRef.key, relativeSchemaPath, errors);
  if (!schema) return null;

  const collectionRoot = path.resolve(paths.contentRoot, schema.storage.path);
  const relativeCollectionRoot = toPosix(path.relative(paths.projectDir, collectionRoot));
  const entries: CmsEntryRecord[] = [];
  const seenSlugs = new Map<string, string>();
  if (!(await pathExists(collectionRoot))) {
    await ensureDirectory(collectionRoot);
  }

  const dirents = await fs.readdir(collectionRoot, { withFileTypes: true });
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue;

    if (schema.storage.entryFormat === "directory") {
      if (!dirent.isDirectory()) continue;
      const entryDir = path.join(collectionRoot, dirent.name);
      const indexPath = path.join(entryDir, "index.yaml");
      const relativeEntryDir = toPosix(path.relative(paths.projectDir, entryDir));
      const relativeIndexPath = toPosix(path.relative(paths.projectDir, indexPath));
      if (!(await pathExists(indexPath))) {
        errors.push(`${relativeCollectionRoot}/${dirent.name}: missing index.yaml`);
        continue;
      }

      const entry = await loadEntryRecord({
        entryKey: dirent.name,
        entryDir,
        entryFilePath: indexPath,
        entryRelativePath: relativeIndexPath,
        deletePath: relativeEntryDir,
        paths,
        rootConfig,
        schema,
        modelKey: modelRef.key,
        errors,
        referenceChecks,
        seenSlugs,
      });
      if (entry) {
        entries.push(entry);
      }
      continue;
    }

    if (!dirent.isFile() || !/\.(ya?ml)$/i.test(dirent.name)) continue;
    const entryKey = dirent.name.replace(/\.(ya?ml)$/i, "");
    const entryFilePath = path.join(collectionRoot, dirent.name);
    const relativeEntryPath = toPosix(path.relative(paths.projectDir, entryFilePath));
    const entry = await loadEntryRecord({
      entryKey,
      entryDir: collectionRoot,
      entryFilePath,
      entryRelativePath: relativeEntryPath,
      deletePath: relativeEntryPath,
      paths,
      rootConfig,
      schema,
      modelKey: modelRef.key,
      errors,
      referenceChecks,
      seenSlugs,
    });
    if (entry) {
      entries.push(entry);
    }
  }

  entries.sort((left, right) => {
    const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.key.localeCompare(right.key);
  });

  return {
    key: modelRef.key,
    label: schema.label,
    schemaPath,
    relativeSchemaPath,
    collectionRoot,
    relativeCollectionRoot,
    entryFormat: schema.storage.entryFormat,
    entryFileExtension: ".yaml",
    directoryIndexEntries: schema.storage.entryFormat === "directory",
    sortField: schema.entry.sortField ?? null,
    fields: schema.entry.fields,
    display: schema.display,
    entries,
  };
}

async function countFilesRecursively(root: string): Promise<number> {
  if (!(await pathExists(root))) return 0;
  const dirents = await fs.readdir(root, { withFileTypes: true });
  let count = 0;
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue;
    const nextPath = path.join(root, dirent.name);
    if (dirent.isDirectory()) {
      count += await countFilesRecursively(nextPath);
    } else if (dirent.isFile()) {
      count += 1;
    }
  }
  return count;
}

export async function getCmsStatus(projectDir: string): Promise<CmsValidationReport> {
  const astroReport = await inspectAstroCollectionsWorkspace(projectDir);
  if (astroReport) {
    return astroReport;
  }

  if (await isAstroProject(projectDir)) {
    const paths = getDefaultAstroCmsPaths(projectDir);
    return {
      sourceKind: "astro-collections",
      initialized: false,
      valid: false,
      paths,
      defaultLocale: null,
      locales: [],
      modelCount: 0,
      entryCount: 0,
      assetCount: 0,
      mediaFileCount: await countFilesRecursively(paths.mediaRoot),
      errors: [
        `Missing ${toPosix(path.relative(projectDir, paths.rootConfigPath))}. Astro-backed projects now use Astro Content Collections as the source of truth. Create \`src/content.config.ts\` and export \`collections\` before using Studio CMS.`,
      ],
      models: [],
    };
  }

  const paths = getCmsPaths(projectDir);
  const errors: string[] = [];
  const rootConfig = await readRootConfig(paths, errors);
  if (!rootConfig) {
    return {
      sourceKind: "legacy-yaml",
      initialized: false,
      valid: false,
      paths,
      defaultLocale: null,
      locales: [],
      modelCount: 0,
      entryCount: 0,
      assetCount: 0,
      mediaFileCount: await countFilesRecursively(paths.mediaRoot),
      errors: [
        `Missing ${toPosix(path.relative(projectDir, paths.rootConfigPath))}. Run \`vivd cms scaffold init\` to create the CMS structure.`,
      ],
      models: [],
    };
  }

  const referenceChecks: ReferenceCheck[] = [];
  const models: CmsModelRecord[] = [];
  for (const modelRef of rootConfig.models) {
    const model = await loadModelRecord({
      paths,
      rootConfig,
      modelRef,
      errors,
      referenceChecks,
    });
    if (model) {
      models.push(model);
    }
  }

  const existingEntries = new Set(models.flatMap((model) => model.entries.map((entry) => `${model.key}:${entry.key}`)));
  for (const reference of referenceChecks) {
    const targetId = `${reference.targetModelKey}:${reference.targetEntryKey}`;
    if (!existingEntries.has(targetId)) {
      errors.push(
        `${reference.sourcePath}: field ${reference.fieldKey} references missing entry ${targetId}`,
      );
    }
  }

  const entryCount = models.reduce((total, model) => total + model.entries.length, 0);
  const assetCount = models.reduce(
    (total, model) =>
      total + model.entries.reduce((entryTotal, entry) => entryTotal + entry.assetRefs.length, 0),
    0,
  );

  return {
    sourceKind: "legacy-yaml",
    initialized: true,
    valid: errors.length === 0,
    paths,
    defaultLocale: rootConfig.defaultLocale,
    locales: rootConfig.locales,
    modelCount: models.length,
    entryCount,
    assetCount,
    mediaFileCount: await countFilesRecursively(paths.mediaRoot),
    errors,
    models,
  };
}

export async function validateCmsWorkspace(projectDir: string): Promise<CmsValidationReport> {
  return getCmsStatus(projectDir);
}

async function ensureLegacyYamlWorkspaceOperationSupported(projectDir: string): Promise<void> {
  if ((await inspectAstroCollectionsWorkspace(projectDir)) || (await isAstroProject(projectDir))) {
    throw new Error(
      "Astro-backed projects now use `src/content.config.ts` and Astro entry files as the source of truth. Vivd YAML scaffold/build commands are only supported for the legacy YAML CMS path.",
    );
  }
}

async function writeYamlFile(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, `${stringifyYaml(value)}\n`, "utf8");
}

async function readOrCreateRootConfig(paths: CmsPaths): Promise<CmsRootConfig> {
  const errors: string[] = [];
  const existing = await readRootConfig(paths, errors);
  return existing ?? defaultRootConfig();
}

function buildDefaultCollectionModelSchema(modelKey: string): CmsModelSchema {
  return {
    label: titleizeKey(modelKey),
    storage: {
      path: `./${modelKey}`,
      entryFormat: "file",
    },
    display: {
      primaryField: "title",
    },
    entry: {
      statusField: "status",
      fields: {
        slug: {
          type: "slug",
          required: true,
        },
        title: {
          type: "string",
          localized: true,
          required: true,
        },
        status: {
          type: "enum",
          options: ["active", "inactive"],
          default: "active",
        },
        sortOrder: {
          type: "number",
        },
      },
    },
  };
}

function buildDefaultFieldValue(
  fieldKey: string,
  field: CmsFieldDefinition,
  entryKey: string,
  defaultLocale: string,
  options: { fileEntrySidecarPrefix?: string } = {},
): unknown {
  const titleSeed = titleizeKey(entryKey);
  const preferredText = TITLE_FIELD_KEYS.has(fieldKey) ? titleSeed : "";
  const defaultEnum = field.default ?? field.options?.[0] ?? null;
  const sidecarPrefix = options.fileEntrySidecarPrefix ?? "";

  if (field.localized) {
    if (field.type === "richText" && field.storage === "sidecar-markdown") {
      return {
        [defaultLocale]: `./${sidecarPrefix}${fieldKey}.${defaultLocale}.md`,
      };
    }
    return {
      [defaultLocale]: preferredText,
    };
  }

  switch (field.type) {
    case "slug":
      return entryKey;
    case "string":
    case "text":
    case "richText":
      return preferredText;
    case "enum":
      return defaultEnum;
    case "number":
      return typeof field.default === "number" ? field.default : 0;
    case "boolean":
      return typeof field.default === "boolean" ? field.default : false;
    case "list":
    case "assetList":
      return [];
    case "object": {
      const nested: Record<string, unknown> = {};
      for (const [nestedKey, nestedField] of Object.entries(field.fields ?? {})) {
        nested[nestedKey] = buildDefaultFieldValue(
          nestedKey,
          nestedField,
          entryKey,
          defaultLocale,
          options,
        );
      }
      return nested;
    }
    case "date":
    case "datetime":
    case "reference":
    case "asset":
      return null;
    default:
      return field.default ?? null;
  }
}

async function createDefaultRichTextSidecars(
  entryDir: string,
  fields: Record<string, CmsFieldDefinition>,
  defaultLocale: string,
  created: string[],
  projectDir: string,
  fileNamePrefix = "",
): Promise<void> {
  for (const [fieldKey, field] of Object.entries(fields)) {
    if (field.localized && field.type === "richText" && field.storage === "sidecar-markdown") {
      const filePath = path.join(entryDir, `${fileNamePrefix}${fieldKey}.${defaultLocale}.md`);
      if (await ensurePlaceholderFile(filePath)) {
        created.push(toPosix(path.relative(projectDir, filePath)));
      }
    }
  }
}

export async function scaffoldCmsWorkspace(projectDir: string): Promise<CmsScaffoldResult> {
  await ensureLegacyYamlWorkspaceOperationSupported(projectDir);
  const paths = getCmsPaths(projectDir);
  const created: string[] = [];
  const skipped: string[] = [];
  const directories = [paths.contentRoot, paths.modelsRoot, paths.mediaRoot];

  for (const dirPath of directories) {
    if (await pathExists(dirPath)) {
      skipped.push(toPosix(path.relative(projectDir, dirPath)));
    } else {
      await ensureDirectory(dirPath);
      created.push(toPosix(path.relative(projectDir, dirPath)));
    }
  }

  if (await pathExists(paths.rootConfigPath)) {
    skipped.push(toPosix(path.relative(projectDir, paths.rootConfigPath)));
  } else {
    await writeYamlFile(paths.rootConfigPath, defaultRootConfig());
    created.push(toPosix(path.relative(projectDir, paths.rootConfigPath)));
  }

  for (const placeholder of [".gitkeep", ".gitkeep", ".gitkeep"]) {
    void placeholder;
  }
  for (const filePath of [
    path.join(paths.modelsRoot, ".gitkeep"),
    path.join(paths.mediaRoot, ".gitkeep"),
  ]) {
    if (await ensurePlaceholderFile(filePath)) {
      created.push(toPosix(path.relative(projectDir, filePath)));
    } else {
      skipped.push(toPosix(path.relative(projectDir, filePath)));
    }
  }

  return { created, skipped, paths };
}

export async function scaffoldCmsModel(
  projectDir: string,
  modelKey: string,
): Promise<CmsScaffoldResult> {
  const normalizedKey = modelKey.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(normalizedKey)) {
    throw new Error(`Invalid model key: ${modelKey}`);
  }

  const astroResult = await createAstroCollectionModel(projectDir, normalizedKey, {
    slug: {
      type: "string",
      required: false,
    },
    title: {
      type: "string",
      required: true,
    },
    order: {
      type: "number",
      required: false,
    },
  });
  if (astroResult) {
    return astroResult;
  }

  await ensureLegacyYamlWorkspaceOperationSupported(projectDir);

  const result = await scaffoldCmsWorkspace(projectDir);
  const paths = result.paths;
  const created = [...result.created];
  const skipped = [...result.skipped];
  const config = await readOrCreateRootConfig(paths);
  const existingModel = config.models.find((model) => model.key === normalizedKey);
  if (!existingModel) {
    config.models.push({
      key: normalizedKey,
      kind: "collection",
      schema: `./models/${normalizedKey}.yaml`,
    });
    config.models.sort((left, right) => left.key.localeCompare(right.key));
    await writeYamlFile(paths.rootConfigPath, config);
    if (!created.includes(toPosix(path.relative(projectDir, paths.rootConfigPath)))) {
      created.push(toPosix(path.relative(projectDir, paths.rootConfigPath)));
    }
  } else {
    skipped.push(toPosix(path.relative(projectDir, paths.rootConfigPath)));
  }

  const schemaPath = path.join(paths.modelsRoot, `${normalizedKey}.yaml`);
  if (await pathExists(schemaPath)) {
    skipped.push(toPosix(path.relative(projectDir, schemaPath)));
  } else {
    await writeYamlFile(schemaPath, buildDefaultCollectionModelSchema(normalizedKey));
    created.push(toPosix(path.relative(projectDir, schemaPath)));
  }

  const collectionDir = path.join(paths.contentRoot, normalizedKey);
  if (await pathExists(collectionDir)) {
    skipped.push(toPosix(path.relative(projectDir, collectionDir)));
  } else {
    await ensureDirectory(collectionDir);
    created.push(toPosix(path.relative(projectDir, collectionDir)));
  }
  const placeholderPath = path.join(collectionDir, ".gitkeep");
  if (await ensurePlaceholderFile(placeholderPath)) {
    created.push(toPosix(path.relative(projectDir, placeholderPath)));
  } else {
    skipped.push(toPosix(path.relative(projectDir, placeholderPath)));
  }

  return { created, skipped, paths };
}

export async function scaffoldCmsEntry(
  projectDir: string,
  modelKey: string,
  entryKey: string,
): Promise<CmsScaffoldResult> {
  await ensureLegacyYamlWorkspaceOperationSupported(projectDir);
  const normalizedModelKey = modelKey.trim().toLowerCase();
  const normalizedEntryKey = entryKey.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(normalizedEntryKey)) {
    throw new Error(`Invalid entry key: ${entryKey}`);
  }

  const modelResult = await scaffoldCmsModel(projectDir, normalizedModelKey);
  const paths = modelResult.paths;
  const created = [...modelResult.created];
  const skipped = [...modelResult.skipped];
  const report = await getCmsStatus(projectDir);
  const model = report.models.find((item) => item.key === normalizedModelKey);
  if (!model) {
    throw new Error(`Model not found: ${normalizedModelKey}`);
  }

  const rootConfig = await readOrCreateRootConfig(paths);
  const entryDir =
    model.entryFormat === "directory"
      ? path.join(model.collectionRoot, normalizedEntryKey)
      : model.collectionRoot;
  const entryFile =
    model.entryFormat === "directory"
      ? path.join(entryDir, "index.yaml")
      : path.join(model.collectionRoot, `${normalizedEntryKey}.yaml`);
  if (await pathExists(entryFile)) {
    skipped.push(toPosix(path.relative(projectDir, entryFile)));
    return { created, skipped, paths };
  }

  if (model.entryFormat === "directory") {
    await ensureDirectory(entryDir);
    created.push(toPosix(path.relative(projectDir, entryDir)));
  }

  const values: Record<string, unknown> = {};
  const fileEntrySidecarPrefix = model.entryFormat === "file" ? `${normalizedEntryKey}.` : "";
  for (const [fieldKey, field] of Object.entries(model.fields)) {
    values[fieldKey] = buildDefaultFieldValue(
      fieldKey,
      field,
      normalizedEntryKey,
      rootConfig.defaultLocale,
      { fileEntrySidecarPrefix },
    );
  }

  await writeYamlFile(entryFile, values);
  created.push(toPosix(path.relative(projectDir, entryFile)));
  await createDefaultRichTextSidecars(
    entryDir,
    model.fields,
    rootConfig.defaultLocale,
    created,
    projectDir,
    fileEntrySidecarPrefix,
  );

  return { created, skipped, paths };
}

export async function createCmsEntry(
  projectDir: string,
  modelKey: string,
  entryKey: string,
): Promise<CmsCreateEntryResult> {
  const astroResult = await createAstroCollectionEntry(projectDir, modelKey, entryKey);
  if (astroResult) {
    return astroResult;
  }

  const scaffold = await scaffoldCmsEntry(projectDir, modelKey, entryKey);
  const normalizedEntryKey = entryKey.trim().toLowerCase();
  const createdEntryRelativePath =
    scaffold.created.find((createdPath) => /\.(json|ya?ml|mdx?|markdown)$/i.test(createdPath)) ??
    path.posix.join("src/content", modelKey.trim().toLowerCase(), `${normalizedEntryKey}.yaml`);

  return {
    ...scaffold,
    createdEntryKey: normalizedEntryKey,
    createdEntryRelativePath,
  };
}

export async function updateCmsEntryFields(
  projectDir: string,
  updates: CmsEntryFieldUpdate[],
): Promise<CmsUpdateEntriesResult> {
  if (updates.length === 0) {
    throw new Error("At least one CMS entry update is required");
  }

  const report = await getCmsStatus(projectDir);
  if (!report.initialized) {
    throw new Error("CMS workspace not initialized");
  }

  const updatesByEntry = new Map<string, CmsEntryFieldUpdate[]>();
  for (const update of updates) {
    const modelKey = update.modelKey.trim();
    const entryKey = update.entryKey.trim();
    if (!modelKey || !entryKey || update.fieldPath.length === 0) {
      throw new Error("Invalid CMS preview field update");
    }
    const key = `${modelKey}:${entryKey}`;
    const existing = updatesByEntry.get(key) ?? [];
    existing.push({
      ...update,
      modelKey,
      entryKey,
    });
    updatesByEntry.set(key, existing);
  }

  const updated = new Set<string>();

  for (const [entryId, entryUpdates] of updatesByEntry.entries()) {
    const [modelKey, entryKey] = entryId.split(":");
    const model = report.models.find((item) => item.key === modelKey);
    if (!model) {
      throw new Error(`Collection not found: ${modelKey}`);
    }

    const entry = model.entries.find((item) => item.key === entryKey);
    if (!entry) {
      throw new Error(`Entry not found: ${entryId}`);
    }

    let nextValues = cloneValue(entry.values);
    for (const update of entryUpdates) {
      const fieldDefinition = resolveFieldDefinitionAtPath(model.fields, update.fieldPath);
      if (!fieldDefinition) {
        throw new Error(
          `Field not found for ${entryId}: ${update.fieldPath.map((segment) => String(segment)).join(".")}`,
        );
      }

      nextValues = setValueAtPath(
        nextValues,
        update.fieldPath,
        normalizeUpdatedFieldValue(entry.relativePath, fieldDefinition, update.value),
      );
    }

    const currentContent = await fs.readFile(entry.filePath, "utf8");
    const nextContent = serializeCmsEntryValues(entry.relativePath, nextValues, currentContent);
    if (nextContent !== currentContent) {
      await fs.writeFile(entry.filePath, nextContent, "utf8");
      updated.add(entry.relativePath);
    }
  }

  return {
    updated: [...updated].sort((left, right) => left.localeCompare(right)),
    paths: report.paths,
  };
}

export async function updateCmsModel(
  projectDir: string,
  modelKey: string,
  fields: Record<string, CmsFieldDefinition>,
): Promise<CmsUpdateModelResult> {
  const astroResult = await updateAstroCollectionModel(projectDir, modelKey, fields);
  if (astroResult) {
    return astroResult;
  }

  throw new Error(
    "Structured model editing is currently only supported for Astro Content Collections.",
  );
}

async function readPackageJson(projectDir: string): Promise<Record<string, unknown> | null> {
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function isAstroProject(projectDir: string): Promise<boolean> {
  for (const candidate of [
    "astro.config.mjs",
    "astro.config.js",
    "astro.config.ts",
    "astro.config.cjs",
    "astro.config.mts",
  ]) {
    if (await pathExists(path.join(projectDir, candidate))) {
      return true;
    }
  }

  const packageJson = await readPackageJson(projectDir);
  if (!packageJson) return false;

  const dependencies = isRecord(packageJson.dependencies)
    ? packageJson.dependencies
    : null;
  const devDependencies = isRecord(packageJson.devDependencies)
    ? packageJson.devDependencies
    : null;

  return (
    typeof dependencies?.astro === "string" ||
    typeof devDependencies?.astro === "string"
  );
}
