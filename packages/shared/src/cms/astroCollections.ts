import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import type {
  CmsAssetRecord,
  CmsEntryRecord,
  CmsFieldDefinition,
  CmsModelRecord,
  CmsPaths,
  CmsValidationReport,
} from "./index.js";

const ASTRO_CONTENT_CONFIG_CANDIDATES = [
  path.join("src", "content.config.ts"),
  path.join("src", "content.config.mts"),
  path.join("src", "content.config.js"),
  path.join("src", "content.config.mjs"),
];

const TITLE_FIELD_KEYS = new Set(["title", "name", "label"]);
const SUPPORTED_ENTRY_EXTENSIONS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".mdx",
  ".markdown",
]);

type ParsedFieldResult = {
  field: CmsFieldDefinition;
  supported: boolean;
};

type ParsedCollectionDefinition = {
  key: string;
  label: string;
  fields: Record<string, CmsFieldDefinition>;
  collectionRoot: string;
  relativeCollectionRoot: string;
  schemaPath: string;
  relativeSchemaPath: string;
  sortField: string | null;
  supportedEntries: boolean;
};

type SchemaParseContext = {
  imageHelpers: Set<string>;
  errors: string[];
  label: string;
};

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function titleizeKey(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

async function findAstroContentConfigPath(projectDir: string): Promise<string | null> {
  for (const relativePath of ASTRO_CONTENT_CONFIG_CANDIDATES) {
    const absolutePath = path.join(projectDir, relativePath);
    if (await pathExists(absolutePath)) {
      return absolutePath;
    }
  }
  return null;
}

function buildAstroPaths(projectDir: string, configPath: string): CmsPaths {
  return {
    projectDir,
    contentRoot: path.join(projectDir, "src", "content"),
    rootConfigPath: configPath,
    modelsRoot: path.dirname(configPath),
    collectionsRoot: path.join(projectDir, "src", "content"),
    mediaRoot: path.join(projectDir, "src", "content", "media"),
  };
}

function withTransparentWrappers(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) {
    return withTransparentWrappers(expression.expression);
  }
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return withTransparentWrappers(expression.expression);
  }
  return expression;
}

function getExpressionPath(expression: ts.Expression): string[] | null {
  const unwrapped = withTransparentWrappers(expression);
  if (ts.isIdentifier(unwrapped)) {
    return [unwrapped.text];
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const base = getExpressionPath(unwrapped.expression);
    return base ? [...base, unwrapped.name.text] : null;
  }
  return null;
}

function getObjectPropertyValue(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | null {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      continue;
    }
    const nameText =
      ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : null;
    if (nameText !== propertyName) continue;
    return ts.isPropertyAssignment(property) ? property.initializer : property.name;
  }
  return null;
}

function findExportedCollectionsObject(
  sourceFile: ts.SourceFile,
): {
  declarations: Map<string, ts.Expression>;
  collectionsObject: ts.ObjectLiteralExpression | null;
} {
  const declarations = new Map<string, ts.Expression>();
  let collectionsObject: ts.ObjectLiteralExpression | null = null;

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isExported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      declarations.set(declaration.name.text, declaration.initializer);
      if (
        isExported &&
        declaration.name.text === "collections" &&
        ts.isObjectLiteralExpression(withTransparentWrappers(declaration.initializer))
      ) {
        collectionsObject = withTransparentWrappers(
          declaration.initializer,
        ) as ts.ObjectLiteralExpression;
      }
    }
  }

  return { declarations, collectionsObject };
}

function expressionToStringLiteral(expression: ts.Expression): string | null {
  const unwrapped = withTransparentWrappers(expression);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }
  return null;
}

