import {
  installProfileSchema,
  installProfileService,
  type InstallProfile,
} from "../system/InstallProfileService";

export function areStudioCompatibilityRoutesEnabled(
  installProfile: InstallProfile,
): boolean {
  return installProfile === "solo";
}

function readEnvInstallProfileFallback(): InstallProfile {
  const raw = process.env.VIVD_INSTALL_PROFILE?.trim();
  const parsed = installProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : "solo";
}

export async function shouldCreateStudioCompatibilityRoutes(): Promise<boolean> {
  try {
    return areStudioCompatibilityRoutesEnabled(
      await installProfileService.getInstallProfile(),
    );
  } catch {
    return areStudioCompatibilityRoutesEnabled(readEnvInstallProfileFallback());
  }
}
