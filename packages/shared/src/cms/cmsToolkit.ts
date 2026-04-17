import fs from "node:fs/promises";
import path from "node:path";
import type { CmsScaffoldResult, CmsToolkitFileReport, CmsToolkitStatusReport } from "./cmsCore.js";
import {
  CMS_TOOLKIT_VERSION,
  ensureDirectory,
  getCmsPaths,
  pathExists,
  toPosix,
} from "./cmsCore.js";
import { isAstroProject } from "./cmsProjectDetection.js";

const CMS_BINDING_HELPER_CANDIDATE_RELATIVE_PATHS = [
  path.join("src", "lib", "cmsBindings.ts"),
  path.join("src", "lib", "cmsBindings.js"),
  path.join("src", "lib", "cmsBindings.mts"),
  path.join("src", "lib", "cmsBindings.mjs"),
];

const DEFAULT_CMS_BINDING_HELPER_RELATIVE_PATH =
  CMS_BINDING_HELPER_CANDIDATE_RELATIVE_PATHS[0]!;

const DEFAULT_CMS_TEXT_COMPONENT_RELATIVE_PATH = path.join(
  "src",
  "lib",
  "cms",
  "CmsText.astro",
);

const DEFAULT_CMS_IMAGE_COMPONENT_RELATIVE_PATH = path.join(
  "src",
  "lib",
  "cms",
  "CmsImage.astro",
);

const CMS_BINDING_HELPER_SOURCE = [
  `// vivd-cms-toolkit-version: ${CMS_TOOLKIT_VERSION}`,
  "export type CmsBindingFieldPath = string | Array<string | number>;",
  "export type CmsLocalizedTextValue =",
  "  | string",
  "  | number",
  "  | Record<string, string | number | null | undefined>;",
  "",
  "function formatCmsFieldPath(field: CmsBindingFieldPath): string {",
  '  if (typeof field === "string") {',
  "    return field;",
  "  }",
  "",
  '  return field.reduce<string>((path, segment, index) => {',
  '    const token = typeof segment === "number" ? `[${segment}]` : String(segment);',
  '    if (typeof segment === "number") {',
  "      return `${path}${token}`;",
  "    }",
  '    return index === 0 ? token : `${path}.${token}`;',
  '  }, "");',
  "}",
  "",
  "export type CmsBindingInput = {",
  "  collection: string;",
  "  entry: string;",
  "  field: CmsBindingFieldPath;",
  '  kind: "text" | "asset";',
  "  locale?: string;",
  "};",
  "",
  'export type CmsTextBindingInput = Omit<CmsBindingInput, "kind">;',
  'export type CmsAssetBindingInput = Omit<CmsBindingInput, "kind">;',
  "export type CmsEntryBindingInput = {",
  "  collection: string;",
  "  entry: string;",
  "  locale?: string;",
  "};",
  "",
  "function normalizeCmsLocale(locale?: string): string {",
  '  return typeof locale === "string" ? locale.trim() : "";',
  "}",
  "",
  "export function resolveCmsTextValue(",
  "  value: CmsLocalizedTextValue | undefined,",
  "  locale?: string,",
  "  defaultLocale?: string,",
  "): string | number | undefined {",
  '  if (typeof value === "undefined") {',
  "    return undefined;",
  "  }",
  "",
  '  if (typeof value === "string" || typeof value === "number") {',
  "    return value;",
  "  }",
  "",
  "  if (!value || Array.isArray(value)) {",
  "    return undefined;",
  "  }",
  "",
  "  const localeMap = value as Record<string, string | number | null | undefined>;",
  "  const activeLocale = normalizeCmsLocale(locale);",
  "  if (activeLocale) {",
  "    const localized = localeMap[activeLocale];",
  '    if (typeof localized === "string" || typeof localized === "number") {',
  "      return localized;",
  "    }",
  "  }",
  "",
  "  const fallbackLocale = normalizeCmsLocale(defaultLocale);",
  "  if (fallbackLocale) {",
  "    const fallback = localeMap[fallbackLocale];",
  '    if (typeof fallback === "string" || typeof fallback === "number") {',
  "      return fallback;",
  "    }",
  "  }",
  "",
  "  for (const candidate of Object.values(localeMap)) {",
  '    if (typeof candidate === "string" || typeof candidate === "number") {',
  "      return candidate;",
  "    }",
  "  }",
  "",
  "  return undefined;",
  "}",
  "",
  "export function cmsBindingAttrs(binding: CmsBindingInput) {",
  "  return {",
  '    "data-cms-collection": binding.collection,',
  '    "data-cms-entry": binding.entry,',
  '    "data-cms-field": formatCmsFieldPath(binding.field),',
  '    "data-cms-kind": binding.kind,',
  '    ...(binding.locale ? { "data-cms-locale": binding.locale } : {}),',
  "  };",
  "}",
  "",
  "export function cmsTextBindingAttrs(binding: CmsTextBindingInput) {",
  '  return cmsBindingAttrs({ ...binding, kind: "text" });',
  "}",
  "",
  "export function cmsAssetBindingAttrs(binding: CmsAssetBindingInput) {",
  '  return cmsBindingAttrs({ ...binding, kind: "asset" });',
  "}",
  "",
  "export function bindCmsEntry(binding: CmsEntryBindingInput) {",
  "  return {",
  "    text(field: CmsBindingFieldPath) {",
  "      return cmsTextBindingAttrs({ ...binding, field });",
  "    },",
  "    asset(field: CmsBindingFieldPath) {",
  "      return cmsAssetBindingAttrs({ ...binding, field });",
  "    },",
  "  };",
  "}",
].join("\n");

