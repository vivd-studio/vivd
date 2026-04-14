import type {
  CmsValidationReport,
  CmsEntryRecord,
  CmsFieldDefinition,
  CmsModelRecord,
} from "@vivd/shared/cms";
import { stringify as stringifyYaml } from "yaml";

export type CmsFieldSegment = string | number;
export type CmsEntryFileFormat = "yaml" | "json" | "markdown" | "unsupported";
export type CmsAssetStorageKind = "content-media" | "public";

export type RichTextSidecarSpec = {
  pathKey: string;
  fieldPath: CmsFieldSegment[];
  locale: string | null;
  relativeValue: string;
  filePath: string;
};

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
const LOCALE_KEY_REGEX = /^[a-z]{2}(?:-[a-z0-9]+)*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeLocaleKey(value: string): boolean {
  return LOCALE_KEY_REGEX.test(value.trim());
}

export function titleizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
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

export function resolveAssetReferencePath(baseFilePath: string, rawPath: string): string {
  const normalized = normalizePosix(rawPath).trim();
  if (
    normalized.startsWith("public/") &&
    GENERIC_FILE_REFERENCE_EXTENSION_REGEX.test(normalized) &&
    !NON_LOCAL_ASSET_REFERENCE_REGEX.test(normalized)
  ) {
    return normalized.replace(/^\/+/, "");
  }

  if (
    normalized.startsWith("/") &&
    GENERIC_FILE_REFERENCE_EXTENSION_REGEX.test(normalized) &&
    !NON_LOCAL_ASSET_REFERENCE_REGEX.test(normalized)
  ) {
    return `public/${normalized.replace(/^\/+/, "")}`;
  }

  return resolveRelativePath(baseFilePath, rawPath);
}

export function buildStoredAssetReferencePath(
  baseFilePath: string,
  targetPath: string,
): string {
  const normalizedTarget = normalizePosix(targetPath).trim();
  if (!normalizedTarget) {
    return "";
  }

  if (normalizedTarget.startsWith("public/")) {
    const publicPath = normalizedTarget.slice("public/".length).replace(/^\/+/, "");
    return `/${publicPath}`;
  }

  if (
    normalizedTarget.startsWith("/") &&
    GENERIC_FILE_REFERENCE_EXTENSION_REGEX.test(normalizedTarget) &&
    !NON_LOCAL_ASSET_REFERENCE_REGEX.test(normalizedTarget)
  ) {
    return normalizedTarget;
  }

  return buildRelativeReferencePath(baseFilePath, normalizedTarget);
}

export function buildRelativeReferencePath(
  baseFilePath: string,
  targetPath: string,
): string {
  const baseSegments = dirnamePosix(baseFilePath).split("/").filter(Boolean);
  const targetSegments = normalizeRelativeSegments(targetPath);

  let sharedIndex = 0;
  while (
    sharedIndex < baseSegments.length &&
    sharedIndex < targetSegments.length &&
    baseSegments[sharedIndex] === targetSegments[sharedIndex]
  ) {
    sharedIndex += 1;
  }

  const relativeSegments = [
    ...baseSegments.slice(sharedIndex).map(() => ".."),
    ...targetSegments.slice(sharedIndex),
  ];

  if (relativeSegments.length === 0) {
    return ".";
  }

  return relativeSegments.join("/");
}

export function getCmsEntryFileFormat(filePath: string): CmsEntryFileFormat {
  const normalized = normalizePosix(filePath).toLowerCase();
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

export function isWritableCmsEntryFile(filePath: string): boolean {
  return getCmsEntryFileFormat(filePath) !== "unsupported";
}

export function serializeCmsEntryValues(
  filePath: string,
  value: unknown,
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

export function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  const normalizedCandidate = normalizePosix(candidatePath).replace(/^\/+/, "");
  const normalizedRoot = normalizePosix(rootPath).replace(/^\/+/, "").replace(/\/+$/, "");

  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
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

function collectLocalAssetReferences(value: unknown): string[] {
  const directValue = getAssetPathValue(value).trim();
  if (
    directValue.length > 0 &&
    !NON_LOCAL_ASSET_REFERENCE_REGEX.test(directValue) &&
    GENERIC_FILE_REFERENCE_EXTENSION_REGEX.test(directValue)
  ) {
    return [directValue];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectLocalAssetReferences(item));
  }

  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => collectLocalAssetReferences(item));
  }

  return [];
}

function normalizePublicAssetPath(assetPath: string): string | null {
  const normalized = normalizePosix(assetPath).trim();
  if (
    !normalized ||
    NON_LOCAL_ASSET_REFERENCE_REGEX.test(normalized) ||
    !GENERIC_FILE_REFERENCE_EXTENSION_REGEX.test(normalized)
  ) {
    return null;
  }

  if (normalized.startsWith("public/")) {
    return normalized.replace(/^\/+/, "");
  }

  if (normalized.startsWith("/")) {
    return `public/${normalized.replace(/^\/+/, "")}`;
  }

  return null;
}

