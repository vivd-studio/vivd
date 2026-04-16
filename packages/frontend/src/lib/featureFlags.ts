import type { AppConfig } from "./AppConfigContext";

type InstallConfig = Pick<
  AppConfig,
  "installProfile" | "experimentalSoloModeEnabled" | "selfHostAdminFeaturesEnabled"
>;

export function isExperimentalSoloInstall(config: InstallConfig): boolean {
  return config.installProfile === "solo" && config.experimentalSoloModeEnabled;
}

export function showSelfHostAdminFeatures(config: InstallConfig): boolean {
  return config.installProfile === "solo" && config.selfHostAdminFeaturesEnabled;
}