const CMS_TEXT_COMPONENT_SOURCE = `---
/* vivd-cms-toolkit-version: ${CMS_TOOLKIT_VERSION} */
import {
  cmsTextBindingAttrs,
  resolveCmsTextValue,
  type CmsBindingFieldPath,
  type CmsLocalizedTextValue,
} from "../cmsBindings";

interface Props {
  collection: string;
  entry: string;
  field: CmsBindingFieldPath;
  locale?: string;
  defaultLocale?: string;
  as?: string;
  text?: CmsLocalizedTextValue;
  [key: string]: unknown;
}

const {
  collection,
  entry,
  field,
  locale,
  defaultLocale,
  as: Tag = "span",
  text,
  ...htmlProps
} = Astro.props as Props;

const cmsAttrs = cmsTextBindingAttrs({ collection, entry, field, locale });
const resolvedText = resolveCmsTextValue(text, locale, defaultLocale);
---

<Tag {...cmsAttrs} {...htmlProps}>
  {resolvedText ?? <slot />}
</Tag>
`;

const CMS_IMAGE_COMPONENT_SOURCE = `---
/* vivd-cms-toolkit-version: ${CMS_TOOLKIT_VERSION} */
import { Image } from "astro:assets";
import { cmsAssetBindingAttrs, type CmsBindingFieldPath } from "../cmsBindings";

interface Props {
  collection: string;
  entry: string;
  field: CmsBindingFieldPath;
  locale?: string;
  [key: string]: unknown;
}

const { collection, entry, field, locale, ...imageProps } = Astro.props as Props;
const cmsAttrs = cmsAssetBindingAttrs({ collection, entry, field, locale });
---

<Image {...cmsAttrs} {...imageProps} />
`;

const CMS_TOOLKIT_FILE_SPECS = [
  {
    key: "cmsBindings",
    relativePath: DEFAULT_CMS_BINDING_HELPER_RELATIVE_PATH,
    source: CMS_BINDING_HELPER_SOURCE,
  },
  {
    key: "cmsText",
    relativePath: DEFAULT_CMS_TEXT_COMPONENT_RELATIVE_PATH,
    source: CMS_TEXT_COMPONENT_SOURCE,
  },
  {
    key: "cmsImage",
    relativePath: DEFAULT_CMS_IMAGE_COMPONENT_RELATIVE_PATH,
    source: CMS_IMAGE_COMPONENT_SOURCE,
  },
] as const satisfies ReadonlyArray<{
  key: CmsToolkitFileReport["key"];
  relativePath: string;
  source: string;
}>;

