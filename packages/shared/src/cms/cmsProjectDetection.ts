import fs from "node:fs/promises";
import path from "node:path";
import { isRecord, pathExists } from "./cmsCore.js";

async function readPackageJson(projectDir: string): Promise<Record<string, unknown> | null> {
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function isAstroProject(projectDir: string): Promise<boolean> {
  for (const candidate of [
    "astro.config.mjs",
    "astro.config.js",
    "astro.config.ts",
    "astro.config.cjs",
    "astro.config.mts",
  ]) {
    if (await pathExists(path.join(projectDir, candidate))) {
      return true;
    }
  }

  const packageJson = await readPackageJson(projectDir);
  if (!packageJson) return false;

  const dependencies = isRecord(packageJson.dependencies) ? packageJson.dependencies : null;
  const devDependencies = isRecord(packageJson.devDependencies) ? packageJson.devDependencies : null;

  return typeof dependencies?.astro === "string" || typeof devDependencies?.astro === "string";
}
