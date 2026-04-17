import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export const CMS_VERSION = 1;
export const CMS_TOOLKIT_VERSION = 1;
export const CMS_CONTENT_ROOT = path.join("src", "content");

export const SUPPORTED_FIELD_TYPES = new Set([
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

export const LOCALIZED_FIELD_TYPES = new Set(["string", "text", "richText"]);
export const TITLE_FIELD_KEYS = new Set(["title", "name", "label"]);

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
  toolkit: CmsToolkitStatusReport;
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

export type CmsToolkitFileKey = "cmsBindings" | "cmsText" | "cmsImage";
export type CmsToolkitFileStatus = "current" | "stale" | "missing" | "custom";

export interface CmsToolkitFileReport {
  key: CmsToolkitFileKey;
  relativePath: string;
  status: CmsToolkitFileStatus;
  expectedVersion: number;
  currentVersion: number | null;
}

export interface CmsToolkitStatusReport {
  status: CmsToolkitFileStatus;
  expectedVersion: number;
  needsInstall: boolean;
  files: CmsToolkitFileReport[];
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

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

export function titleizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readYamlObject(
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

export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensurePlaceholderFile(filePath: string): Promise<boolean> {
  if (await pathExists(filePath)) return false;
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, "", "utf8");
  return true;
}

export function defaultRootConfig(): CmsRootConfig {
  return {
    version: CMS_VERSION,
    defaultLocale: "en",
    locales: ["en"],
    models: [],
  };
}

export function getDefaultAstroCmsPaths(projectDir: string): CmsPaths {
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

export async function countFilesRecursively(root: string): Promise<number> {
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