const CMS_TOOLKIT_REFERENCE_ROOT = "src";
const CMS_TOOLKIT_REFERENCE_EXTENSIONS = new Set([
  ".astro",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".md",
  ".mdx",
]);
const CMS_TOOLKIT_REFERENCE_PATTERNS = ["cmsBindings", "CmsText.astro", "CmsImage.astro"];

function normalizeTextContent(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function parseCmsToolkitVersion(value: string): number | null {
  const match = value.match(/vivd-cms-toolkit-version:\s*(\d+)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUpgradeableCmsBindingHelperSource(value: string): boolean {
  const normalized = normalizeTextContent(value);
  return (
    normalized.includes('export function cmsBindingAttrs(binding: CmsBindingInput)') &&
    normalized.includes('"data-cms-collection": binding.collection') &&
    normalized.includes('"data-cms-entry": binding.entry') &&
    normalized.includes('"data-cms-field":') &&
    normalized.includes('"data-cms-kind": binding.kind')
  );
}

function isUpgradeableCmsToolkitSource(relativePath: string, value: string): boolean {
  if (relativePath === DEFAULT_CMS_BINDING_HELPER_RELATIVE_PATH) {
    return isUpgradeableCmsBindingHelperSource(value);
  }

  const normalized = normalizeTextContent(value);
  if (relativePath === DEFAULT_CMS_TEXT_COMPONENT_RELATIVE_PATH) {
    return (
      normalized.includes('from "../cmsBindings";') &&
      normalized.includes("cmsTextBindingAttrs({ collection, entry, field, locale })")
    );
  }

  if (relativePath === DEFAULT_CMS_IMAGE_COMPONENT_RELATIVE_PATH) {
    return (
      normalized.includes('import { Image } from "astro:assets";') &&
      normalized.includes("cmsAssetBindingAttrs({ collection, entry, field, locale })")
    );
  }

  return false;
}

function summarizeCmsToolkitStatus(files: CmsToolkitFileReport[]): CmsToolkitStatusReport["status"] {
  if (files.some((file) => file.status === "stale")) {
    return "stale";
  }
  if (files.some((file) => file.status === "missing")) {
    return "missing";
  }
  if (files.some((file) => file.status === "custom")) {
    return "custom";
  }
  return "current";
}

function resolveCmsToolkitRelativePath(
  defaultRelativePath: string,
  existingHelperPath: string | null,
): string {
  if (
    defaultRelativePath === DEFAULT_CMS_BINDING_HELPER_RELATIVE_PATH &&
    existingHelperPath
  ) {
    return existingHelperPath;
  }
  return toPosix(defaultRelativePath);
}

async function findExistingCmsBindingHelperRelativePath(
  projectDir: string,
): Promise<string | null> {
  for (const relativePath of CMS_BINDING_HELPER_CANDIDATE_RELATIVE_PATHS) {
    if (await pathExists(path.join(projectDir, relativePath))) {
      return toPosix(relativePath);
    }
  }
  return null;
}

async function projectReferencesCmsToolkitInDir(dirPath: string): Promise<boolean> {
  if (!(await pathExists(dirPath))) {
    return false;
  }

  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dirPath, dirent.name);
    if (dirent.isDirectory()) {
      if (await projectReferencesCmsToolkitInDir(fullPath)) {
        return true;
      }
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    const extension = path.extname(dirent.name).toLowerCase();
    if (!CMS_TOOLKIT_REFERENCE_EXTENSIONS.has(extension)) {
      continue;
    }

    const content = await fs.readFile(fullPath, "utf8");
    if (CMS_TOOLKIT_REFERENCE_PATTERNS.some((pattern) => content.includes(pattern))) {
      return true;
    }
  }

  return false;
}

export async function getCmsToolkitStatus(projectDir: string): Promise<CmsToolkitStatusReport> {
  const existingHelperPath = await findExistingCmsBindingHelperRelativePath(projectDir);
  const files: CmsToolkitFileReport[] = [];

  for (const spec of CMS_TOOLKIT_FILE_SPECS) {
    const relativePath = resolveCmsToolkitRelativePath(spec.relativePath, existingHelperPath);
    const absolutePath = path.join(projectDir, relativePath);
    if (!(await pathExists(absolutePath))) {
      files.push({
        key: spec.key,
        relativePath,
        status: "missing",
        expectedVersion: CMS_TOOLKIT_VERSION,
        currentVersion: null,
      });
      continue;
    }

    const currentSource = await fs.readFile(absolutePath, "utf8");
    const desiredSource = `${spec.source}\n`;
    const currentVersion = parseCmsToolkitVersion(currentSource);
    let status: CmsToolkitStatusReport["status"];

    if (normalizeTextContent(currentSource) === normalizeTextContent(desiredSource)) {
      status = "current";
    } else if (currentVersion != null && currentVersion < CMS_TOOLKIT_VERSION) {
      status = "stale";
    } else if (
      currentVersion == null &&
      isUpgradeableCmsToolkitSource(spec.relativePath, currentSource)
    ) {
      status = "stale";
    } else {
      status = "custom";
    }

    files.push({
      key: spec.key,
      relativePath,
      status,
      expectedVersion: CMS_TOOLKIT_VERSION,
      currentVersion,
    });
  }

  return {
    status: summarizeCmsToolkitStatus(files),
    expectedVersion: CMS_TOOLKIT_VERSION,
    needsInstall: files.some((file) => file.status === "missing" || file.status === "stale"),
    files,
  };
}

export async function projectReferencesCmsToolkit(projectDir: string): Promise<boolean> {
  return projectReferencesCmsToolkitInDir(path.join(projectDir, CMS_TOOLKIT_REFERENCE_ROOT));
}

export async function installCmsBindingHelper(projectDir: string): Promise<CmsScaffoldResult> {
  const paths = getCmsPaths(projectDir);
  const created: string[] = [];
  const skipped: string[] = [];
  const existingHelperPath = await findExistingCmsBindingHelperRelativePath(projectDir);

  for (const spec of CMS_TOOLKIT_FILE_SPECS) {
    const desiredSource = `${spec.source}\n`;
    const relativePath = resolveCmsToolkitRelativePath(spec.relativePath, existingHelperPath);
    const absolutePath = path.join(projectDir, relativePath);

    if (await pathExists(absolutePath)) {
      const currentSource = await fs.readFile(absolutePath, "utf8");
      if (normalizeTextContent(currentSource) === normalizeTextContent(desiredSource)) {
        skipped.push(relativePath);
        continue;
      }

      if (isUpgradeableCmsToolkitSource(spec.relativePath, currentSource)) {
        await fs.writeFile(absolutePath, desiredSource, "utf8");
        created.push(relativePath);
        continue;
      }

      skipped.push(relativePath);
      continue;
    }

    await ensureDirectory(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, desiredSource, "utf8");
    created.push(relativePath);
  }

  return { created, skipped, paths };
}

export async function ensureReferencedAstroCmsToolkit(
  projectDir: string,
): Promise<CmsScaffoldResult | null> {
  if (!(await isAstroProject(projectDir))) {
    return null;
  }

  const toolkit = await getCmsToolkitStatus(projectDir);
  if (!toolkit.needsInstall) {
    return null;
  }

  if (!(await projectReferencesCmsToolkit(projectDir))) {
    return null;
  }

  return installCmsBindingHelper(projectDir);
}
