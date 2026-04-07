import type {
  PluginCliActionResultPayload,
  PluginCliAliasTarget,
  PluginCliRenderResult,
  PluginCliInfoContractPayload,
  PluginCliModule,
} from "@vivd/shared/types";
import { analyticsCliModule } from "./analytics/module";
import { contactFormCliModule } from "./contactForm/module";

const cliPluginModules: PluginCliModule[] = [
  contactFormCliModule,
  analyticsCliModule,
];

const cliPluginModuleById = new Map(
  cliPluginModules.map((module) => [module.pluginId, module]),
);

export interface ResolvedCliPluginAlias {
  pluginId: string;
  target: PluginCliAliasTarget;
  args: string[];
  renderMode: "auto" | "generic" | "plugin";
}

export function getCliPluginModule(pluginId: string): PluginCliModule | null {
  return cliPluginModuleById.get(pluginId) ?? null;
}

export function renderCliPluginInfo(
  info: PluginCliInfoContractPayload,
): PluginCliRenderResult | null {
  const module = getCliPluginModule(info.pluginId);
  if (!module?.renderInfo) return null;
  return module.renderInfo(info);
}

export function renderCliPluginConfig(options: {
  info: PluginCliInfoContractPayload;
  projectSlug: string;
}): PluginCliRenderResult | null {
  const module = getCliPluginModule(options.info.pluginId);
  if (!module?.renderConfig) return null;
  return module.renderConfig(options);
}

export function renderCliPluginConfigTemplate(
  options: {
    pluginId: string;
    info?: PluginCliInfoContractPayload | null;
  },
): PluginCliRenderResult | null {
  const module = getCliPluginModule(options.pluginId);
  if (!module?.renderConfigTemplate) return null;
  return module.renderConfigTemplate({ info: options.info ?? null });
}

export function renderCliPluginConfigUpdate(options: {
  pluginId: string;
  info: PluginCliInfoContractPayload;
  projectSlug: string;
}): PluginCliRenderResult | null {
  const module = getCliPluginModule(options.pluginId);
  if (!module?.renderConfigUpdate) return null;
  return module.renderConfigUpdate(options);
}

export function renderCliPluginAction(
  action: PluginCliActionResultPayload,
): PluginCliRenderResult | null {
  const module = getCliPluginModule(action.pluginId);
  if (!module?.renderAction) return null;
  return module.renderAction(action);
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
        renderMode: alias.renderMode ?? "auto",
        matchedLength: alias.tokens.length,
      };
    }
  }

  if (!bestMatch) return null;
  return {
    pluginId: bestMatch.pluginId,
    target: bestMatch.target,
    args: bestMatch.args,
    renderMode: bestMatch.renderMode,
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
