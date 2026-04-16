export type InstalledPluginSourceAliasOptions = {
  configDir?: string;
  repoRoot?: string;
  includeBareImports?: boolean;
};

export type InstalledPluginAliasEntry = {
  find: RegExp;
  replacement: string;
};

export const installedPluginPackageNames: readonly string[];
export const installedPluginWorkspaceDirs: readonly string[];
export const installedPluginPackageJsonPaths: readonly string[];

export function createInstalledPluginPackageMatchers(): RegExp[];

export function createInstalledPluginSourceAliases(
  options?: InstalledPluginSourceAliasOptions,
): InstalledPluginAliasEntry[];

export function createInstalledPluginSourceAliasObject(
  options?: InstalledPluginSourceAliasOptions,
): Record<string, string>;
