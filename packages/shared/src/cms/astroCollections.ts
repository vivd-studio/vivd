import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type {
  CmsCreateEntryResult,
  CmsFieldDefinition,
  CmsModelRecord,
  CmsScaffoldResult,
  CmsUpdateModelResult,
} from "./index.js";
import {
  buildAstroSchemaExpression,
  ensureAstroContentImports,
  findExportedCollectionsObject,
  getExpressionPath,
  getLineIndent,
  getObjectPropertyValue,
  inspectAstroProjectLocales,
  inferPrimaryField,
  inferSortField,
  parseSchemaObject,
  resolveCollectionRoot,
  usesReferenceHelperInField,
  withTransparentWrappers,
} from "./astroCollections/schema.js";
import {
  buildDefaultAstroFieldValue,
  buildEntriesForCollection,
  collectAssetRefs,
  collectAstroReferenceChecks,
  inferEntryLayoutFromModel,
  normalizeEntryKey,
  serializeAstroEntryValues,
} from "./astroCollections/entries.js";
import {
  type AstroCollectionsValidationReport,
  type AstroReferenceCheck,
  type ParsedCollectionDefinition,
  buildAstroPaths,
  countFilesRecursively,
  findAstroContentConfigPath,
  getAstroSchemaLocales,
  pathExists,
  titleizeKey,
  toPosix,
} from "./astroCollections/shared.js";
import { applyAstroFieldHintsToFields } from "./astroCollections/schema.js";

function renderObjectKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function buildAstroCollectionProperty(
  modelKey: string,
  fields: Record<string, CmsFieldDefinition>,
  propertyIndent: string,
  localeConfig: Awaited<ReturnType<typeof inspectAstroProjectLocales>>,
): string {
  const schemaIndent = `${propertyIndent}  `;
  return `${propertyIndent}${renderObjectKey(modelKey)}: defineCollection({\n${schemaIndent}schema: ${buildAstroSchemaExpression(fields, schemaIndent, localeConfig)},\n${propertyIndent}}),`;
}

export async function createAstroCollectionEntry(
  projectDir: string,
  modelKey: string,
  entryKey: string,
): Promise<CmsCreateEntryResult | null> {
  const report = await inspectAstroCollectionsWorkspace(projectDir);
  if (!report) {
    return null;
  }

  const model = report.models.find((item) => item.key === modelKey.trim());
  if (!model) {
    throw new Error(`Collection not found: ${modelKey}`);
  }

  const normalizedEntryKey = normalizeEntryKey(entryKey);
  if (model.entries.some((entry) => entry.key === normalizedEntryKey)) {
    throw new Error(`Entry already exists: ${normalizedEntryKey}`);
  }

  const { extension, directoryIndexEntries } = inferEntryLayoutFromModel(model);
  const entryFilePath = directoryIndexEntries
    ? path.join(model.collectionRoot, normalizedEntryKey, `index${extension}`)
    : path.join(model.collectionRoot, `${normalizedEntryKey}${extension}`);
  const relativeEntryPath = toPosix(path.relative(projectDir, entryFilePath));

  if (await pathExists(entryFilePath)) {
    throw new Error(`Entry already exists: ${relativeEntryPath}`);
  }

  await fs.mkdir(path.dirname(entryFilePath), { recursive: true });

  const values: Record<string, unknown> = {};
  for (const [fieldKey, field] of Object.entries(model.fields)) {
    values[fieldKey] = buildDefaultAstroFieldValue(
      fieldKey,
      field,
      normalizedEntryKey,
      report.defaultLocale ?? "en",
    );
  }

  await fs.writeFile(
    entryFilePath,
    serializeAstroEntryValues(entryFilePath, values),
    "utf8",
  );

  const created: string[] = [];
  if (directoryIndexEntries) {
    created.push(toPosix(path.relative(projectDir, path.dirname(entryFilePath))));
  }
  created.push(relativeEntryPath);

  return {
    created,
    skipped: [],
    paths: report.paths,
    createdEntryKey: normalizedEntryKey,
    createdEntryRelativePath: relativeEntryPath,
  };
}

