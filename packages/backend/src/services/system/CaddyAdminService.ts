import * as fs from "fs";
import { soloSelfHostDefaults } from "@vivd/shared/config";

export type CaddySurface = "default" | "public" | "platform";

type CaddyTargetConfig = {
  adminUrl: string;
  caddyfilePaths: string[];
};

const LEGACY_SHARED_CADDYFILE_PATHS = [
  "/etc/caddy/Caddyfile",
  "/etc/caddy_shared/Caddyfile",
];

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

function buildTargetConfig(surface: CaddySurface): CaddyTargetConfig {
  switch (surface) {
    case "public":
      return {
        adminUrl:
          firstDefined(
            process.env.CADDY_PUBLIC_ADMIN_URL,
            process.env.CADDY_ADMIN_URL,
          ) || soloSelfHostDefaults.caddyAdminUrl,
        caddyfilePaths: [
          process.env.CADDY_PUBLIC_MAIN_CONFIG_PATH,
          process.env.CADDY_MAIN_CONFIG_PATH,
          "/etc/caddy_public/Caddyfile",
          ...LEGACY_SHARED_CADDYFILE_PATHS,
        ].filter((value): value is string => Boolean(value)),
      };
    case "platform":
      return {
        adminUrl:
          firstDefined(
            process.env.CADDY_PLATFORM_ADMIN_URL,
            process.env.CADDY_ADMIN_URL,
          ) || soloSelfHostDefaults.caddyAdminUrl,
        caddyfilePaths: [
          process.env.CADDY_PLATFORM_MAIN_CONFIG_PATH,
          process.env.CADDY_MAIN_CONFIG_PATH,
          "/etc/caddy_platform/Caddyfile",
          ...LEGACY_SHARED_CADDYFILE_PATHS,
        ].filter((value): value is string => Boolean(value)),
      };
    default:
      return {
        adminUrl:
          firstDefined(process.env.CADDY_ADMIN_URL) ||
          soloSelfHostDefaults.caddyAdminUrl,
        caddyfilePaths: [
          process.env.CADDY_MAIN_CONFIG_PATH,
          ...LEGACY_SHARED_CADDYFILE_PATHS,
        ].filter((value): value is string => Boolean(value)),
      };
  }
}

function originFor(adminUrl: string): string | null {
  try {
    return new URL(adminUrl).origin;
  } catch {
    return null;
  }
}

export function getCaddyAdminUrl(surface: CaddySurface = "default"): string {
  return buildTargetConfig(surface).adminUrl;
}

/**
 * Trigger Caddy to reload its configuration by posting the Caddyfile.
 *
 * The matching Caddyfile must be accessible to the backend container. Public and
 * platform surfaces can each point at their own config path, while older single-Caddy
 * setups continue to fall back to the shared /etc/caddy/Caddyfile mount.
 */
export async function reloadCaddyConfig(
  surface: CaddySurface = "default",
): Promise<void> {
  try {
    const { adminUrl, caddyfilePaths } = buildTargetConfig(surface);
    const adminOrigin = originFor(adminUrl);
    let caddyfileContent: string | null = null;

    for (const caddyfilePath of caddyfilePaths) {
      try {
        caddyfileContent = fs.readFileSync(caddyfilePath, "utf-8");
        console.log(`Found ${surface} Caddyfile at ${caddyfilePath}`);
        break;
      } catch {
        // Try next path.
      }
    }

    if (!caddyfileContent) {
      console.warn(
        `Caddyfile for ${surface} surface not found at any expected location - Caddy reload skipped. ` +
          "Ensure the relevant Caddyfile is mounted or shared with the backend container.",
      );
      return;
    }

    const response = await fetch(`${adminUrl}/load`, {
      method: "POST",
      headers: {
        "Content-Type": "text/caddyfile",
        ...(adminOrigin ? { Origin: adminOrigin } : {}),
      },
      body: caddyfileContent,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Caddy reload for ${surface} surface failed with status ${response.status}: ${errorText}`,
      );
      return;
    }

    console.log(`Caddy ${surface} configuration reloaded successfully`);
  } catch (error) {
    console.warn(
      `Could not reload ${surface} Caddy (this is normal in development):`,
      error,
    );
  }
}
