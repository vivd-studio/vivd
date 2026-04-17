export type WorkspaceSourceAliasEntry = {
  find: RegExp;
  replacement: string;
};

export type CreateVivdWorkspaceSourceAliasesOptions = {
  configDir?: string;
  repoRoot?: string;
  packageNames?: string[];
  includeInstalledPluginPackages?: boolean;
  includeBareInstalledPluginImports?: boolean;
};

export const vivdWorkspaceSourcePackageNames: readonly string[];

export function createVivdWorkspaceSourceAliases(
  options?: CreateVivdWorkspaceSourceAliasesOptions,
): WorkspaceSourceAliasEntry[];
