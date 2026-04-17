import path from "node:path";
import { inspectAstroCollectionsWorkspace } from "./astroCollections.js";
import type { CmsValidationReport } from "./cmsCore.js";
import {
  countFilesRecursively,
  getCmsPaths,
  getDefaultAstroCmsPaths,
  toPosix,
} from "./cmsCore.js";
import { inspectLegacyYamlCmsWorkspace, readRootConfig } from "./cmsLegacyInspection.js";
import { isAstroProject } from "./cmsProjectDetection.js";
import { getCmsToolkitStatus } from "./cmsToolkit.js";

export async function getCmsStatus(projectDir: string): Promise<CmsValidationReport> {
  const toolkit = await getCmsToolkitStatus(projectDir);
  const astroReport = await inspectAstroCollectionsWorkspace(projectDir);
  if (astroReport) {
    return {
      ...astroReport,
      toolkit,
    };
  }

  if (await isAstroProject(projectDir)) {
    const paths = getDefaultAstroCmsPaths(projectDir);
    return {
      sourceKind: "astro-collections",
      initialized: false,
      valid: false,
      paths,
      toolkit,
      defaultLocale: null,
      locales: [],
      modelCount: 0,
      entryCount: 0,
      assetCount: 0,
      mediaFileCount: await countFilesRecursively(paths.mediaRoot),
      errors: [
        `Missing ${toPosix(path.relative(projectDir, paths.rootConfigPath))}. Astro-backed projects now use Astro Content Collections as the source of truth. Create \`src/content.config.ts\` and export \`collections\` before using Studio CMS.`,
      ],
      models: [],
    };
  }

  const paths = getCmsPaths(projectDir);
  const errors: string[] = [];
  const rootConfig = await readRootConfig(paths, errors);
  if (!rootConfig) {
    const astroPaths = getDefaultAstroCmsPaths(projectDir);
    return {
      sourceKind: "astro-collections",
      initialized: false,
      valid: false,
      paths: astroPaths,
      toolkit,
      defaultLocale: null,
      locales: [],
      modelCount: 0,
      entryCount: 0,
      assetCount: 0,
      mediaFileCount: await countFilesRecursively(astroPaths.mediaRoot),
      errors: [
        `Missing ${toPosix(path.relative(projectDir, astroPaths.rootConfigPath))}. Vivd CMS expects Astro Content Collections as the source of truth. Create \`src/content.config.ts\` and export \`collections\` before using Studio CMS.`,
      ],
      models: [],
    };
  }

  const report = await inspectLegacyYamlCmsWorkspace({
    paths,
    rootConfig,
    toolkit,
  });

  return {
    ...report,
    valid: errors.length === 0 && report.valid,
    errors: [...errors, ...report.errors],
  };
}

export async function validateCmsWorkspace(projectDir: string): Promise<CmsValidationReport> {
  return getCmsStatus(projectDir);
}
