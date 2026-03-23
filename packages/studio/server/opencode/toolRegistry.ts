import * as path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export interface StudioOpencodeToolDefinition {
  name: string;
  sourceFile: string;
  moduleDistRelativePath: string;
  moduleSourceRelativePath: string;
  definitionExportName: string;
  defaultEnabled?: boolean;
  featureFlag?: string;
  allowedRoles?: string[];
  allowedPlans?: string[];
  requiredPlugins?: string[];
}

export interface StudioOpencodeToolPolicy {
  tools: StudioOpencodeToolDefinition[];
  enabledByName: Record<string, boolean>;
}

const DEFAULT_FEATURE_FLAGS: Record<string, boolean> = {
  plugins: true,
  contact_forms: true,
  analytics: true,
  publish_checklist: true,
  image_ai: true,
};

const TOOL_DEFINITIONS: StudioOpencodeToolDefinition[] = [
  {
    name: "vivd_plugins_catalog",
    sourceFile: "vivd_plugins_catalog.ts",
    moduleDistRelativePath: "opencode/toolModules/vivdPluginsCatalog.js",
    moduleSourceRelativePath: "server/opencode/toolModules/vivdPluginsCatalog.ts",
    definitionExportName: "vivdPluginsCatalogToolDefinition",
    defaultEnabled: true,
    featureFlag: "plugins",
  },
  {
    name: "vivd_plugins_contact_info",
    sourceFile: "vivd_plugins_contact_info.ts",
    moduleDistRelativePath: "opencode/toolModules/vivdPluginsContactInfo.js",
    moduleSourceRelativePath: "server/opencode/toolModules/vivdPluginsContactInfo.ts",
    definitionExportName: "vivdPluginsContactInfoToolDefinition",
    defaultEnabled: true,
    featureFlag: "contact_forms",
    requiredPlugins: ["contact_form"],
  },
  {
    name: "vivd_plugins_analytics_info",
    sourceFile: "vivd_plugins_analytics_info.ts",
    moduleDistRelativePath: "opencode/toolModules/vivdPluginsAnalyticsInfo.js",
    moduleSourceRelativePath:
      "server/opencode/toolModules/vivdPluginsAnalyticsInfo.ts",
    definitionExportName: "vivdPluginsAnalyticsInfoToolDefinition",
    defaultEnabled: true,
    featureFlag: "analytics",
    requiredPlugins: ["analytics"],
  },
  {
    name: "vivd_publish_checklist",
    sourceFile: "vivd_publish_checklist.ts",
    moduleDistRelativePath: "opencode/toolModules/vivdPublishChecklist.js",
    moduleSourceRelativePath: "server/opencode/toolModules/vivdPublishChecklist.ts",
    definitionExportName: "vivdPublishChecklistToolDefinition",
    defaultEnabled: true,
    featureFlag: "publish_checklist",
  },
  {
    name: "vivd_image_ai",
    sourceFile: "vivd_image_ai.ts",
    moduleDistRelativePath: "opencode/toolModules/vivdImageAi.js",
    moduleSourceRelativePath: "server/opencode/toolModules/vivdImageAi.ts",
    definitionExportName: "vivdImageAiToolDefinition",
    defaultEnabled: true,
    featureFlag: "image_ai",
  },
];

function resolveStudioDistDir(env: NodeJS.ProcessEnv): string {
  const override = (env.VIVD_OPENCODE_TOOL_MODULES_DIR || "").trim();
  if (override) return override;
  return path.resolve(process.cwd(), "dist");
}

function buildWrapperSource(moduleImportUrl: string, definitionExportName: string): string {
  return `import { tool } from "@opencode-ai/plugin";
import { ${definitionExportName} } from "${moduleImportUrl}";

export default tool(${definitionExportName});
`;
}

export function buildStudioOpencodeToolSource(
  definition: StudioOpencodeToolDefinition,
  env: NodeJS.ProcessEnv,
): string {
  const distDir = resolveStudioDistDir(env);
  const distModulePath = path.join(distDir, definition.moduleDistRelativePath);
  const modulePath = fs.existsSync(distModulePath)
    ? distModulePath
    : path.resolve(process.cwd(), definition.moduleSourceRelativePath);
  const moduleImportUrl = pathToFileURL(modulePath).href;
  return buildWrapperSource(moduleImportUrl, definition.definitionExportName);
}

function parseCsvSet(value: string | undefined): Set<string> {
  return new Set(
    (value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function parseBooleanFeatureMap(value: string | undefined): Record<string, boolean> {
  const raw = (value || "").trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, mapValue]) => {
        if (typeof mapValue === "boolean") return [[key, mapValue]];
        if (typeof mapValue === "string") {
          const normalized = mapValue.trim().toLowerCase();
          if (normalized === "true") return [[key, true]];
          if (normalized === "false") return [[key, false]];
        }
        return [];
      }),
    );
  } catch {
    console.warn(
      "[OpenCode] Failed to parse VIVD_OPENCODE_TOOL_FLAGS; expected JSON object of booleans.",
    );
    return {};
  }
}

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = (value || "").trim();
  return trimmed || null;
}

function isDefinitionEnabledByContext(
  definition: StudioOpencodeToolDefinition,
  context: {
    role: string | null;
    plan: string | null;
    enabledPlugins: Set<string>;
    featureFlags: Record<string, boolean>;
  },
): boolean {
  if (definition.defaultEnabled === false) return false;

  if (definition.featureFlag && context.featureFlags[definition.featureFlag] === false) {
    return false;
  }

  if (definition.allowedRoles?.length && context.role) {
    if (!definition.allowedRoles.includes(context.role)) return false;
  }

  if (definition.allowedPlans?.length && context.plan) {
    if (!definition.allowedPlans.includes(context.plan)) return false;
  }

  if (definition.requiredPlugins?.length) {
    for (const pluginId of definition.requiredPlugins) {
      if (!context.enabledPlugins.has(pluginId)) return false;
    }
  }

  return true;
}

export function getStudioOpencodeToolDefinitions(): StudioOpencodeToolDefinition[] {
  return TOOL_DEFINITIONS;
}

export function resolveStudioOpencodeToolPolicy(
  env: NodeJS.ProcessEnv,
): StudioOpencodeToolPolicy {
  const enableList = parseCsvSet(env.VIVD_OPENCODE_TOOLS_ENABLE);
  const disableList = parseCsvSet(env.VIVD_OPENCODE_TOOLS_DISABLE);
  const enabledPlugins = parseCsvSet(env.VIVD_ENABLED_PLUGINS);
  const featureFlags = {
    ...DEFAULT_FEATURE_FLAGS,
    ...parseBooleanFeatureMap(env.VIVD_OPENCODE_TOOL_FLAGS),
  };

  const role = normalizeOptional(env.VIVD_ORGANIZATION_ROLE);
  const plan = normalizeOptional(env.VIVD_ORGANIZATION_PLAN);

  const context = {
    role,
    plan,
    enabledPlugins,
    featureFlags,
  };

  const enabledByName: Record<string, boolean> = {};
  for (const definition of TOOL_DEFINITIONS) {
    let enabled = isDefinitionEnabledByContext(definition, context);

    if (enableList.size > 0) {
      enabled = enableList.has(definition.name);
    }

    if (disableList.has(definition.name)) {
      enabled = false;
    }

    enabledByName[definition.name] = enabled;
  }

  return {
    tools: TOOL_DEFINITIONS,
    enabledByName,
  };
}
