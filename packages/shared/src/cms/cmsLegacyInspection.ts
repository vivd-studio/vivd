import fs from "node:fs/promises";
import path from "node:path";
import type {
  CmsAssetRecord,
  CmsEntryRecord,
  CmsFieldDefinition,
  CmsModelRecord,
  CmsModelRef,
  CmsModelSchema,
  CmsPaths,
  CmsRootConfig,
  CmsToolkitStatusReport,
  CmsValidationReport,
} from "./cmsCore.js";
import {
  CMS_VERSION,
  LOCALIZED_FIELD_TYPES,
  SUPPORTED_FIELD_TYPES,
  TITLE_FIELD_KEYS,
  countFilesRecursively,
  ensureDirectory,
  isRecord,
  pathExists,
  readYamlObject,
  titleizeKey,
  toPosix,
} from "./cmsCore.js";

type ReferenceCheck = {
  sourcePath: string;
  modelKey: string;
  entryKey: string;
  fieldKey: string;
  targetModelKey: string;
  targetEntryKey: string;
};

export async function readRootConfig(
  paths: CmsPaths,
  errors: string[],
): Promise<CmsRootConfig | null> {
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

function parseReferenceTarget(value: unknown): { modelKey: string; entryKey: string } | null {
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
            errors.push(`${buildFieldLocation(entryLabel, `${fieldKey}.${nestedKey}`)} is required`);
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
      const expectedModelKey = field.referenceModelKey?.trim();
      if (expectedModelKey && target.modelKey !== expectedModelKey) {
        errors.push(
          `${buildFieldLocation(entryLabel, fieldKey)} must reference an entry in ${expectedModelKey}`,
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
        artifactPath: toPosix(
          path.join(
            "media",
            path.relative(path.join(contentRoot, "media"), resolved.absolutePath),
          ),
        ),
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

export async function inspectLegacyYamlCmsWorkspace(options: {
  paths: CmsPaths;
  rootConfig: CmsRootConfig;
  toolkit: CmsToolkitStatusReport;
}): Promise<CmsValidationReport> {
  const { paths, rootConfig, toolkit } = options;
  const errors: string[] = [];
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

  const existingEntries = new Set(
    models.flatMap((model) => model.entries.map((entry) => `${model.key}:${entry.key}`)),
  );
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
    toolkit,
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
