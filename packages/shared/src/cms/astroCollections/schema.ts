import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { CmsFieldDefinition } from "../index.js";
import {
  IMAGE_FIELD_TOKENS,
  IMAGE_LIST_FIELD_TOKENS,
  IMAGE_REFERENCE_EXTENSION_REGEX,
  GENERIC_FILE_REFERENCE_EXTENSION_REGEX,
  NON_LOCAL_ASSET_REFERENCE_REGEX,
  LOCALIZABLE_ASTRO_FIELD_TYPES,
  findAstroConfigPath,
  getAstroSchemaLocales,
  normalizeLocaleCode,
  titleizeKey,
  isRecord,
} from "./shared.js";
import type {
  AstroI18nConfig,
  ParsedFieldResult,
  SchemaParseContext,
} from "./shared.js";

export function withTransparentWrappers(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) {
    return withTransparentWrappers(expression.expression);
  }
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return withTransparentWrappers(expression.expression);
  }
  return expression;
}

export function getExpressionPath(expression: ts.Expression): string[] | null {
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

export function getObjectPropertyValue(
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

export function findExportedCollectionsObject(
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

export function expressionToStringLiteral(expression: ts.Expression): string | null {
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

export function applyAstroFieldHintsToFields(
  fields: Record<string, CmsFieldDefinition>,
  entries: Array<{ values: Record<string, unknown> }>,
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

export async function inspectAstroProjectLocales(projectDir: string): Promise<AstroI18nConfig> {
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

export function resolveCollectionRoot(
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
  const baseExpression = getObjectPropertyValue(loaderObject, "base");
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

export function parseSchemaObject(
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

export function inferSortField(fields: Record<string, CmsFieldDefinition>): string | null {
  for (const key of ["sortOrder", "order"]) {
    if (fields[key]?.type === "number") return key;
  }
  return null;
}

export function inferPrimaryField(
  fields: Record<string, CmsFieldDefinition>,
): string | undefined {
  for (const key of Object.keys(fields)) {
    if (new Set(["title", "name", "label"]).has(key)) {
      return key;
    }
  }
  return undefined;
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

export function usesReferenceHelperInField(field: CmsFieldDefinition): boolean {
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

export function buildAstroSchemaExpression(
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

export function getLineIndent(source: string, position: number): string {
  const lineStart = source.lastIndexOf("\n", Math.max(position - 1, 0)) + 1;
  return source.slice(lineStart, position).match(/^\s*/)?.[0] ?? "";
}

export function ensureAstroContentImports(
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
