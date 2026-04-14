import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  CmsCreateEntryResult,
  CmsAssetRecord,
  CmsEntryRecord,
  CmsFieldDefinition,
  CmsModelRecord,
  CmsSourceKind,
  CmsPaths,
  CmsScaffoldResult,
  CmsUpdateModelResult,
} from "./index.js";

type AstroCollectionsValidationReport = {
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
};

const ASTRO_CONTENT_CONFIG_CANDIDATES = [
  path.join("src", "content.config.ts"),
  path.join("src", "content.config.mts"),
  path.join("src", "content.config.js"),
  path.join("src", "content.config.mjs"),
];
const ASTRO_CONFIG_CANDIDATES = [
  "astro.config.ts",
  "astro.config.mts",
  "astro.config.js",
  "astro.config.mjs",
  "astro.config.cjs",
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
const IMAGE_FIELD_TOKENS = new Set([
  "image",
  "img",
  "photo",
  "picture",
  "thumbnail",
  "thumb",
  "logo",
  "avatar",
  "poster",
  "icon",
]);
const IMAGE_LIST_FIELD_TOKENS = new Set([
  "images",
  "photos",
  "pictures",
  "thumbnails",
  "gallery",
  "logos",
  "avatars",
  "posters",
  "icons",
]);
const IMAGE_REFERENCE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const GENERIC_FILE_REFERENCE_EXTENSION_REGEX = /\.[a-z0-9]{1,8}(?:[?#].*)?$/i;
const NON_LOCAL_ASSET_REFERENCE_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

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
  entryExtensionHint: string | null;
  directoryIndexEntries: boolean;
};

type SchemaParseContext = {
  imageHelpers: Set<string>;
  errors: string[];
  label: string;
  defaultLocale: string | null;
  locales: string[];
};

type AstroI18nConfig = {
  defaultLocale: string | null;
  locales: string[];
};

const LOCALIZABLE_ASTRO_FIELD_TYPES = new Set<CmsFieldDefinition["type"]>([
  "string",
  "text",
  "richText",
]);

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

function normalizeLocaleCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function getAstroSchemaLocales(localeConfig: AstroI18nConfig): string[] {
  const normalized = [
    normalizeLocaleCode(localeConfig.defaultLocale),
    ...localeConfig.locales.map((locale) => normalizeLocaleCode(locale)),
  ].filter((locale): locale is string => Boolean(locale));

  return normalized.length ? [...new Set(normalized)] : ["en"];
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

async function findAstroConfigPath(projectDir: string): Promise<string | null> {
  for (const relativePath of ASTRO_CONFIG_CANDIDATES) {
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

function inferEntryPatternHints(pattern: string | null): {
  entryExtensionHint: string | null;
  directoryIndexEntries: boolean;
} {
  if (!pattern) {
    return {
      entryExtensionHint: null,
      directoryIndexEntries: false,
    };
  }

  const normalized = pattern.trim().toLowerCase();
  const directoryIndexEntries = /(^|\/)index\.[^/]+$/.test(normalized);

  for (const extension of [".mdx", ".md", ".markdown", ".yaml", ".yml", ".json"]) {
    if (normalized.includes(extension)) {
      return {
        entryExtensionHint: extension,
        directoryIndexEntries,
      };
    }
  }

  return {
    entryExtensionHint: null,
    directoryIndexEntries,
  };
}

function getFieldNameTokens(fieldKey: string): string[] {
  return fieldKey
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .flatMap((segment) => segment.split(/\s+/))
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

function looksLikeImageFieldName(fieldKey: string): boolean {
  const tokens = getFieldNameTokens(fieldKey);
  if (tokens.some((token) => IMAGE_FIELD_TOKENS.has(token))) {
    return true;
  }
  const normalized = tokens.join("");
  return normalized.endsWith("image");
}

function looksLikeImageListFieldName(fieldKey: string): boolean {
  const tokens = getFieldNameTokens(fieldKey);
  if (tokens.some((token) => IMAGE_LIST_FIELD_TOKENS.has(token))) {
    return true;
  }
  const normalized = tokens.join("");
  return normalized.endsWith("images") || normalized.endsWith("gallery");
}

function looksLikeManagedImageReference(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !IMAGE_REFERENCE_EXTENSION_REGEX.test(trimmed)) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  return (
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("src/content/media/") ||
    normalized.includes("/media/")
  );
}

function looksLikeManagedFileReference(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !GENERIC_FILE_REFERENCE_EXTENSION_REGEX.test(trimmed)) {
    return false;
  }

  if (NON_LOCAL_ASSET_REFERENCE_REGEX.test(trimmed)) {
    return false;
  }

  const normalized = trimmed.toLowerCase();
  return (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("src/content/media/") ||
    normalized.includes("/media/") ||
    normalized.includes("/")
  );
}

function collectNonEmptyStringValues(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function fieldAcceptsImages(field: CmsFieldDefinition): boolean {
  return (field.accepts ?? []).some((accept) => accept.startsWith("image/"));
}

function withAssetAccepts(
  field: CmsFieldDefinition,
  accepts: string[],
): CmsFieldDefinition {
  const nextAccepts = [...new Set([...(field.accepts ?? []), ...accepts])];
  if (nextAccepts.length === (field.accepts ?? []).length) {
    return field;
  }
  return {
    ...field,
    accepts: nextAccepts,
  };
}

function inferAssetAcceptsFromReference(value: string): string[] | null {
  if (looksLikeManagedImageReference(value)) {
    return ["image/*"];
  }

  if (!looksLikeManagedFileReference(value)) {
    return null;
  }

  const extension = path.posix.extname(value.replace(/[?#].*$/, "")).toLowerCase();
  if (!extension) {
    return null;
  }

  if (extension === ".pdf") {
    return [".pdf", "application/pdf"];
  }

  return [extension];
}

function inferAssetAcceptsFromStringValues(values: string[]): string[] | null {
  const inferredAccepts = values.map((value) => inferAssetAcceptsFromReference(value));
  if (inferredAccepts.length === 0 || inferredAccepts.some((accepts) => !accepts)) {
    return null;
  }

  return [...new Set(inferredAccepts.flatMap((accepts) => accepts ?? []))];
}

function inferStringFieldAssetAccepts(fieldKey: string, values: unknown[]): string[] | null {
  const nonEmptyValues = collectNonEmptyStringValues(values);
  const inferredAccepts = inferAssetAcceptsFromStringValues(nonEmptyValues);
  if (inferredAccepts?.length) {
    return inferredAccepts;
  }

  if (looksLikeImageFieldName(fieldKey) && nonEmptyValues.length === 0) {
    return ["image/*"];
  }

  return null;
}

function inferStringListFieldAssetAccepts(
  fieldKey: string,
  values: unknown[],
): string[] | null {
  const flattenedItems = values.flatMap((value) => (Array.isArray(value) ? value : []));
  const nonEmptyValues = collectNonEmptyStringValues(flattenedItems);
  const inferredAccepts = inferAssetAcceptsFromStringValues(nonEmptyValues);
  if (inferredAccepts?.length) {
    return inferredAccepts;
  }

  if (looksLikeImageListFieldName(fieldKey) && nonEmptyValues.length === 0) {
    return ["image/*"];
  }

  return null;
}

function isLikelyLocaleKey(value: string): boolean {
  return /^[a-z]{2}(?:-[a-z0-9]+)*$/i.test(value.trim());
}

function inferLocalizedAssetFieldFromObject(
  field: CmsFieldDefinition,
  nestedFields: Record<string, CmsFieldDefinition>,
  values: unknown[],
): CmsFieldDefinition | null {
  const nestedEntries = Object.entries(nestedFields);
  if (
    nestedEntries.length === 0 ||
    !nestedEntries.every(
      ([nestedKey, nestedField]) =>
        isLikelyLocaleKey(nestedKey) && nestedField.type === "string",
    )
  ) {
    return null;
  }

  const localizedValues = values.flatMap((value) =>
    isRecord(value) ? Object.values(value) : [],
  );
  const inferredAccepts = inferAssetAcceptsFromStringValues(
    collectNonEmptyStringValues(localizedValues),
  );
  if (!inferredAccepts?.length) {
    return null;
  }

  return {
    type: "string",
    label: field.label,
    description: field.description,
    required: field.required,
    localized: true,
    accepts: inferredAccepts,
  };
}

function applyAstroFieldHints(
  fieldKey: string,
  field: CmsFieldDefinition,
  values: unknown[],
): CmsFieldDefinition {
  if (field.type === "string") {
    const inferredAccepts = inferStringFieldAssetAccepts(fieldKey, values);
    if (inferredAccepts?.length) {
      return withAssetAccepts(field, inferredAccepts);
    }
  }

  if (field.type === "list" && field.item?.type === "string") {
    const inferredAccepts = inferStringListFieldAssetAccepts(fieldKey, values);
    if (inferredAccepts?.length) {
      return {
        ...field,
        accepts: [...new Set([...(field.accepts ?? []), ...inferredAccepts])],
        item: withAssetAccepts(field.item, inferredAccepts),
      };
    }
  }

  if (field.type === "object" && field.fields) {
    const nextFields: Record<string, CmsFieldDefinition> = {};
    for (const [nestedKey, nestedField] of Object.entries(field.fields)) {
      const nestedValues = values.map((value) =>
        isRecord(value) ? value[nestedKey] : undefined,
      );
      nextFields[nestedKey] = applyAstroFieldHints(
        nestedKey,
        nestedField,
        nestedValues,
      );
    }
    const localizedAssetField = inferLocalizedAssetFieldFromObject(
      field,
      nextFields,
      values,
    );
    if (localizedAssetField) {
      return localizedAssetField;
    }
    return {
      ...field,
      fields: nextFields,
    };
  }

  if (field.type === "list" && field.item) {
    const flattenedValues = values.flatMap((value) => (Array.isArray(value) ? value : []));
    return {
      ...field,
      item: applyAstroFieldHints(fieldKey, field.item, flattenedValues),
    };
  }

  return field;
}

function applyAstroFieldHintsToFields(
  fields: Record<string, CmsFieldDefinition>,
  entries: CmsEntryRecord[],
): Record<string, CmsFieldDefinition> {
  const nextFields: Record<string, CmsFieldDefinition> = {};
  for (const [fieldKey, field] of Object.entries(fields)) {
    nextFields[fieldKey] = applyAstroFieldHints(
      fieldKey,
      field,
      entries.map((entry) => entry.values[fieldKey]),
    );
  }
  return nextFields;
}

function resolveExpressionFromDeclarations(
  expression: ts.Expression,
  declarations: Map<string, ts.Expression>,
): ts.Expression {
  const unwrapped = withTransparentWrappers(expression);
  if (ts.isIdentifier(unwrapped)) {
    return declarations.get(unwrapped.text) ?? unwrapped;
  }
  return unwrapped;
}

function parseStringArrayLiteral(expression: ts.Expression): string[] | null {
  const unwrapped = withTransparentWrappers(expression);
  if (!ts.isArrayLiteralExpression(unwrapped)) {
    return null;
  }
  const values: string[] = [];
  for (const element of unwrapped.elements) {
    const stringValue = expressionToStringLiteral(element);
    if (!stringValue) {
      return null;
    }
    values.push(stringValue);
  }
  return values;
}

function parseAstroLocales(expression: ts.Expression): string[] | null {
  const unwrapped = withTransparentWrappers(expression);
  if (!ts.isArrayLiteralExpression(unwrapped)) {
    return null;
  }

  const locales: string[] = [];
  for (const element of unwrapped.elements) {
    const stringValue = expressionToStringLiteral(element);
    if (stringValue) {
      locales.push(stringValue);
      continue;
    }

    if (!ts.isObjectLiteralExpression(withTransparentWrappers(element))) {
      return null;
    }

    const localeObject = withTransparentWrappers(element) as ts.ObjectLiteralExpression;
    const codesExpression = getObjectPropertyValue(localeObject, "codes");
    const codeExpression = getObjectPropertyValue(localeObject, "code");
    const pathExpression = getObjectPropertyValue(localeObject, "path");

    const codes = codesExpression ? parseStringArrayLiteral(codesExpression) : null;
    const singleCode = codeExpression ? expressionToStringLiteral(codeExpression) : null;
    const fallbackPath = pathExpression ? expressionToStringLiteral(pathExpression) : null;

    if (codes?.length) {
      locales.push(...codes);
      continue;
    }
    if (singleCode) {
      locales.push(singleCode);
      continue;
    }
    if (fallbackPath) {
      locales.push(fallbackPath);
      continue;
    }
    return null;
  }

  return locales;
}

async function inspectAstroProjectLocales(projectDir: string): Promise<AstroI18nConfig> {
  const configPath = await findAstroConfigPath(projectDir);
  if (!configPath) {
    return {
      defaultLocale: null,
      locales: [],
    };
  }

  const source = await fs.readFile(configPath, "utf8");
  const sourceFile = ts.createSourceFile(
    configPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    configPath.endsWith(".js") || configPath.endsWith(".mjs") || configPath.endsWith(".cjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS,
  );

  const declarations = new Map<string, ts.Expression>();
  let exportExpression: ts.Expression | null = null;

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        declarations.set(declaration.name.text, declaration.initializer);
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      exportExpression = statement.expression;
    }
  }

  if (!exportExpression) {
    return {
      defaultLocale: null,
      locales: [],
    };
  }

  const resolvedExport = resolveExpressionFromDeclarations(exportExpression, declarations);
  const configExpression =
    ts.isCallExpression(resolvedExport) && resolvedExport.arguments[0]
      ? resolveExpressionFromDeclarations(resolvedExport.arguments[0], declarations)
      : resolvedExport;
  if (!ts.isObjectLiteralExpression(withTransparentWrappers(configExpression))) {
    return {
      defaultLocale: null,
      locales: [],
    };
  }

  const configObject = withTransparentWrappers(configExpression) as ts.ObjectLiteralExpression;
  const i18nExpression = getObjectPropertyValue(configObject, "i18n");
  if (!i18nExpression || !ts.isObjectLiteralExpression(withTransparentWrappers(i18nExpression))) {
    return {
      defaultLocale: null,
      locales: [],
    };
  }

  const i18nObject = withTransparentWrappers(i18nExpression) as ts.ObjectLiteralExpression;
  const defaultLocaleExpression = getObjectPropertyValue(i18nObject, "defaultLocale");
  const localesExpression = getObjectPropertyValue(i18nObject, "locales");
  const defaultLocale = defaultLocaleExpression
    ? expressionToStringLiteral(defaultLocaleExpression)
    : null;
  const locales = localesExpression ? parseAstroLocales(localesExpression) ?? [] : [];
  const normalizedLocales = [...new Set(locales.filter((locale) => locale.trim().length > 0))];

  if (defaultLocale && !normalizedLocales.includes(defaultLocale)) {
    normalizedLocales.unshift(defaultLocale);
  }

  return {
    defaultLocale: defaultLocale ?? normalizedLocales[0] ?? null,
    locales: normalizedLocales,
  };
}

function resolveCollectionRoot(
  projectDir: string,
  configPath: string,
  collectionKey: string,
  collectionConfig: ts.ObjectLiteralExpression,
): {
  root: string;
  supportedEntries: boolean;
  error: string | null;
  entryExtensionHint: string | null;
  directoryIndexEntries: boolean;
} {
  const loaderExpression = getObjectPropertyValue(collectionConfig, "loader");
  if (!loaderExpression) {
    const root = path.join(projectDir, "src", "content", collectionKey);
    return {
      root,
      supportedEntries: true,
      error: null,
      entryExtensionHint: null,
      directoryIndexEntries: false,
    };
  }

  const unwrapped = withTransparentWrappers(loaderExpression);
  if (!ts.isCallExpression(unwrapped)) {
    return {
      root: path.join(projectDir, "src", "content", collectionKey),
      supportedEntries: false,
      error: "unsupported non-call loader",
      entryExtensionHint: null,
      directoryIndexEntries: false,
    };
  }

  const loaderPath = getExpressionPath(unwrapped.expression)?.join(".");
  if (loaderPath !== "glob") {
    return {
      root: path.join(projectDir, "src", "content", collectionKey),
      supportedEntries: false,
      error: `unsupported loader ${loaderPath ?? "<unknown>"}`,
      entryExtensionHint: null,
      directoryIndexEntries: false,
    };
  }

  const loaderArg = unwrapped.arguments[0];
  if (!loaderArg || !ts.isObjectLiteralExpression(withTransparentWrappers(loaderArg))) {
    return {
      root: path.join(projectDir, "src", "content", collectionKey),
      supportedEntries: false,
      error: "glob loader missing object configuration",
      entryExtensionHint: null,
      directoryIndexEntries: false,
    };
  }

  const loaderObject = withTransparentWrappers(loaderArg) as ts.ObjectLiteralExpression;

  const baseExpression = getObjectPropertyValue(
    loaderObject,
    "base",
  );
  const baseValue = baseExpression ? expressionToStringLiteral(baseExpression) : null;
  if (!baseValue) {
    return {
      root: path.join(projectDir, "src", "content", collectionKey),
      supportedEntries: false,
      error: "glob loader base must be a string literal",
      entryExtensionHint: null,
      directoryIndexEntries: false,
    };
  }
  const patternExpression = getObjectPropertyValue(loaderObject, "pattern");
  const patternValue = patternExpression ? expressionToStringLiteral(patternExpression) : null;
  const patternHints = inferEntryPatternHints(patternValue);

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
    entryExtensionHint: patternHints.entryExtensionHint,
    directoryIndexEntries: patternHints.directoryIndexEntries,
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

function inferLocalizedFieldFromObject(
  entries: Array<{ key: string; parsed: ParsedFieldResult }>,
  context: SchemaParseContext,
): ParsedFieldResult | null {
  if (!entries.length || !context.locales.length) {
    return null;
  }

  const localeSet = new Set(context.locales);
  if (!entries.every(({ key }) => localeSet.has(key))) {
    return null;
  }

  const firstType = entries[0]?.parsed.field.type;
  if (!firstType || !LOCALIZABLE_ASTRO_FIELD_TYPES.has(firstType)) {
    return null;
  }

  if (
    !entries.every(
      ({ parsed }) =>
        parsed.field.type === firstType &&
        LOCALIZABLE_ASTRO_FIELD_TYPES.has(parsed.field.type),
    )
  ) {
    return null;
  }

  const preferredLocale =
    (context.defaultLocale && localeSet.has(context.defaultLocale)
      ? context.defaultLocale
      : entries[0]?.key) ?? null;
  const preferredEntry =
    entries.find(({ key }) => key === preferredLocale) ?? entries[0] ?? null;
  if (!preferredEntry) {
    return null;
  }

  return {
    field: {
      ...preferredEntry.parsed.field,
      localized: true,
    },
    supported: entries.every(({ parsed }) => parsed.supported),
  };
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
    if (!(ts.isIdentifier(receiver) && receiver.text === "z") && methodName === "array") {
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
      const localizedEntries: Array<{ key: string; parsed: ParsedFieldResult }> = [];
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
        localizedEntries.push({ key: propertyName, parsed });
        fields[propertyName] = {
          ...parsed.field,
          label: parsed.field.label ?? titleizeKey(propertyName),
        };
        supported = supported && parsed.supported;
      }
      const localizedField = inferLocalizedFieldFromObject(localizedEntries, context);
      if (localizedField) {
        return localizedField;
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
      const referenceModelKey = unwrapped.arguments[0]
        ? expressionToStringLiteral(unwrapped.arguments[0]) ?? undefined
        : undefined;
      return {
        field: {
          type: "reference",
          required: true,
          referenceModelKey,
        },
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

function normalizeEntryKey(entryKey: string): string {
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

function buildDefaultAstroFieldValue(
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
    case "reference":
      return "";
    default:
      return field.default ?? null;
  }
}

function serializeAstroEntryValues(
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

function inferEntryLayoutFromModel(model: CmsModelRecord): {
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

function renderObjectKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function usesImageHelperInField(field: CmsFieldDefinition): boolean {
  if (field.type === "asset" || field.type === "assetList") {
    return true;
  }
  if (field.type === "object") {
    return Object.values(field.fields ?? {}).some(usesImageHelperInField);
  }
  if (field.type === "list" && field.item) {
    return usesImageHelperInField(field.item);
  }
  return false;
}

function usesReferenceHelperInField(field: CmsFieldDefinition): boolean {
  if (field.type === "reference") {
    return true;
  }
  if (field.type === "object") {
    return Object.values(field.fields ?? {}).some(usesReferenceHelperInField);
  }
  if (field.type === "list" && field.item) {
    return usesReferenceHelperInField(field.item);
  }
  return false;
}

function serializeDefaultValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new Error("Unsupported default value in Astro model editor");
  }
  return serialized;
}

function buildAstroObjectExpression(
  fields: Record<string, CmsFieldDefinition>,
  propertyIndent: string,
  localeConfig: AstroI18nConfig,
): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    return "z.object({})";
  }

  const innerIndent = `${propertyIndent}  `;
  return `z.object({\n${entries
    .map(
      ([fieldKey, field]) =>
        `${innerIndent}${renderObjectKey(fieldKey)}: ${buildAstroFieldExpression(field, innerIndent, localeConfig)},`,
    )
    .join("\n")}\n${propertyIndent}})`;
}

function buildAstroFieldExpression(
  field: CmsFieldDefinition,
  propertyIndent: string,
  localeConfig: AstroI18nConfig,
): string {
  let expression = "";

  if (field.localized) {
    const locales = getAstroSchemaLocales(localeConfig);
    const defaultLocale =
      normalizeLocaleCode(localeConfig.defaultLocale) ?? locales[0] ?? "en";
    const localeIndent = `${propertyIndent}  `;
    const localizedField: CmsFieldDefinition = {
      ...field,
      localized: undefined,
      description: undefined,
      default: undefined,
    };

    expression = `z.object({\n${locales
      .map((locale) => {
        const localeField: CmsFieldDefinition = {
          ...localizedField,
          required: locale === defaultLocale ? field.required : false,
        };
        return `${localeIndent}${renderObjectKey(locale)}: ${buildAstroFieldExpression(localeField, localeIndent, localeConfig)},`;
      })
      .join("\n")}\n${propertyIndent}})`;
  } else {
    switch (field.type) {
      case "slug":
      case "string":
      case "text":
      case "richText":
        expression = "z.string()";
        break;
      case "date":
      case "datetime":
        expression = "z.coerce.date()";
        break;
      case "number":
        expression = "z.number()";
        break;
      case "boolean":
        expression = "z.boolean()";
        break;
      case "enum":
        expression = `z.enum([${(field.options ?? []).map((option) => JSON.stringify(option)).join(", ")}])`;
        break;
      case "asset":
        expression = "image()";
        break;
      case "assetList":
        expression = "z.array(image())";
        break;
      case "reference":
        if (!field.referenceModelKey?.trim()) {
          throw new Error("Reference fields require a target collection");
        }
        expression = `reference(${JSON.stringify(field.referenceModelKey.trim())})`;
        break;
      case "object":
        expression = buildAstroObjectExpression(field.fields ?? {}, propertyIndent, localeConfig);
        break;
      case "list":
        expression = `z.array(${buildAstroFieldExpression(field.item ?? { type: "string" }, propertyIndent, localeConfig)})`;
        break;
      default:
        expression = "z.string()";
        break;
    }
  }

  if (field.description?.trim()) {
    expression += `.describe(${JSON.stringify(field.description.trim())})`;
  }
  if (typeof field.default !== "undefined") {
    expression += `.default(${serializeDefaultValue(field.default)})`;
  } else if (field.required === false) {
    expression += ".optional()";
  }

  return expression;
}

function buildAstroSchemaExpression(
  fields: Record<string, CmsFieldDefinition>,
  propertyIndent: string,
  localeConfig: AstroI18nConfig,
): string {
  const objectExpression = buildAstroObjectExpression(fields, propertyIndent, localeConfig);
  if (Object.values(fields).some(usesImageHelperInField)) {
    return `({ image }) => ${objectExpression}`;
  }
  return objectExpression;
}

function getLineIndent(source: string, position: number): string {
  const lineStart = source.lastIndexOf("\n", Math.max(position - 1, 0)) + 1;
  return source.slice(lineStart, position).match(/^\s*/)?.[0] ?? "";
}

function ensureAstroContentImports(
  source: string,
  requiredImports: Set<string>,
): string {
  if (requiredImports.size === 0) {
    return source;
  }

  const sourceFile = ts.createSourceFile(
    "content.config.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let astroImport: ts.ImportDeclaration | null = null;
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "astro:content"
    ) {
      astroImport = statement;
      break;
    }
  }

  const orderedImports = [...requiredImports].sort((left, right) =>
    left.localeCompare(right),
  );

  if (!astroImport) {
    return `import { ${orderedImports.join(", ")} } from "astro:content";\n${source}`;
  }

  const existingImports = new Set<string>();
  const namedBindings = astroImport.importClause?.namedBindings;
  if (namedBindings && ts.isNamedImports(namedBindings)) {
    for (const element of namedBindings.elements) {
      existingImports.add(element.name.text);
    }
  }

  const mergedImports = [...new Set([...existingImports, ...orderedImports])].sort((left, right) =>
    left.localeCompare(right),
  );
  const replacement = `import { ${mergedImports.join(", ")} } from "astro:content";`;

  return `${source.slice(0, astroImport.getStart(sourceFile))}${replacement}${source.slice(astroImport.getEnd())}`;
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

function buildAstroCollectionProperty(
  modelKey: string,
  fields: Record<string, CmsFieldDefinition>,
  propertyIndent: string,
  localeConfig: AstroI18nConfig,
): string {
  const schemaIndent = `${propertyIndent}  `;
  return `${propertyIndent}${renderObjectKey(modelKey)}: defineCollection({\n${schemaIndent}schema: ${buildAstroSchemaExpression(fields, schemaIndent, localeConfig)},\n${propertyIndent}}),`;
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
  localeConfig: AstroI18nConfig,
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
