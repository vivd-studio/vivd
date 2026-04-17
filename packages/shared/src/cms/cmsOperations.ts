import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  createAstroCollectionEntry,
  createAstroCollectionModel,
  inspectAstroCollectionsWorkspace,
  updateAstroCollectionModel,
} from "./astroCollections.js";
import {
  normalizeUpdatedFieldValue,
  resolveFieldDefinitionAtPath,
  serializeCmsEntryValues,
  setValueAtPath,
} from "./entryUpdates.js";
import type {
  CmsCreateEntryResult,
  CmsEntryFieldUpdate,
  CmsFieldDefinition,
  CmsModelSchema,
  CmsPaths,
  CmsRootConfig,
  CmsScaffoldResult,
  CmsUpdateEntriesResult,
  CmsUpdateModelResult,
} from "./cmsCore.js";
import {
  TITLE_FIELD_KEYS,
  defaultRootConfig,
  ensureDirectory,
  ensurePlaceholderFile,
  getCmsPaths,
  pathExists,
  titleizeKey,
  toPosix,
} from "./cmsCore.js";
import { readRootConfig } from "./cmsLegacyInspection.js";
import { isAstroProject } from "./cmsProjectDetection.js";
import { getCmsStatus } from "./cmsStatus.js";

async function ensureLegacyYamlWorkspaceOperationSupported(projectDir: string): Promise<void> {
  if ((await inspectAstroCollectionsWorkspace(projectDir)) || (await isAstroProject(projectDir))) {
    throw new Error(
      "Astro-backed projects use `src/content.config.ts` and Astro entry files under `src/content/**` as the source of truth. This scaffold command does not apply to Astro Content Collections.",
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

    let nextValues = JSON.parse(JSON.stringify(entry.values)) as Record<string, unknown>;
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
        normalizeUpdatedFieldValue(entry.relativePath, fieldDefinition, update.value, {
          sourceKind: report.sourceKind,
        }),
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
