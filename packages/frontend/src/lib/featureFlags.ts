import type { AppConfig } from "./AppConfigContext";

type InstallConfig = Pick<
  AppConfig,
  "installProfile" | "experimentalSoloModeEnabled" | "selfHostAdminFeaturesEnabled"
> &
  Partial<
    Pick<AppConfig, "selfHostCompatibilityEnabled" | "selfHostAdminFeaturesVisible">
  >;

export function isExperimentalSoloInstall(config: InstallConfig): boolean {
  return (
    config.selfHostCompatibilityEnabled ??
    (config.installProfile === "solo" && config.experimentalSoloModeEnabled)
  );
}

export function showSelfHostAdminFeatures(config: InstallConfig): boolean {
  return (
    config.selfHostAdminFeaturesVisible ??
    (config.installProfile === "solo" && config.selfHostAdminFeaturesEnabled)
  );
}
