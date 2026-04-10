import { createHash } from "node:crypto";
import {
  applyAgentInstructionsTemplate,
  DEFAULT_AGENT_INSTRUCTIONS_TEMPLATE,
  ensureMandatoryToolChannelGuidance,
  formatAgentInstructionsPlugins,
  normalizeAgentInstructionsTemplate,
  renderVivdCliRootHelp,
  renderDefaultVivdAgentInstructions,
  URL_SOURCE_CONTEXT,
} from "@vivd/shared/studio";
import type { GenerationSource } from "../../generator/flows/types";
import {
  getSystemSettingValue,
  SYSTEM_SETTING_KEYS,
} from "../system/SystemSettingsService";

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

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

class AgentInstructionsService {
  getDefaultTemplate(): string {
    return normalizeAgentInstructionsTemplate(DEFAULT_AGENT_INSTRUCTIONS_TEMPLATE);
  }

  async getTemplate(): Promise<TemplateResult> {
    const stored = await getSystemSettingValue(
      SYSTEM_SETTING_KEYS.studioAgentInstructionsTemplate,
    );
    const customTemplate = normalizeAgentInstructionsTemplate(stored || "");
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
    const instructions =
      source === "default"
        ? renderDefaultVivdAgentInstructions({
            projectName: input.projectName,
            enabledPlugins: input.enabledPlugins,
            sourceContext: input.source === "url" ? URL_SOURCE_CONTEXT : "",
            platformSurfaceMode: "cli",
            previewScreenshotCliEnabled: parseBooleanEnv(
              process.env.VIVD_CLI_PREVIEW_SCREENSHOT_ENABLED,
              false,
            ),
          })
        : ensureMandatoryToolChannelGuidance(
            normalizeAgentInstructionsTemplate(
              applyAgentInstructionsTemplate(template, {
                project_name: input.projectName,
                enabled_plugins: formatAgentInstructionsPlugins(input.enabledPlugins),
                source_context: input.source === "url" ? URL_SOURCE_CONTEXT : "",
                vivd_cli_root_help: renderVivdCliRootHelp({
                  previewScreenshotEnabled: parseBooleanEnv(
                    process.env.VIVD_CLI_PREVIEW_SCREENSHOT_ENABLED,
                    false,
                  ),
                }),
              }),
            ),
          );

    return {
      instructions,
      instructionsHash: createHash("sha256").update(instructions).digest("hex"),
      templateSource: source,
    };
  }
}

export const agentInstructionsService = new AgentInstructionsService();