function resolveCollectionRoot(
  projectDir: string,
  configPath: string,
  collectionKey: string,
  collectionConfig: ts.ObjectLiteralExpression,
): { root: string; supportedEntries: boolean; error: string | null } {
  const loaderExpression = getObjectPropertyValue(collectionConfig, "loader");
  if (!loaderExpression) {
    const root = path.join(projectDir, "src", "content", collectionKey);
    return { root, supportedEntries: true, error: null };
  }

  const unwrapped = withTransparentWrappers(loaderExpression);
  if (!ts.isCallExpression(unwrapped)) {
    return {
      root: path.join(projectDir, "src", "content", collectionKey),
      supportedEntries: false,
      error: "unsupported non-call loader",
    };
  }

  const loaderPath = getExpressionPath(unwrapped.expression)?.join(".");
  if (loaderPath !== "glob") {
    return {
      root: path.join(projectDir, "src", "content", collectionKey),
      supportedEntries: false,
      error: `unsupported loader ${loaderPath ?? "<unknown>"}`,
    };
  }

  const loaderArg = unwrapped.arguments[0];
  if (!loaderArg || !ts.isObjectLiteralExpression(withTransparentWrappers(loaderArg))) {
    return {
      root: path.join(projectDir, "src", "content", collectionKey),
      supportedEntries: false,
      error: "glob loader missing object configuration",
    };
  }

  const baseExpression = getObjectPropertyValue(
    withTransparentWrappers(loaderArg) as ts.ObjectLiteralExpression,
    "base",
  );
  const baseValue = baseExpression ? expressionToStringLiteral(baseExpression) : null;
  if (!baseValue) {
    return {
      root: path.join(projectDir, "src", "content", collectionKey),
      supportedEntries: false,
      error: "glob loader base must be a string literal",
    };
  }

  let root = baseValue;
  if (!path.isAbsolute(root)) {
    if (root.startsWith("./src/") || root.startsWith("src/")) {
      root = path.join(projectDir, root.replace(/^\.\//, ""));
    } else {
      root = path.resolve(path.dirname(configPath), root);
    }
  }

  return {
    root,
    supportedEntries: true,
    error: null,
  };
}

function parseEnumOptions(expression: ts.Expression): string[] | null {
  const unwrapped = withTransparentWrappers(expression);
  if (!ts.isArrayLiteralExpression(unwrapped)) return null;
  const values: string[] = [];
  for (const element of unwrapped.elements) {
    if (!ts.isStringLiteral(element) && !ts.isNoSubstitutionTemplateLiteral(element)) {
      return null;
    }
    values.push(element.text);
  }
  return values;
}

function parseSchemaFunctionBody(
  expression: ts.Expression,
  context: SchemaParseContext,
): ParsedFieldResult | null {
  const unwrapped = withTransparentWrappers(expression);
  if (!ts.isArrowFunction(unwrapped) && !ts.isFunctionExpression(unwrapped)) {
    return null;
  }

  const imageHelpers = new Set(context.imageHelpers);
  const firstParameter = unwrapped.parameters[0];
  if (firstParameter && ts.isObjectBindingPattern(firstParameter.name)) {
    for (const element of firstParameter.name.elements) {
      const name = element.name;
      if (ts.isIdentifier(name)) {
        imageHelpers.add(name.text);
      }
    }
  }

  let bodyExpression: ts.Expression | null = null;
  if (ts.isBlock(unwrapped.body)) {
    for (const statement of unwrapped.body.statements) {
      if (ts.isReturnStatement(statement) && statement.expression) {
        bodyExpression = statement.expression;
        break;
      }
    }
  } else {
    bodyExpression = unwrapped.body;
  }

  if (!bodyExpression) {
    context.errors.push(`${context.label}: schema callback must return a Zod object`);
    return null;
  }

  return parseSchemaExpression(bodyExpression, {
    ...context,
    imageHelpers,
  });
}

function parseSchemaObject(
  expression: ts.Expression,
  context: SchemaParseContext,
): Record<string, CmsFieldDefinition> | null {
  const fieldResult = parseSchemaExpression(expression, context);
  if (!fieldResult || fieldResult.field.type !== "object" || !fieldResult.field.fields) {
    context.errors.push(`${context.label}: collection schema must resolve to z.object({...})`);
    return null;
  }
  return fieldResult.field.fields;
}

function parseSchemaExpression(
  expression: ts.Expression,
  context: SchemaParseContext,
): ParsedFieldResult | null {
  const unwrapped = withTransparentWrappers(expression);

  const callbackResult = parseSchemaFunctionBody(unwrapped, context);
  if (callbackResult) return callbackResult;

  if (ts.isCallExpression(unwrapped) && ts.isPropertyAccessExpression(unwrapped.expression)) {
    const methodName = unwrapped.expression.name.text;
    const receiver = unwrapped.expression.expression;
    if (methodName === "array") {
      const item = parseSchemaExpression(receiver, context);
      if (!item) return null;
      if (item.field.type === "asset") {
        return {
          field: {
            type: "assetList",
            label: item.field.label,
            description: item.field.description,
            accepts: item.field.accepts,
            required: item.field.required,
          },
          supported: item.supported,
        };
      }
      return {
        field: {
          type: "list",
          label: item.field.label,
          description: item.field.description,
          required: item.field.required,
          item: item.field,
        },
        supported: item.supported,
      };
    }

    if (methodName === "optional" || methodName === "nullable" || methodName === "nullish") {
      const parsed = parseSchemaExpression(receiver, context);
      if (!parsed) return null;
      return {
        field: {
          ...parsed.field,
          required: false,
        },
        supported: parsed.supported,
      };
    }

    if (methodName === "default") {
      const parsed = parseSchemaExpression(receiver, context);
      if (!parsed) return null;
      return {
        field: {
          ...parsed.field,
          required: false,
          default: unwrapped.arguments[0]
            ? expressionToStringLiteral(unwrapped.arguments[0]) ?? parsed.field.default
            : parsed.field.default,
        },
        supported: parsed.supported,
      };
    }

    if (methodName === "describe") {
      const parsed = parseSchemaExpression(receiver, context);
      if (!parsed) return null;
      return {
        field: {
          ...parsed.field,
          description: unwrapped.arguments[0]
            ? expressionToStringLiteral(unwrapped.arguments[0]) ?? parsed.field.description
            : parsed.field.description,
        },
        supported: parsed.supported,
      };
    }

    if (
      [
        "min",
        "max",
        "length",
        "trim",
        "email",
        "url",
        "regex",
        "int",
        "gte",
        "lte",
        "positive",
        "nonnegative",
        "nonempty",
      ].includes(methodName)
    ) {
      return parseSchemaExpression(receiver, context);
    }
  }

  if (!ts.isCallExpression(unwrapped)) {
    context.errors.push(`${context.label}: unsupported schema expression kind`);
    return {
      field: { type: "string", required: false },
      supported: false,
    };
  }

  const calleePath = getExpressionPath(unwrapped.expression)?.join(".");
  switch (calleePath) {
    case "z.string":
    case "z.coerce.string":
      return {
        field: { type: "string", required: true },
        supported: true,
      };
    case "z.number":
    case "z.coerce.number":
      return {
        field: { type: "number", required: true },
        supported: true,
      };
    case "z.boolean":
    case "z.coerce.boolean":
      return {
        field: { type: "boolean", required: true },
        supported: true,
      };
    case "z.date":
    case "z.coerce.date":
      return {
        field: { type: "date", required: true },
        supported: true,
      };
    case "z.enum": {
      const options = unwrapped.arguments[0] ? parseEnumOptions(unwrapped.arguments[0]) : null;
      if (!options) {
        context.errors.push(`${context.label}: z.enum(...) requires a string-literal array`);
        return {
          field: { type: "enum", required: true, options: [] },
          supported: false,
        };
      }
      return {
        field: { type: "enum", required: true, options },
        supported: true,
      };
    }
    case "z.array": {
      const item = unwrapped.arguments[0]
        ? parseSchemaExpression(unwrapped.arguments[0], context)
        : null;
      if (!item) {
        context.errors.push(`${context.label}: z.array(...) requires an item schema`);
        return {
          field: { type: "list", required: true, item: { type: "string" } },
          supported: false,
        };
      }
      if (item.field.type === "asset") {
        return {
          field: {
            type: "assetList",
            required: true,
            accepts: item.field.accepts,
          },
          supported: item.supported,
        };
      }
      return {
        field: {
          type: "list",
          required: true,
          item: item.field,
        },
        supported: item.supported,
      };
    }
    case "z.object": {
      const arg = unwrapped.arguments[0];
      const shape = arg ? withTransparentWrappers(arg) : null;
      if (!shape || !ts.isObjectLiteralExpression(shape)) {
        context.errors.push(`${context.label}: z.object(...) requires an object literal shape`);
        return {
          field: { type: "object", required: true, fields: {} },
          supported: false,
        };
      }
      const fields: Record<string, CmsFieldDefinition> = {};
      let supported = true;
      for (const property of shape.properties) {
        if (!ts.isPropertyAssignment(property)) {
          supported = false;
          continue;
        }
        const propertyName =
          ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
            ? property.name.text
            : null;
        if (!propertyName) {
          supported = false;
          continue;
        }
        const parsed = parseSchemaExpression(property.initializer, {
          ...context,
          label: `${context.label}.${propertyName}`,
        });
        if (!parsed) {
          supported = false;
          continue;
        }
        fields[propertyName] = {
          ...parsed.field,
          label: parsed.field.label ?? titleizeKey(propertyName),
        };
        supported = supported && parsed.supported;
      }
      return {
        field: {
          type: "object",
          required: true,
          fields,
        },
        supported,
      };
    }
    case "reference": {
      return {
        field: { type: "reference", required: true },
        supported: true,
      };
    }
    default: {
      if (calleePath && context.imageHelpers.has(calleePath)) {
        return {
          field: {
            type: "asset",
            required: true,
            accepts: ["image/*"],
          },
          supported: true,
        };
      }
      context.errors.push(
        `${context.label}: unsupported schema helper ${calleePath ?? "<unknown>"}`,
      );
      return {
        field: { type: "string", required: false },
        supported: false,
      };
    }
  }
}

function inferSortField(fields: Record<string, CmsFieldDefinition>): string | null {
  for (const key of ["sortOrder", "order"]) {
    if (fields[key]?.type === "number") return key;
  }
  return null;
}

function inferPrimaryField(fields: Record<string, CmsFieldDefinition>): string | undefined {
  for (const key of Object.keys(fields)) {
    if (TITLE_FIELD_KEYS.has(key)) {
      return key;
    }
  }
  return undefined;
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

function collectAssetRefs(
  projectDir: string,
  entry: Pick<CmsEntryRecord, "key" | "filePath" | "relativePath" | "values">,
  modelKey: string,
  fields: Record<string, CmsFieldDefinition>,
): CmsAssetRecord[] {
  const assetRefs: CmsAssetRecord[] = [];

  function visitField(fieldKey: string, field: CmsFieldDefinition, value: unknown, pathPrefix = fieldKey) {
    if (field.type === "asset") {
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

    if (field.type === "assetList" && Array.isArray(value)) {
      value.forEach((item, index) => {
        visitField(pathPrefix, { type: "asset" }, item, `${pathPrefix}[${index}]`);
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

async function buildEntriesForCollection(
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
    const key = relativeToCollection.replace(/\.[^.]+$/, "");
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
      deletePath: relativePath,
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

async function parseCollections(
  projectDir: string,
  configPath: string,
  sourceFile: ts.SourceFile,
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
    });
  }

  const models: CmsModelRecord[] = [];
  for (const parsedModel of parsedModels) {
    const entries = await buildEntriesForCollection(projectDir, parsedModel);
    models.push({
      key: parsedModel.key,
      label: parsedModel.label,
      schemaPath: parsedModel.schemaPath,
      relativeSchemaPath: parsedModel.relativeSchemaPath,
      collectionRoot: parsedModel.collectionRoot,
      relativeCollectionRoot: parsedModel.relativeCollectionRoot,
      entryFormat: "file",
      sortField: parsedModel.sortField,
      display: inferPrimaryField(parsedModel.fields)
        ? { primaryField: inferPrimaryField(parsedModel.fields) }
        : undefined,
      fields: parsedModel.fields,
      entries,
    });
  }

  return models.sort((left, right) => left.key.localeCompare(right.key));
}

export async function inspectAstroCollectionsWorkspace(
  projectDir: string,
): Promise<CmsValidationReport | null> {
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

  const models = await parseCollections(projectDir, configPath, sourceFile, errors);
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
    defaultLocale: "en",
    locales: ["en"],
    modelCount: models.length,
    entryCount,
    assetCount,
    mediaFileCount: await countFilesRecursively(paths.mediaRoot),
    errors,
    models,
  };
}
