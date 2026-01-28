import fs from "fs";
import path from "path";

export type ProjectServingMode = "static" | "devserver";
export type ProjectFramework = "astro" | "generic";

export interface ProjectConfig {
  mode: ProjectServingMode;
  devCommand?: string;
  packageManager: "npm" | "pnpm" | "yarn";
  framework: ProjectFramework;
}

/**
 * Detect the package manager used in a project directory.
 */
function detectPackageManager(projectDir: string): "npm" | "pnpm" | "yarn" {
  if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(projectDir, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

/**
 * Detect whether a project is static HTML or requires a dev server.
 *
 * A project requires a dev server if:
 * 1. It has a package.json
 * 2. The package.json has a "dev" script
 */
export function detectProjectType(versionDir: string): ProjectConfig {
  const packageJsonPath = path.join(versionDir, "package.json");
  const packageManager = detectPackageManager(versionDir);

  if (!fs.existsSync(packageJsonPath)) {
    return { mode: "static", packageManager, framework: "generic" };
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const scripts = packageJson.scripts || {};
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};

    const hasAstroConfig =
      fs.existsSync(path.join(versionDir, "astro.config.mjs")) ||
      fs.existsSync(path.join(versionDir, "astro.config.js")) ||
      fs.existsSync(path.join(versionDir, "astro.config.ts")) ||
      fs.existsSync(path.join(versionDir, "astro.config.cjs"));

    const framework: ProjectFramework =
      hasAstroConfig || typeof deps.astro === "string" || typeof devDeps.astro === "string"
        ? "astro"
        : "generic";

    // Check for common dev server scripts
    if (scripts.dev) {
      return {
        mode: "devserver",
        devCommand: `${packageManager} run dev`,
        packageManager,
        framework,
      };
    }

    // Fallback to start script if it looks like a dev server
    if (scripts.start && scripts.start.includes("dev")) {
      return {
        mode: "devserver",
        devCommand: `${packageManager} run start`,
        packageManager,
        framework,
      };
    }

    // No dev script found, treat as static
    return { mode: "static", packageManager, framework };
  } catch {
    // If we can't parse package.json, treat as static
    return { mode: "static", packageManager, framework: "generic" };
  }
}

/**
 * Check if node_modules exists in the project directory.
 */
export function hasNodeModules(versionDir: string): boolean {
  return fs.existsSync(path.join(versionDir, "node_modules"));
}
