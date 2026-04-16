import path from "node:path";
import { installedPluginRegistry } from "./registry.config.mjs";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const installedPluginPackageNames = Object.freeze(
  installedPluginRegistry.map(({ packageName }) => packageName),
);

export const installedPluginWorkspaceDirs = Object.freeze(
  installedPluginRegistry.map(({ workspaceDir }) => workspaceDir),
);

export const installedPluginPackageJsonPaths = Object.freeze(
  installedPluginWorkspaceDirs.map((workspaceDir) => `${workspaceDir}/package.json`),
);

export function createInstalledPluginPackageMatchers() {
  return installedPluginPackageNames.map(
    (packageName) =>
      new RegExp(`^${escapeRegExp(packageName)}(\\/.*)?$`),
  );
}

export function createInstalledPluginSourceAliases(options = {}) {
  const {
    configDir = process.cwd(),
    repoRoot = path.resolve(configDir, "..", ".."),
    includeBareImports = true,
  } = options;

  return installedPluginRegistry.flatMap(({ packageName, workspaceDir }) => {
    const srcDir = path.resolve(repoRoot, workspaceDir, "src");
    const subpathMatcher = new RegExp(`^${escapeRegExp(packageName)}\\/(.*)$`);
    const aliases = [
      {
        find: subpathMatcher,
        replacement: `${srcDir}/$1`,
      },
    ];

    if (includeBareImports) {
      aliases.unshift({
        find: new RegExp(`^${escapeRegExp(packageName)}$`),
        replacement: path.resolve(srcDir, "index.ts"),
      });
    }

    return aliases;
  });
}

export function createInstalledPluginSourceAliasObject(options = {}) {
  const {
    configDir = process.cwd(),
    repoRoot = path.resolve(configDir, "..", ".."),
  } = options;

  return Object.fromEntries(
    installedPluginRegistry.map(({ packageName, workspaceDir }) => [
      packageName,
      path.resolve(repoRoot, workspaceDir, "src"),
    ]),
  );
}
