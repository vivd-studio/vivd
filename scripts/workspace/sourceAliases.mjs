import path from "node:path";
import { createInstalledPluginSourceAliases } from "../../plugins/installed/registry.helpers.mjs";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const vivdWorkspaceSourceRegistry = Object.freeze([
  {
    packageName: "@vivd/builder",
    workspaceDir: "packages/builder",
  },
  {
    packageName: "@vivd/installed-plugins",
    workspaceDir: "plugins/installed",
  },
  {
    packageName: "@vivd/plugin-sdk",
    workspaceDir: "plugins/sdk",
  },
  {
    packageName: "@vivd/shared",
    workspaceDir: "packages/shared",
  },
  {
    packageName: "@vivd/ui",
    workspaceDir: "packages/ui",
  },
]);

const workspaceSourceRegistryByPackageName = new Map(
  vivdWorkspaceSourceRegistry.map((entry) => [entry.packageName, entry]),
);

function resolveWorkspaceSourceEntries(requestedPackageNames) {
  const packageNames =
    requestedPackageNames ??
    vivdWorkspaceSourceRegistry.map(({ packageName }) => packageName);

  return packageNames.map((packageName) => {
    const entry = workspaceSourceRegistryByPackageName.get(packageName);
    if (!entry) {
      throw new Error(`Unknown Vivd workspace source package: ${packageName}`);
    }

    return entry;
  });
}

function createPackageSourceAliases(entries, repoRoot) {
  return entries.flatMap(({ packageName, workspaceDir }) => {
    const srcDir = path.resolve(repoRoot, workspaceDir, "src");
    return [
      {
        find: new RegExp(`^${escapeRegExp(packageName)}$`),
        replacement: path.resolve(srcDir, "index.ts"),
      },
      {
        find: new RegExp(`^${escapeRegExp(packageName)}\\/(.*)$`),
        replacement: `${srcDir}/$1`,
      },
    ];
  });
}

export const vivdWorkspaceSourcePackageNames = Object.freeze(
  vivdWorkspaceSourceRegistry.map(({ packageName }) => packageName),
);

export function createVivdWorkspaceSourceAliases(options = {}) {
  const {
    configDir = process.cwd(),
    repoRoot = path.resolve(configDir, "..", ".."),
    packageNames,
    includeInstalledPluginPackages = true,
    includeBareInstalledPluginImports = true,
  } = options;

  const packageAliases = createPackageSourceAliases(
    resolveWorkspaceSourceEntries(packageNames),
    repoRoot,
  );
  if (!includeInstalledPluginPackages) {
    return packageAliases;
  }

  return [
    ...packageAliases,
    ...createInstalledPluginSourceAliases({
      configDir,
      repoRoot,
      includeBareImports: includeBareInstalledPluginImports,
    }),
  ];
}
