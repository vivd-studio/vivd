import fs from "node:fs";
import path from "node:path";

export type ProjectFramework = "astro" | "generic";

export type ProjectConfig = {
  packageManager: "npm" | "pnpm" | "yarn";
  framework: ProjectFramework;
};

function detectPackageManager(projectDir: string): "npm" | "pnpm" | "yarn" {
  if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

export function detectProjectType(projectDir: string): ProjectConfig {
  const packageJsonPath = path.join(projectDir, "package.json");
  const packageManager = detectPackageManager(projectDir);

  if (!fs.existsSync(packageJsonPath)) {
    return { packageManager, framework: "generic" };
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};

    const hasAstroConfig =
      fs.existsSync(path.join(projectDir, "astro.config.mjs")) ||
      fs.existsSync(path.join(projectDir, "astro.config.js")) ||
      fs.existsSync(path.join(projectDir, "astro.config.ts")) ||
      fs.existsSync(path.join(projectDir, "astro.config.cjs"));

    return {
      packageManager,
      framework:
        hasAstroConfig ||
        typeof deps.astro === "string" ||
        typeof devDeps.astro === "string"
          ? "astro"
          : "generic",
    };
  } catch {
    return { packageManager, framework: "generic" };
  }
}

export function hasNodeModules(projectDir: string): boolean {
  return fs.existsSync(path.join(projectDir, "node_modules"));
}