export function inferAssetStorageFromValue(value: unknown): {
  storageKind: CmsAssetStorageKind;
  assetRootPath: string;
  defaultFolderPath: string;
} | null {
  const publicAssetPath = collectLocalAssetReferences(value)
    .map((assetPath) => normalizePublicAssetPath(assetPath))
    .find((assetPath): assetPath is string => Boolean(assetPath));

  if (!publicAssetPath) {
    return null;
  }

  const segments = publicAssetPath.split("/").filter(Boolean);
  const tailSegments = segments[0] === "public" ? segments.slice(1) : segments;
  const directorySegments = tailSegments.slice(0, -1);
  const assetRootPath =
    directorySegments.length > 0 ? `public/${directorySegments[0]}` : "public";
  const defaultFolderPath =
    directorySegments.length > 0 ? `public/${directorySegments.join("/")}` : assetRootPath;

  return {
    storageKind: "public",
    assetRootPath,
    defaultFolderPath,
  };
}

export function looksLikeLocalImageAssetReference(value: unknown): boolean {
  const assetPath = getAssetPathValue(value).trim();
  if (!assetPath || !IMAGE_REFERENCE_EXTENSION_REGEX.test(assetPath)) {
    return false;
  }
  return !NON_LOCAL_ASSET_REFERENCE_REGEX.test(assetPath);
}

function looksLikeLocalFileAssetReference(value: unknown): boolean {
  const assetPath = getAssetPathValue(value).trim();
  if (
    !assetPath ||
    !GENERIC_FILE_REFERENCE_EXTENSION_REGEX.test(assetPath) ||
    NON_LOCAL_ASSET_REFERENCE_REGEX.test(assetPath)
  ) {
    return false;
  }

  const normalized = normalizePosix(assetPath);
  return (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("src/content/media/") ||
    normalized.includes("/media/") ||
    normalized.includes("/")
  );
}

function addLocale(localeSet: Set<string>, value: string): void {
  const normalized = value.trim();
  if (!normalized || !looksLikeLocaleKey(normalized)) {
    return;
  }
  localeSet.add(normalized);
}

function orderLocales(locales: Iterable<string>, defaultLocale: string): string[] {
  const ordered = [...new Set([...locales].map((locale) => locale.trim()).filter(Boolean))];
  if (ordered.length === 0) {
    return defaultLocale.trim() ? [defaultLocale.trim()] : [];
  }

  const preferredDefault = defaultLocale.trim();
  if (preferredDefault && ordered.includes(preferredDefault)) {
    return [preferredDefault, ...ordered.filter((locale) => locale !== preferredDefault)];
  }

  return ordered;
}

function collectSchemaLocales(field: CmsFieldDefinition, localeSet: Set<string>): void {
  if (field.type === "object" && field.fields) {
    const fieldKeys = Object.keys(field.fields);
    if (fieldKeys.length > 0 && fieldKeys.every((key) => looksLikeLocaleKey(key))) {
      fieldKeys.forEach((key) => addLocale(localeSet, key));
      return;
    }

    Object.values(field.fields).forEach((nestedField) =>
      collectSchemaLocales(nestedField, localeSet),
    );
    return;
  }

  if (field.type === "list" && field.item) {
    collectSchemaLocales(field.item, localeSet);
  }
}

function collectValueLocales(
  field: CmsFieldDefinition,
  value: unknown,
  localeSet: Set<string>,
): void {
  if (field.localized && isRecord(value)) {
    Object.keys(value).forEach((key) => addLocale(localeSet, key));
  }

  if (field.type === "object" && field.fields && isRecord(value)) {
    const fieldKeys = Object.keys(field.fields);
    if (fieldKeys.length > 0 && fieldKeys.every((key) => looksLikeLocaleKey(key))) {
      fieldKeys.forEach((key) => addLocale(localeSet, key));
      Object.keys(value).forEach((key) => addLocale(localeSet, key));
      return;
    }

    for (const [nestedKey, nestedField] of Object.entries(field.fields)) {
      collectValueLocales(nestedField, value[nestedKey], localeSet);
    }
    return;
  }

  if (field.type === "list" && field.item && Array.isArray(value)) {
    value.forEach((item) => collectValueLocales(field.item as CmsFieldDefinition, item, localeSet));
  }
}

export function getLocalizedFieldLocales(
  locales: string[],
  defaultLocale: string,
  value: unknown,
): string[] {
  const localeSet = new Set<string>();
  locales.forEach((locale) => addLocale(localeSet, locale));
  if (isRecord(value)) {
    Object.keys(value).forEach((key) => addLocale(localeSet, key));
  }
  return orderLocales(localeSet, defaultLocale);
}

