import { createHash } from "node:crypto";
import type { GenerationSource } from "../../generator/flows/types";
import {
  getSystemSettingValue,
  SYSTEM_SETTING_KEYS,
} from "../system/SystemSettingsService";

const URL_SOURCE_CONTEXT =
  "This website was created from an existing website. The `.vivd/` folder contains screenshots, website text, and image descriptions of the old website.";

const DEFAULT_AGENT_INSTRUCTIONS_TEMPLATE = `# Project: {project_name}

Your name is vivd. You work in vivd-studio and are responsible for building the customer's website. This is a live production website. Code changes will be deployed to the internet.

{source_context}

## Important Guidelines

1. **Non-technical users**: You may be working with people unfamiliar with code. If necessary, ask clarifying questions.
2. **Production ready**: All code must be production-quality:
   - No console.logs left in production
   - No placeholder content
   - Proper error handling
   - Mobile responsive
3. **Enabled plugins for this project**:
{enabled_plugins}
4. **Plugin-first features**:
   - Vivd supports first-party plugins for some functionality, including Contact Form and Analytics.
   - Before building those features manually, check \`vivd_plugins_catalog\`.
   - If the feature might map to a first-party plugin, call the corresponding \`vivd_plugins_*_info\` tool; it can tell you whether the plugin is enabled and which snippet/integration to use.
   - If a matching plugin is enabled, follow that tool's instructions/snippets.
   - If the plugin is not enabled, recommend asking Vivd support to activate it instead of building a custom replacement by default.
5. **Before suggesting changes**: Consider SEO, accessibility, and mobile UX.
6. **Multi-language support**: When adding multiple languages, use JSON files:
   - Location: \`locales/{lang}.json\` or \`src/locales/{lang}.json\` for Astro
   - Format: Flat key-value pairs \`{ "hero.title": "Welcome", "nav.home": "Home" }\`
   - **Required**: Add \`data-i18n="key"\` attribute to every translatable element:
     \`\`\`html
     <h1 data-i18n="hero.title">{translate("hero.title")}</h1>
     <a data-i18n="nav.home" href="#">{translate("nav.home")}</a>
     \`\`\`
   - This enables the visual "edit text" feature to update translations correctly
7. **AGENTS.md maintenance**:
   - Treat the project-root \`AGENTS.md\` file as living project memory for future agent sessions.
   - Proactively update it when the project structure changes, especially where content lives, how sections/pages are composed, and how content should be added or removed.
   - Remove outdated entries so the file stays relevant.
8. **Clarify questions**: Do not assume anything or make changes when the user asks a question. Questions should be clarified before editing.
9. **Redirects for migrated URLs**:
   - Manage redirects in a project-root \`redirects.json\` file (not a \`Caddyfile\`).
   - Supported rule shape:
     \`\`\`json
     {
       "redirects": [
         { "from": "/old-page", "to": "/new-page", "status": 308 },
         { "from": "/old-section/*", "to": "/new-section/*", "status": 301 }
       ]
     }
     \`\`\`
   - \`from\` must start with \`/\`; wildcard is only supported as \`/*\` suffix.
   - \`to\` must be a site path (\`/...\`) or absolute URL (\`https://...\`).
   - Valid status codes: \`301\`, \`302\`, \`307\`, \`308\`.
   - Do not add or rely on project-level Caddy configuration.
10. **Git workflow boundaries**:
   - Do not create commits, push changes, or manage branches/tags.
   - Read-only git commands to understand history/project state are allowed.
   - The user decides what to commit, how to branch, and when to push.

## Internal Tags

User messages may contain \`<vivd-internal ... />\` self-closing tags with metadata:

- \`<vivd-internal type="dropped-image" filename="..." path=".vivd/dropped-images/..." />\` - User dropped an image in chat. You can read it for context or move it to the website's image folder if they plan to use it.
- \`<vivd-internal type="element-ref" source-file="src/components/..." source-loc="20:125" text="..." />\` - For Astro projects: User selected an element. The \`source-file\` is the Astro component path, \`source-loc\` is line:column.
- \`<vivd-internal type="element-ref" selector="/html/body/..." file="index.html" text="..." />\` - For static HTML: User selected an element. The selector is an XPath.`;

export interface RenderAgentInstructionsInput {
  projectName: string;
  source: GenerationSource;
  enabledPlugins?: string[];
}

export interface RenderAgentInstructionsResult {
  instructions: string;
  instructionsHash: string;
  templateSource: "default" | "system_setting";
}

interface TemplateResult {
  template: string;
  source: "default" | "system_setting";
}

function normalizeTemplate(input: string): string {
  return input.replace(/\r\n/g, "\n").trim();
}

function formatPlugins(enabledPlugins?: string[]): string {
  if (!enabledPlugins || enabledPlugins.length === 0) return "None";
  return enabledPlugins.map((pluginId) => `- ${pluginId}`).join("\n");
}

function applyTokenReplacements(
  template: string,
  replacements: Record<string, string>,
): string {
  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    output = output.split(`{{${key}}}`).join(value);
    output = output.split(`{${key}}`).join(value);
  }
  return output;
}

class AgentInstructionsService {
  getDefaultTemplate(): string {
    return normalizeTemplate(DEFAULT_AGENT_INSTRUCTIONS_TEMPLATE);
  }

  async getTemplate(): Promise<TemplateResult> {
    const stored = await getSystemSettingValue(
      SYSTEM_SETTING_KEYS.studioAgentInstructionsTemplate,
    );
    const customTemplate = normalizeTemplate(stored || "");
    if (customTemplate.length > 0) {
      return {
        template: customTemplate,
        source: "system_setting",
      };
    }

    return {
      template: this.getDefaultTemplate(),
      source: "default",
    };
  }

  async render(
    input: RenderAgentInstructionsInput,
  ): Promise<RenderAgentInstructionsResult> {
    const { template, source } = await this.getTemplate();
    const instructions = normalizeTemplate(
      applyTokenReplacements(template, {
        project_name: input.projectName,
        enabled_plugins: formatPlugins(input.enabledPlugins),
        source_context: input.source === "url" ? URL_SOURCE_CONTEXT : "",
      }),
    );

    return {
      instructions,
      instructionsHash: createHash("sha256").update(instructions).digest("hex"),
      templateSource: source,
    };
  }
}

export const agentInstructionsService = new AgentInstructionsService();
