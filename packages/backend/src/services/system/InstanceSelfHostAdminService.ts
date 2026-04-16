import * as fs from "fs";
import { soloSelfHostDefaults } from "@vivd/shared/config";
import { installProfileService } from "./InstallProfileService";
import {
  getSystemSettingJsonValue,
  setSystemSettingJsonValue,
  SYSTEM_SETTING_KEYS,
} from "./SystemSettingsService";
import {
  type InstanceNetworkSettings,
  type ResolvedInstanceNetworkSettings,
  instanceNetworkSettingsService,
  normalizeStoredInstanceNetworkSettings,
} from "./InstanceNetworkSettingsService";
import {
  DEFAULT_404_FILENAME,
  ensureCaddyStaticPages,
  getCaddySystemPagesDir,
  UNPUBLISHED_SITE_PLACEHOLDER_FILENAME,
} from "../publish/caddyStaticPages";

function parseBooleanEnv(value: string | null | undefined): boolean | null {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function isLocalLikeHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".localhost")
  ) {
    return true;
  }
  return /^[\d.]+$/.test(normalized);
}

function buildSelfHostCaddyfile(settings: ResolvedInstanceNetworkSettings): string {
  const caddySitesDir =
    process.env.CADDY_SITES_DIR?.trim() || soloSelfHostDefaults.caddySitesDir;
  const systemPagesDir = getCaddySystemPagesDir(caddySitesDir);
  const globalOptions: string[] = ["{"];
  if (settings.tlsMode !== "managed") {
    globalOptions.push("    auto_https off");
  }
  if (settings.tlsMode === "managed" && settings.acmeEmail) {
    globalOptions.push(`    email ${settings.acmeEmail}`);
  }
  globalOptions.push(
    "",
    "    admin 0.0.0.0:2019 {",
    `        origins ${soloSelfHostDefaults.caddyAdminUrl} http://backend:3000 http://localhost:2019 http://127.0.0.1:2019`,
    "    }",
    "}",
    "",
    `import ${caddySitesDir}/*.caddy`,
    "",
  );

  const host = settings.publicHost || "localhost";
  const address =
    settings.tlsMode === "managed" && !isLocalLikeHost(host) ? host : `http://${host}`;

  return `${globalOptions.join("\n")}${address} {
    handle_path ${soloSelfHostDefaults.localS3DownloadPath}/* {
        reverse_proxy minio:9000
    }

    handle /plugins/* {
        reverse_proxy backend:3000
    }

    handle /email/v1/feedback/* {
        reverse_proxy backend:3000
    }

    handle /vivd-studio/api/* {
        reverse_proxy backend:3000
    }

    handle /vivd-studio* {
        reverse_proxy frontend:80
    }

    import ${soloSelfHostDefaults.caddyRuntimeRoutesDir}/*.caddy

    handle /health {
        respond "OK" 200
    }

    import ${caddySitesDir}/_primary/*.caddy

    handle {
        root * ${systemPagesDir}
        rewrite * /${UNPUBLISHED_SITE_PLACEHOLDER_FILENAME}
        file_server
    }

    handle_errors {
        @404 expression {err.status_code} == 404
        handle @404 {
            root * ${systemPagesDir}
            rewrite * /${DEFAULT_404_FILENAME}
            file_server {
                status {err.status_code}
            }
        }
    }
}
`;
}

export class InstanceSelfHostAdminService {
  async updateStoredSettings(
    patch: InstanceNetworkSettings,
  ): Promise<ResolvedInstanceNetworkSettings> {
    const currentSettings = normalizeStoredInstanceNetworkSettings(
      await getSystemSettingJsonValue<unknown>(SYSTEM_SETTING_KEYS.instanceNetworkSettings),
    );
    const nextSettings = normalizeStoredInstanceNetworkSettings({
      ...currentSettings,
      ...patch,
    });

    await setSystemSettingJsonValue(
      SYSTEM_SETTING_KEYS.instanceNetworkSettings,
      nextSettings,
    );

    await instanceNetworkSettingsService.refreshFromStore();
    return instanceNetworkSettingsService.getResolvedSettings();
  }

  async syncSelfHostedCaddyConfig(): Promise<boolean> {
    const envOverride = parseBooleanEnv(process.env.VIVD_SELFHOST_CADDY_UI_MANAGED);
    const enabled =
      envOverride ?? ((await installProfileService.getInstallProfile()) === "solo");
    if (!enabled) {
      return false;
    }

    const caddyfilePath = process.env.CADDY_MAIN_CONFIG_PATH?.trim() || "/etc/caddy/Caddyfile";
    const caddySitesDir =
      process.env.CADDY_SITES_DIR?.trim() || soloSelfHostDefaults.caddySitesDir;
    const resolved = instanceNetworkSettingsService.getResolvedSettings();
    const content = buildSelfHostCaddyfile(resolved);
    ensureCaddyStaticPages(caddySitesDir);

    try {
      const existing = fs.existsSync(caddyfilePath)
        ? fs.readFileSync(caddyfilePath, "utf-8")
        : null;
      if (existing === content) {
        return false;
      }

      fs.writeFileSync(caddyfilePath, content, "utf-8");
      return true;
    } catch (error) {
      console.warn(
        `[InstanceSelfHostAdminService] Failed to write self-host Caddyfile at ${caddyfilePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}

export const instanceSelfHostAdminService = new InstanceSelfHostAdminService();
