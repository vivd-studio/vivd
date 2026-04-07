import type { FrontendPluginModule } from "../types";
import AnalyticsProjectPage from "./AnalyticsProjectPage";

export const analyticsFrontendPluginModule: FrontendPluginModule = {
  pluginId: "analytics",
  projectUi: {
    ProjectPage: AnalyticsProjectPage,
  },
};
