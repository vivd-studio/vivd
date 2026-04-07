import type { ComponentType } from "react";
import type { SharedProjectPluginUiDefinition } from "@vivd/shared/types";

export interface ProjectPluginPageProps {
  projectSlug: string;
  isEmbedded?: boolean;
}

export interface ProjectPluginUiDefinition extends SharedProjectPluginUiDefinition {
  ProjectPage?: ComponentType<ProjectPluginPageProps>;
}

export interface FrontendPluginModule {
  pluginId: string;
  projectUi?: ProjectPluginUiDefinition;
}
