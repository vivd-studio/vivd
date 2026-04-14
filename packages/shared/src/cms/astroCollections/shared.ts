import fs from "node:fs/promises";
import path from "node:path";
import type {
  CmsEntryRecord,
  CmsFieldDefinition,
  CmsModelRecord,
  CmsPaths,
  CmsSourceKind,
} from "../index.js";

export type AstroCollectionsValidationReport = {
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

export type ParsedFieldResult = {
  field: CmsFieldDefinition;
  supported: boolean;
};

export type ParsedCollectionDefinition = {
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

export type SchemaParseContext = {
  imageHelpers: Set<string>;
  errors: string[];
  label: string;
  defaultLocale: string | null;
  locales: string[];
};

export type AstroI18nConfig = {
  defaultLocale: string | null;
  locales: string[];
};

export type AstroReferenceCheck = {
  sourcePath: string;
  fieldPath: string;
  targetModelKey: string;
  targetEntryKey: string;
};

export const ASTRO_CONTENT_CONFIG_CANDIDATES = [
  path.join("src", "content.config.ts"),
  path.join("src", "content.config.mts"),
  path.join("src", "content.config.js"),
  path.join("src", "content.config.mjs"),
];

export const ASTRO_CONFIG_CANDIDATES = [
  "astro.config.ts",
  "astro.config.mts",
  "astro.config.js",
  "astro.config.mjs",
  "astro.config.cjs",
];

export const TITLE_FIELD_KEYS = new Set(["title", "name", "label"]);
export const SUPPORTED_ENTRY_EXTENSIONS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".mdx",
  ".markdown",
]);
export const IMAGE_FIELD_TOKENS = new Set([
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
export const IMAGE_LIST_FIELD_TOKENS = new Set([
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
export const IMAGE_REFERENCE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
export const GENERIC_FILE_REFERENCE_EXTENSION_REGEX = /\.[a-z0-9]{1,8}(?:[?#].*)?$/i;
export const NON_LOCAL_ASSET_REFERENCE_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export const LOCALIZABLE_ASTRO_FIELD_TYPES = new Set<CmsFieldDefinition["type"]>([
  "string",
  "text",
  "richText",
]);

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

export function normalizeLocaleCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function getAstroSchemaLocales(localeConfig: AstroI18nConfig): string[] {
  const normalized = [
    normalizeLocaleCode(localeConfig.defaultLocale),
    ...localeConfig.locales.map((locale) => normalizeLocaleCode(locale)),
  ].filter((locale): locale is string => Boolean(locale));

  return normalized.length ? [...new Set(normalized)] : ["en"];
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

export async function findAstroContentConfigPath(projectDir: string): Promise<string | null> {
  for (const relativePath of ASTRO_CONTENT_CONFIG_CANDIDATES) {
    const absolutePath = path.join(projectDir, relativePath);
    if (await pathExists(absolutePath)) {
      return absolutePath;
    }
  }
  return null;
}

export async function findAstroConfigPath(projectDir: string): Promise<string | null> {
  for (const relativePath of ASTRO_CONFIG_CANDIDATES) {
    const absolutePath = path.join(projectDir, relativePath);
    if (await pathExists(absolutePath)) {
      return absolutePath;
    }
  }
  return null;
}

export function buildAstroPaths(projectDir: string, configPath: string): CmsPaths {
  return {
    projectDir,
    contentRoot: path.join(projectDir, "src", "content"),
    rootConfigPath: configPath,
    modelsRoot: path.dirname(configPath),
    collectionsRoot: path.join(projectDir, "src", "content"),
    mediaRoot: path.join(projectDir, "src", "content", "media"),
  };
}

export type AstroEntryLike = Pick<CmsEntryRecord, "filePath" | "relativePath" | "values">;
