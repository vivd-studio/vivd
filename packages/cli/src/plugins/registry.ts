import type {
  PluginCliAliasTarget,
  PluginCliInfoContractPayload,
  PluginCliModule,
} from "@vivd/shared/types";
import { analyticsCliModule } from "@vivd/plugin-analytics/cli/module";

const cliPluginModules: PluginCliModule[] = [analyticsCliModule];

const cliPluginModuleById = new Map(
  cliPluginModules.map((module) => [module.pluginId, module]),
);

export interface ResolvedCliPluginAlias {
  pluginId: string;
  target: PluginCliAliasTarget;
  args: string[];
}

export function getCliPluginModule(pluginId: string): PluginCliModule | null {
  return cliPluginModuleById.get(pluginId) ?? null;
}

export function renderCliPluginInfo(
  info: PluginCliInfoContractPayload,
): { data: unknown; human: string } | null {
  const module = getCliPluginModule(info.pluginId);
  if (!module?.renderInfo) return null;
  return module.renderInfo(info);
}

export function resolveCliPluginAlias(tokens: string[]): ResolvedCliPluginAlias | null {
  let bestMatch:
    | (ResolvedCliPluginAlias & {
        matchedLength: number;
      })
    | null = null;

  for (const module of cliPluginModules) {
    for (const alias of module.aliases ?? []) {
      if (alias.tokens.length > tokens.length) continue;
      const matched = alias.tokens.every((token, index) => tokens[index] === token);
      if (!matched) continue;

      if (bestMatch && bestMatch.matchedLength >= alias.tokens.length) {
        continue;
      }

      bestMatch = {
        pluginId: module.pluginId,
        target: alias.target,
        args: tokens.slice(alias.tokens.length),
        matchedLength: alias.tokens.length,
      };
    }
  }

  if (!bestMatch) return null;
  return {
    pluginId: bestMatch.pluginId,
    target: bestMatch.target,
    args: bestMatch.args,
  };
}

export function getCliPluginHelpText(topic: string[]): string | null {
  const normalized = topic.join(" ").trim();

  for (const module of cliPluginModules) {
    const help = module.help;
    if (!help) continue;

    if (normalized.startsWith(`plugins ${help.topic}`)) {
      return help.lines.join("\n");
    }

    if (normalized.startsWith(`plugins info ${module.pluginId}`)) {
      return help.lines.join("\n");
    }

    for (const alias of module.aliases ?? []) {
      const aliasPrefix = `plugins ${alias.tokens.join(" ")}`;
      if (normalized.startsWith(aliasPrefix)) {
        return help.lines.join("\n");
      }
    }
  }

  return null;
}

export function listCliPluginHelpSummaryLines(): string[] {
  return cliPluginModules.flatMap((module) => module.help?.summaryLines ?? []);
}