export async function createAstroCollectionModel(
  projectDir: string,
  modelKey: string,
  fields: Record<string, CmsFieldDefinition>,
): Promise<CmsScaffoldResult | null> {
  const configPath = await findAstroContentConfigPath(projectDir);
  if (!configPath) {
    return null;
  }

  const normalizedKey = modelKey.trim();
  if (!normalizedKey) {
    throw new Error("Collection key is required");
  }

  const source = await fs.readFile(configPath, "utf8");
  const sourceFile = ts.createSourceFile(
    configPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    configPath.endsWith(".js") || configPath.endsWith(".mjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS,
  );

  const { collectionsObject } = findExportedCollectionsObject(sourceFile);
  if (!collectionsObject) {
    throw new Error("Could not find exported Astro collections object");
  }

  for (const property of collectionsObject.properties) {
    const propertyName =
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ? property.name.text
        : ts.isShorthandPropertyAssignment(property)
          ? property.name.text
          : null;
    if (propertyName === normalizedKey) {
      throw new Error(`Collection already exists: ${normalizedKey}`);
    }
  }

  const objectIndent = getLineIndent(source, collectionsObject.getStart(sourceFile));
  const propertyIndent = `${objectIndent}  `;
  const localeConfig = await inspectAstroProjectLocales(projectDir);
  const propertyText = buildAstroCollectionProperty(
    normalizedKey,
    fields,
    propertyIndent,
    localeConfig,
  );

  let nextSource = source;
  if (collectionsObject.properties.length === 0) {
    const replacement = `{\n${propertyText}\n${objectIndent}}`;
    nextSource = `${source.slice(0, collectionsObject.getStart(sourceFile))}${replacement}${source.slice(collectionsObject.getEnd())}`;
  } else {
    const insertPos = collectionsObject.getEnd() - 1;
    const trailingSegment = source.slice(
      collectionsObject.properties[collectionsObject.properties.length - 1]!.getEnd(),
      insertPos,
    );
    const needsComma = !trailingSegment.includes(",");
    nextSource = `${source.slice(0, insertPos)}${needsComma ? "," : ""}\n${propertyText}\n${objectIndent}${source.slice(insertPos)}`;
  }

  const requiredImports = new Set(["defineCollection", "z"]);
  if (Object.values(fields).some(usesReferenceHelperInField)) {
    requiredImports.add("reference");
  }
  nextSource = ensureAstroContentImports(nextSource, requiredImports);

  if (nextSource !== source) {
    await fs.writeFile(configPath, nextSource, "utf8");
  }

  const collectionRoot = path.join(projectDir, "src", "content", normalizedKey);
  const created: string[] = [];
  const skipped: string[] = [];

  if (await pathExists(collectionRoot)) {
    skipped.push(toPosix(path.relative(projectDir, collectionRoot)));
  } else {
    await fs.mkdir(collectionRoot, { recursive: true });
    created.push(toPosix(path.relative(projectDir, collectionRoot)));
  }

  const placeholderPath = path.join(collectionRoot, ".gitkeep");
  if (await pathExists(placeholderPath)) {
    skipped.push(toPosix(path.relative(projectDir, placeholderPath)));
  } else {
    await fs.writeFile(placeholderPath, "", "utf8");
    created.push(toPosix(path.relative(projectDir, placeholderPath)));
  }

  created.unshift(toPosix(path.relative(projectDir, configPath)));

  return {
    created,
    skipped,
    paths: buildAstroPaths(projectDir, configPath),
  };
}

export async function updateAstroCollectionModel(
  projectDir: string,
  modelKey: string,
  fields: Record<string, CmsFieldDefinition>,
): Promise<CmsUpdateModelResult | null> {
  const configPath = await findAstroContentConfigPath(projectDir);
  if (!configPath) {
    return null;
  }

  const source = await fs.readFile(configPath, "utf8");
  const sourceFile = ts.createSourceFile(
    configPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    configPath.endsWith(".js") || configPath.endsWith(".mjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS,
  );

  const { declarations, collectionsObject } = findExportedCollectionsObject(sourceFile);
  if (!collectionsObject) {
    throw new Error("Could not find exported Astro collections object");
  }

  let collectionConfig: ts.ObjectLiteralExpression | null = null;
  let schemaNode: ts.Expression | null = null;

  for (const property of collectionsObject.properties) {
    let collectionKey: string | null = null;
    let initializer: ts.Expression | null = null;

    if (ts.isPropertyAssignment(property)) {
      collectionKey =
        ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : null;
      initializer = property.initializer;
    } else if (ts.isShorthandPropertyAssignment(property)) {
      collectionKey = property.name.text;
      initializer = declarations.get(property.name.text) ?? null;
    }

    if (collectionKey !== modelKey.trim() || !initializer) {
      continue;
    }

    const resolvedInitializer = ts.isIdentifier(initializer)
      ? declarations.get(initializer.text) ?? initializer
      : initializer;
    const initializerExpression = withTransparentWrappers(resolvedInitializer);
    if (!ts.isCallExpression(initializerExpression)) {
      throw new Error(`Collection ${modelKey} must call defineCollection(...)`);
    }

    const collectionArg = initializerExpression.arguments[0];
    collectionConfig =
      collectionArg && ts.isObjectLiteralExpression(withTransparentWrappers(collectionArg))
        ? (withTransparentWrappers(collectionArg) as ts.ObjectLiteralExpression)
        : null;
    if (!collectionConfig) {
      throw new Error(`Collection ${modelKey} must pass an object literal to defineCollection(...)`);
    }

    schemaNode = getObjectPropertyValue(collectionConfig, "schema");
    break;
  }

  if (!collectionConfig || !schemaNode) {
    throw new Error(`Collection not found: ${modelKey}`);
  }

  const schemaPropertyIndent = getLineIndent(source, schemaNode.getStart(sourceFile));
  const localeConfig = await inspectAstroProjectLocales(projectDir);
  const nextSchemaExpression = buildAstroSchemaExpression(
    fields,
    schemaPropertyIndent,
    localeConfig,
  );
  let nextSource = `${source.slice(0, schemaNode.getStart(sourceFile))}${nextSchemaExpression}${source.slice(schemaNode.getEnd())}`;

  const requiredImports = new Set(["defineCollection", "z"]);
  if (Object.values(fields).some(usesReferenceHelperInField)) {
    requiredImports.add("reference");
  }
  nextSource = ensureAstroContentImports(nextSource, requiredImports);

  if (nextSource !== source) {
    await fs.writeFile(configPath, nextSource, "utf8");
  }

  return {
    updated: [toPosix(path.relative(projectDir, configPath))],
    paths: buildAstroPaths(projectDir, configPath),
  };
}

async function parseCollections(
  projectDir: string,
  configPath: string,
  sourceFile: ts.SourceFile,
  localeConfig: Awaited<ReturnType<typeof inspectAstroProjectLocales>>,
  errors: string[],
): Promise<CmsModelRecord[]> {
  const { declarations, collectionsObject } = findExportedCollectionsObject(sourceFile);
  if (!collectionsObject) {
    errors.push(
      `${toPosix(path.relative(projectDir, configPath))}: expected \`export const collections = { ... }\``,
    );
    return [];
  }

  const parsedModels: ParsedCollectionDefinition[] = [];

  for (const property of collectionsObject.properties) {
    let collectionKey: string | null = null;
    let initializer: ts.Expression | null = null;

    if (ts.isPropertyAssignment(property)) {
      collectionKey =
        ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : null;
      initializer = property.initializer;
    } else if (ts.isShorthandPropertyAssignment(property)) {
      collectionKey = property.name.text;
      initializer = declarations.get(property.name.text) ?? null;
    }

    if (!collectionKey || !initializer) {
      errors.push(
        `${toPosix(path.relative(projectDir, configPath))}: unsupported collection declaration`,
      );
      continue;
    }

    const resolvedInitializer = ts.isIdentifier(initializer)
      ? declarations.get(initializer.text) ?? initializer
      : initializer;
    const initializerExpression = withTransparentWrappers(resolvedInitializer);
    if (!ts.isCallExpression(initializerExpression)) {
      errors.push(
        `${toPosix(path.relative(projectDir, configPath))}: collection ${collectionKey} must call defineCollection(...)`,
      );
      continue;
    }

    const collectionFactory = getExpressionPath(initializerExpression.expression)?.join(".");
    if (collectionFactory !== "defineCollection") {
      errors.push(
        `${toPosix(path.relative(projectDir, configPath))}: collection ${collectionKey} must use defineCollection(...)`,
      );
      continue;
    }

    const collectionArg = initializerExpression.arguments[0];
    const collectionConfig =
      collectionArg && ts.isObjectLiteralExpression(withTransparentWrappers(collectionArg))
        ? (withTransparentWrappers(collectionArg) as ts.ObjectLiteralExpression)
        : null;

    if (!collectionConfig) {
      errors.push(
        `${toPosix(path.relative(projectDir, configPath))}: collection ${collectionKey} must pass an object literal`,
      );
      continue;
    }

    const schemaExpression = getObjectPropertyValue(collectionConfig, "schema");
    if (!schemaExpression) {
      errors.push(
        `${toPosix(path.relative(projectDir, configPath))}: collection ${collectionKey} is missing schema`,
      );
      continue;
    }

    const fieldErrors: string[] = [];
    const fields = parseSchemaObject(schemaExpression, {
      imageHelpers: new Set(["image"]),
      errors: fieldErrors,
      label: `${toPosix(path.relative(projectDir, configPath))}:${collectionKey}`,
      defaultLocale: localeConfig.defaultLocale,
      locales: getAstroSchemaLocales(localeConfig),
    });
    errors.push(...fieldErrors);
    if (!fields) continue;

    const rootResolution = resolveCollectionRoot(projectDir, configPath, collectionKey, collectionConfig);
    if (rootResolution.error) {
      errors.push(
        `${toPosix(path.relative(projectDir, configPath))}: collection ${collectionKey} ${rootResolution.error}`,
      );
    }

    parsedModels.push({
      key: collectionKey,
      label: titleizeKey(collectionKey),
      fields,
      collectionRoot: rootResolution.root,
      relativeCollectionRoot: toPosix(path.relative(projectDir, rootResolution.root)),
      schemaPath: configPath,
      relativeSchemaPath: toPosix(path.relative(projectDir, configPath)),
      sortField: inferSortField(fields),
      supportedEntries: rootResolution.supportedEntries,
      entryExtensionHint: rootResolution.entryExtensionHint,
      directoryIndexEntries: rootResolution.directoryIndexEntries,
    });
  }

  const models: CmsModelRecord[] = [];
  for (const parsedModel of parsedModels) {
    const entries = await buildEntriesForCollection(projectDir, parsedModel);
    const fields = applyAstroFieldHintsToFields(parsedModel.fields, entries);
    for (const entry of entries) {
      entry.assetRefs = collectAssetRefs(projectDir, entry, parsedModel.key, fields);
    }
    models.push({
      key: parsedModel.key,
      label: parsedModel.label,
      schemaPath: parsedModel.schemaPath,
      relativeSchemaPath: parsedModel.relativeSchemaPath,
      collectionRoot: parsedModel.collectionRoot,
      relativeCollectionRoot: parsedModel.relativeCollectionRoot,
      entryFormat: "file",
      entryFileExtension: parsedModel.entryExtensionHint,
      directoryIndexEntries: parsedModel.directoryIndexEntries,
      sortField: parsedModel.sortField,
      display: inferPrimaryField(fields)
        ? { primaryField: inferPrimaryField(fields) }
        : undefined,
      fields,
      entries,
    });
  }

  return models.sort((left, right) => left.key.localeCompare(right.key));
}

export async function inspectAstroCollectionsWorkspace(
  projectDir: string,
): Promise<AstroCollectionsValidationReport | null> {
  const configPath = await findAstroContentConfigPath(projectDir);
  if (!configPath) return null;

  const paths = buildAstroPaths(projectDir, configPath);
  const errors: string[] = [];
  const source = await fs.readFile(configPath, "utf8");
  const sourceFile = ts.createSourceFile(
    configPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    configPath.endsWith(".js") || configPath.endsWith(".mjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS,
  );

  const localeConfig = await inspectAstroProjectLocales(projectDir);
  const models = await parseCollections(projectDir, configPath, sourceFile, localeConfig, errors);
  const referenceChecks: AstroReferenceCheck[] = [];
  for (const model of models) {
    for (const entry of model.entries) {
      collectAstroReferenceChecks({
        entry,
        fields: model.fields,
        errors,
        referenceChecks,
      });
    }
  }

  const existingEntries = new Set(
    models.flatMap((model) => model.entries.map((entry) => `${model.key}:${entry.key}`)),
  );
  for (const reference of referenceChecks) {
    const targetId = `${reference.targetModelKey}:${reference.targetEntryKey}`;
    if (!existingEntries.has(targetId)) {
      errors.push(
        `${reference.sourcePath}: field ${reference.fieldPath} references missing entry ${targetId}`,
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
    sourceKind: "astro-collections",
    initialized: true,
    valid: errors.length === 0,
    paths,
    defaultLocale: localeConfig.defaultLocale,
    locales: localeConfig.locales,
    modelCount: models.length,
    entryCount,
    assetCount,
    mediaFileCount: await countFilesRecursively(paths.mediaRoot),
    errors,
    models,
  };
}
