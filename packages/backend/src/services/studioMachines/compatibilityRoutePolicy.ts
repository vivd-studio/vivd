import {
  isExperimentalSoloModeEnabled,
  installProfileSchema,
  installProfileService,
  type InstallProfile,
} from "../system/InstallProfileService";
import type { StudioMachineProviderKind } from "./types";
import { resolveAuthBaseUrlFromEnv } from "../../lib/publicOrigin";

function isLocalDevelopmentHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".nip.io")
  );
}

function isLocalDevelopmentPublicOrigin(): boolean {
  const origin = resolveAuthBaseUrlFromEnv(process.env);
  if (!origin) return false;

  try {
    return isLocalDevelopmentHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function areStudioCompatibilityRoutesEnabled(
  installProfile: InstallProfile,
  providerKind?: StudioMachineProviderKind,
  localDevelopmentOrigin = false,
): boolean {
  if (installProfile === "solo") {
    return true;
  }

  if (providerKind === "local") {
    return true;
  }

  if (
    localDevelopmentOrigin &&
    providerKind === "docker"
  ) {
    return true;
  }

  return false;
}

function readEnvInstallProfileFallback(): InstallProfile {
  const raw = process.env.VIVD_INSTALL_PROFILE?.trim();
  const parsed = installProfileSchema.safeParse(raw);
  if (parsed.success) {
    if (parsed.data === "solo" && !isExperimentalSoloModeEnabled()) {
      return "platform";
    }
    return parsed.data;
  }
  return "platform";
}

export async function shouldCreateStudioCompatibilityRoutes(
  providerKind?: StudioMachineProviderKind,
): Promise<boolean> {
  const localDevelopmentOrigin = isLocalDevelopmentPublicOrigin();
  try {
    return areStudioCompatibilityRoutesEnabled(
      await installProfileService.getInstallProfile(),
      providerKind,
      localDevelopmentOrigin,
    );
  } catch {
    return areStudioCompatibilityRoutesEnabled(
      readEnvInstallProfileFallback(),
      providerKind,
      localDevelopmentOrigin,
    );
  }
}
