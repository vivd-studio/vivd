import { createHash } from "node:crypto";
import {
  applyAgentInstructionsTemplate,
  DEFAULT_AGENT_INSTRUCTIONS_TEMPLATE,
  ensureMandatoryToolChannelGuidance,
  formatAgentInstructionsPlugins,
  normalizeAgentInstructionsTemplate,
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
          })
        : ensureMandatoryToolChannelGuidance(
            normalizeAgentInstructionsTemplate(
              applyAgentInstructionsTemplate(template, {
                project_name: input.projectName,
                enabled_plugins: formatAgentInstructionsPlugins(input.enabledPlugins),
                source_context: input.source === "url" ? URL_SOURCE_CONTEXT : "",
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