export function deriveCmsLocales(
  report: Pick<CmsValidationReport, "locales" | "models"> | null | undefined,
  defaultLocale: string,
): string[] {
  const localeSet = new Set<string>();
  for (const locale of report?.locales ?? []) {
    addLocale(localeSet, locale);
  }

  for (const model of report?.models ?? []) {
    for (const [fieldKey, field] of Object.entries(model.fields)) {
      collectSchemaLocales(field, localeSet);
      for (const entry of model.entries) {
        collectValueLocales(field, entry.values[fieldKey], localeSet);
      }
    }
  }

  return orderLocales(localeSet, defaultLocale);
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

function fieldAcceptsImages(field: CmsFieldDefinition): boolean {
  return (field.accepts ?? []).some((accept) => accept.startsWith("image/"));
}

function inferAssetAcceptsFromPath(assetPath: string): string[] | null {
  const normalized = normalizePosix(assetPath).trim();
  if (looksLikeLocalImageAssetReference(normalized)) {
    return ["image/*"];
  }

  if (!looksLikeLocalFileAssetReference(normalized)) {
    return null;
  }

  const extension = normalized.replace(/[?#].*$/, "").match(/(\.[a-z0-9]{1,8})$/i)?.[1];
  if (!extension) {
    return null;
  }

  if (extension.toLowerCase() === ".pdf") {
    return [".pdf", "application/pdf"];
  }

  return [extension.toLowerCase()];
}

export function inferAssetAcceptsForValues(values: unknown[]): string[] | null {
  const nonEmptyPaths = values
    .map((value) => getAssetPathValue(value).trim())
    .filter((value) => value.length > 0);

  if (nonEmptyPaths.length === 0) {
    return null;
  }

  const inferredAccepts = nonEmptyPaths.map((value) => inferAssetAcceptsFromPath(value));
  if (inferredAccepts.some((accepts) => !accepts)) {
    return null;
  }

  return [...new Set(inferredAccepts.flatMap((accepts) => accepts ?? []))];
}

export function inferStringFieldAssetAccepts(
  fieldKey: string,
  field: CmsFieldDefinition,
  value: unknown,
): string[] | null {
  if (field.type !== "string") {
    return null;
  }

  if ((field.accepts ?? []).length > 0) {
    return field.accepts ?? null;
  }

  const assetPath = getAssetPathValue(value).trim();
  if (assetPath.length > 0) {
    return inferAssetAcceptsFromPath(assetPath);
  }

  return looksLikeImageFieldName(fieldKey) ? ["image/*"] : null;
}

export function inferStringListFieldAssetAccepts(
  fieldKey: string,
  field: CmsFieldDefinition,
  value: unknown,
): string[] | null {
  if (field.type !== "list" || field.item?.type !== "string") {
    return null;
  }

  const explicitAccepts = [...new Set([...(field.accepts ?? []), ...(field.item.accepts ?? [])])];
  if (explicitAccepts.length > 0) {
    return explicitAccepts;
  }

  const items = Array.isArray(value) ? value : [];
  const inferredAccepts = inferAssetAcceptsForValues(items);
  if (inferredAccepts?.length) {
    return inferredAccepts;
  }

  return looksLikeImageListFieldName(fieldKey) ? ["image/*"] : null;
}

export function shouldRenderImageAssetField(
  fieldKey: string,
  field: CmsFieldDefinition,
  value: unknown,
): boolean {
  if (field.type !== "string") {
    return false;
  }

  if (fieldAcceptsImages(field)) {
    return true;
  }

  const assetPath = getAssetPathValue(value).trim();
  if (assetPath.length > 0) {
    return looksLikeLocalImageAssetReference(assetPath);
  }

  return looksLikeImageFieldName(fieldKey);
}

export function shouldRenderImageAssetListField(
  fieldKey: string,
  field: CmsFieldDefinition,
  value: unknown,
): boolean {
  if (field.type !== "list" || field.item?.type !== "string") {
    return false;
  }

  if (fieldAcceptsImages(field) || fieldAcceptsImages(field.item)) {
    return true;
  }

  const items = Array.isArray(value) ? value : [];
  const nonEmptyPaths = items
    .map((item) => getAssetPathValue(item).trim())
    .filter((item) => item.length > 0);

  if (nonEmptyPaths.length > 0) {
    return nonEmptyPaths.every((item) => looksLikeLocalImageAssetReference(item));
  }

  return looksLikeImageListFieldName(fieldKey);
}

export function buildDefaultFieldValue(
  fieldKey: string,
  field: CmsFieldDefinition,
  defaultLocale: string,
  locales: string[] = [defaultLocale],
): unknown {
  if (field.localized) {
    const localizedLocales = orderLocales(
      locales.filter((locale) => looksLikeLocaleKey(locale)),
      defaultLocale,
    );
    const effectiveLocales = localizedLocales.length ? localizedLocales : [defaultLocale];

    if (field.type === "richText" && field.storage === "sidecar-markdown") {
      return Object.fromEntries(
        effectiveLocales.map((locale) => [
          locale,
          buildRichTextReference([fieldKey], locale),
        ]),
      );
    }
    return Object.fromEntries(effectiveLocales.map((locale) => [locale, ""]));
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
          locales,
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
